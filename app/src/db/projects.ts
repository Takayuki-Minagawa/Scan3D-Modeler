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

/** プロジェクトと関連データ(段階・アセット・blob・ジョブ)を削除する */
export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  const assetIds = (await d.getAllFromIndex('assets', 'byProject', id)).map((a) => a.id);
  const stageIds = (await d.getAllFromIndex('stages', 'byProject', id)).map((s) => s.id);
  const jobIds = (await d.getAllFromIndex('jobs', 'byProject', id)).map((j) => j.id);
  const tx = d.transaction(['projects', 'stages', 'assets', 'blobs', 'jobs'], 'readwrite');
  await Promise.all([
    tx.objectStore('projects').delete(id),
    ...stageIds.map((s) => tx.objectStore('stages').delete(s)),
    ...assetIds.map((a) => tx.objectStore('assets').delete(a)),
    ...assetIds.map((a) => tx.objectStore('blobs').delete(a)),
    ...jobIds.map((j) => tx.objectStore('jobs').delete(j)),
  ]);
  await tx.done;
}
