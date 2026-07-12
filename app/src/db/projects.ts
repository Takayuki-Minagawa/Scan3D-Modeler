import { db, uid, now } from './db';
import type { Project } from '../types';

export type ProjectInput = Omit<Project, 'id' | 'createdAt' | 'updatedAt'>;

export async function listProjects(): Promise<Project[]> {
  const all = await (await db()).getAll('projects');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<Project | undefined> {
  return (await db()).get('projects', id);
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const t = now();
  const project: Project = { ...input, id: uid(), createdAt: t, updatedAt: t };
  await (await db()).put('projects', project);
  return project;
}

export async function touchProject(id: string): Promise<void> {
  const d = await db();
  const p = await d.get('projects', id);
  if (p) await d.put('projects', { ...p, updatedAt: now() });
}

/**
 * プロジェクトと関連データ(段階・アセット・blob・ジョブ)を削除する。
 * 実行中ジョブの書き込みと競合しないよう、呼び出し側は事前に
 * stopProjectJobs()(jobs/runner.ts)で全タブのジョブ停止を確定させること。
 * 一覧の読み出しと削除を単一トランザクションで行うため、その間に追加された
 * 行が取り残されることはない(書込み側もproject存在を検証している)。
 */
export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['projects', 'stages', 'assets', 'blobs', 'jobs'], 'readwrite');
  const assetIds = (await tx.objectStore('assets').index('byProject').getAll(id)).map((a) => a.id);
  const stageIds = (await tx.objectStore('stages').index('byProject').getAll(id)).map((s) => s.id);
  const jobIds = (await tx.objectStore('jobs').index('byProject').getAll(id)).map((j) => j.id);
  await Promise.all([
    tx.objectStore('projects').delete(id),
    ...stageIds.map((s) => tx.objectStore('stages').delete(s)),
    ...assetIds.map((a) => tx.objectStore('assets').delete(a)),
    ...assetIds.map((a) => tx.objectStore('blobs').delete(a)),
    ...jobIds.map((j) => tx.objectStore('jobs').delete(j)),
  ]);
  await tx.done;
}
