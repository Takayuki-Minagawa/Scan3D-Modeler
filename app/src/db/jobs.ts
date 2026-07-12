import { db, uid, now } from './db';
import type { JobRecord, JobType } from '../types';
import { heldJobLockIds } from '../jobs/lock';

export async function createJobRecord(
  type: JobType,
  projectId: string,
  title: string,
  params: Record<string, unknown>,
): Promise<JobRecord> {
  const t = now();
  const job: JobRecord = {
    id: uid(),
    projectId,
    type,
    title,
    status: 'running',
    progress: 0,
    params,
    createdAt: t,
    updatedAt: t,
  };
  await (await db()).put('jobs', job);
  return job;
}

export async function getJob(id: string): Promise<JobRecord | undefined> {
  return (await db()).get('jobs', id);
}

/**
 * 部分更新。読み出し〜書き込みを単一トランザクションで行い、並行する更新
 * (進捗報告とcheckpoint保存など)の相互上書きによる巻き戻しを防ぐ。
 * レコードが削除済み(プロジェクト削除後など)なら何もしない。
 */
export async function updateJob(id: string, patch: Partial<JobRecord>): Promise<void> {
  const d = await db();
  const tx = d.transaction('jobs', 'readwrite');
  const j = await tx.store.get(id);
  if (j) await tx.store.put({ ...j, ...patch, id: j.id, updatedAt: now() });
  await tx.done;
}

/** ジョブが作成した段階(stage)を記録する。失敗/中止時の状態確定に使う */
export async function appendJobStage(id: string, stageId: string): Promise<void> {
  const d = await db();
  const tx = d.transaction('jobs', 'readwrite');
  const j = await tx.store.get(id);
  if (j && !(j.stageIds ?? []).includes(stageId)) {
    await tx.store.put({ ...j, stageIds: [...(j.stageIds ?? []), stageId], updatedAt: now() });
  }
  await tx.done;
}

export async function listJobs(projectId: string): Promise<JobRecord[]> {
  const all = await (await db()).getAllFromIndex('jobs', 'byProject', projectId);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 起動時整合処理: どのタブも実行していない `running` ジョブを「一時停止」に落とす。
 * checkpointが残っているため、ユーザーはそこから再開できる(作業計画 1A-4)。
 * 実行中のタブはジョブごとのWeb Lockを保持しているため、ロック保持中のジョブは
 * 触らない(別タブを開いただけで実行中ジョブが「一時停止」表示になり、
 * そこから二重実行できてしまう問題の防止)。
 */
export async function reconcileJobsOnStartup(): Promise<void> {
  const d = await db();
  const running = await d.getAllFromIndex('jobs', 'byStatus', 'running');
  if (running.length === 0) return;
  const held = await heldJobLockIds();
  for (const j of running) {
    if (held.has(j.id)) continue; // 他タブで実行中
    await updateJob(j.id, {
      status: 'paused',
      message: '前回のセッションで中断されました(再開できます)',
    });
  }
}
