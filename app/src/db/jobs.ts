import { db, uid, now } from './db';
import type { JobRecord, JobType } from '../types';

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

export async function updateJob(id: string, patch: Partial<JobRecord>): Promise<void> {
  const d = await db();
  const j = await d.get('jobs', id);
  if (!j) return;
  await d.put('jobs', { ...j, ...patch, id: j.id, updatedAt: now() });
}

export async function listJobs(projectId: string): Promise<JobRecord[]> {
  const all = await (await db()).getAllFromIndex('jobs', 'byProject', projectId);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 起動時整合処理: 前回セッションで実行中のままだったジョブを「一時停止」に落とす。
 * checkpointが残っているため、ユーザーはそこから再開できる(作業計画 1A-4)。
 */
export async function reconcileJobsOnStartup(): Promise<void> {
  const d = await db();
  const running = await d.getAllFromIndex('jobs', 'byStatus', 'running');
  for (const j of running) {
    await d.put('jobs', {
      ...j,
      status: 'paused',
      message: '前回のセッションで中断されました(再開できます)',
      updatedAt: now(),
    });
  }
}
