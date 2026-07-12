import { db, uid, now } from './db';
import type { AssetKind, AssetMeta } from '../types';

export interface NewAsset {
  projectId: string;
  stageId?: string | null;
  kind: AssetKind;
  name: string;
  blob: Blob;
  excluded?: boolean;
  quality?: AssetMeta['quality'];
  meta?: Record<string, unknown>;
}

export async function addAsset(input: NewAsset): Promise<AssetMeta> {
  const d = await db();
  const meta: AssetMeta = {
    id: uid(),
    projectId: input.projectId,
    stageId: input.stageId ?? null,
    kind: input.kind,
    name: input.name,
    mime: input.blob.type || 'application/octet-stream',
    size: input.blob.size,
    excluded: input.excluded,
    quality: input.quality,
    meta: input.meta,
    createdAt: now(),
  };
  // project存在確認と書き込みを同一トランザクションで行い、
  // プロジェクト削除と競合しても孤児アセットを残さない
  const tx = d.transaction(['projects', 'assets', 'blobs'], 'readwrite');
  const project = await tx.objectStore('projects').get(input.projectId);
  if (!project) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new Error('プロジェクトが見つかりません(削除された可能性があります)');
  }
  await Promise.all([
    tx.objectStore('assets').put(meta),
    tx.objectStore('blobs').put({ assetId: meta.id, blob: input.blob }),
  ]);
  await tx.done;
  return meta;
}

export async function listAssets(projectId: string, kinds?: AssetKind[]): Promise<AssetMeta[]> {
  const all = await (await db()).getAllFromIndex('assets', 'byProject', projectId);
  const filtered = kinds ? all.filter((a) => kinds.includes(a.kind)) : all;
  return filtered.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getAsset(id: string): Promise<AssetMeta | undefined> {
  return (await db()).get('assets', id);
}

export async function getAssetBlob(id: string): Promise<Blob | undefined> {
  return (await (await db()).get('blobs', id))?.blob;
}

/**
 * 部分更新。読み出し〜書き込みを単一トランザクションで行い、並行する更新
 * (画質判定とギャラリーの採用/除外操作など)の古い読み値による上書きを防ぐ。
 * レコードまたはプロジェクトが削除済みなら何もしない(削除済みメタの復活防止)。
 */
export async function updateAsset(id: string, patch: Partial<AssetMeta>): Promise<void> {
  const d = await db();
  const tx = d.transaction(['projects', 'assets'], 'readwrite');
  const store = tx.objectStore('assets');
  const a = await store.get(id);
  if (a && (await tx.objectStore('projects').get(a.projectId))) {
    await store.put({ ...a, ...patch, id: a.id, projectId: a.projectId });
  }
  await tx.done;
}

export async function deleteAsset(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['assets', 'blobs'], 'readwrite');
  await Promise.all([tx.objectStore('assets').delete(id), tx.objectStore('blobs').delete(id)]);
  await tx.done;
}
