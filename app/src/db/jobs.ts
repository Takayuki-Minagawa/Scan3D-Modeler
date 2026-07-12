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
  // project存在確認と追加を同一トランザクションで行い、別タブでの
  // プロジェクト削除と競合しても削除済みprojectIdを持つジョブを作らない
  const d = await db();
  const tx = d.transaction(['projects', 'jobs'], 'readwrite');
  const project = await tx.objectStore('projects').get(projectId);
  if (!project) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new Error('プロジェクトが見つかりません(削除された可能性があります)');
  }
  await tx.objectStore('jobs').put(job);
  await tx.done;
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

export async function listRunningJobs(): Promise<JobRecord[]> {
  return (await db()).getAllFromIndex('jobs', 'byStatus', 'running');
}
