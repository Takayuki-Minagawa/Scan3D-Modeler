import { db, uid, now } from './db';
import type { Stage, StageKind, StageStatus } from '../types';

/**
 * 段階データは追記のみ(使用書§25)。同一kindの再実行は seq を増やして新規作成し、
 * 過去の段階は履歴として残す。
 */
export async function createStage(
  projectId: string,
  kind: StageKind,
  opts: {
    /** 再開を冪等にしたいエンジン向けに、IDを外から確定して渡せる */
    id?: string;
    params?: Record<string, unknown>;
    sourceStageId?: string | null;
    demo?: boolean;
    note?: string;
  } = {},
): Promise<Stage> {
  const d = await db();
  // project存在確認〜seq採番〜書き込みを単一トランザクションで行う:
  // - 削除済みプロジェクトへの書き込み防止(削除処理との競合)
  // - 並行ジョブとの採番競合防止(unique index byProjectKindSeq が安全網)
  const tx = d.transaction(['projects', 'stages'], 'readwrite');
  const project = await tx.objectStore('projects').get(projectId);
  if (!project) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new Error('プロジェクトが見つかりません(削除された可能性があります)');
  }
  const stages = tx.objectStore('stages');
  const last = await stages
    .index('byProjectKindSeq')
    .openCursor(
      IDBKeyRange.bound([projectId, kind, -Infinity], [projectId, kind, Infinity]),
      'prev',
    );
  const stage: Stage = {
    id: opts.id ?? uid(),
    projectId,
    kind,
    seq: (last?.value.seq ?? 0) + 1,
    status: 'running',
    demo: opts.demo,
    params: opts.params,
    sourceStageId: opts.sourceStageId ?? null,
    note: opts.note,
    createdAt: now(),
  };
  await stages.put(stage);
  await tx.done;
  return stage;
}

export async function getStage(id: string): Promise<Stage | undefined> {
  return (await db()).get('stages', id);
}

export async function setStageStatus(
  id: string,
  status: StageStatus,
  stats?: Record<string, string | number>,
): Promise<void> {
  const d = await db();
  const tx = d.transaction('stages', 'readwrite');
  const s = await tx.store.get(id);
  if (s) await tx.store.put({ ...s, status, stats: stats ?? s.stats });
  await tx.done;
}

/**
 * stageとその成果物(assets/blobs)をまとめて削除する。
 * ジョブ再開時に「保存途中だった作りかけ」を掃除して作り直すためのもので、
 * 確定済み(ready)の履歴を消す用途には使わないこと(使用書§25)。
 */
export async function deleteStageCascade(stageId: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['stages', 'assets', 'blobs'], 'readwrite');
  const assets = await tx.objectStore('assets').index('byStage').getAll(stageId);
  await Promise.all([
    tx.objectStore('stages').delete(stageId),
    ...assets.map((a) => tx.objectStore('assets').delete(a.id)),
    ...assets.map((a) => tx.objectStore('blobs').delete(a.id)),
  ]);
  await tx.done;
}

export async function listStages(projectId: string): Promise<Stage[]> {
  const all = await (await db()).getAllFromIndex('stages', 'byProject', projectId);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

/** 指定kindの最新段階(既定ではready のみ)を返す */
export async function latestStage(
  projectId: string,
  kind: StageKind,
  onlyReady = true,
): Promise<Stage | undefined> {
  const all = (await listStages(projectId)).filter(
    (s) => s.kind === kind && (!onlyReady || s.status === 'ready'),
  );
  return all.at(-1);
}
