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
    params?: Record<string, unknown>;
    sourceStageId?: string | null;
    demo?: boolean;
    note?: string;
  } = {},
): Promise<Stage> {
  const d = await db();
  const existing = (await d.getAllFromIndex('stages', 'byProject', projectId)).filter(
    (s) => s.kind === kind,
  );
  const seq = existing.reduce((m, s) => Math.max(m, s.seq), 0) + 1;
  const stage: Stage = {
    id: uid(),
    projectId,
    kind,
    seq,
    status: 'running',
    demo: opts.demo,
    params: opts.params,
    sourceStageId: opts.sourceStageId ?? null,
    note: opts.note,
    createdAt: now(),
  };
  await d.put('stages', stage);
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
  const s = await d.get('stages', id);
  if (!s) return;
  await d.put('stages', { ...s, status, stats: stats ?? s.stats });
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
