import { getAssetBlob } from '../db/assets';
import { db } from '../db/db';
import type { AssetMeta, Stage } from '../types';
import { decodeStoredGeometry, type GeometryKind } from './data';

export interface GeometryAsset {
  asset: AssetMeta & { kind: GeometryKind };
  stage?: Stage;
}

/** Read metadata together; unfinished results must not replace completed geometry. */
export async function listGeometryAssets(projectId: string): Promise<GeometryAsset[]> {
  const database = await db();
  const tx = database.transaction(['assets', 'stages'], 'readonly');
  const [assets, stages] = await Promise.all([
    tx.objectStore('assets').index('byProject').getAll(projectId),
    tx.objectStore('stages').index('byProject').getAll(projectId),
    tx.done,
  ]);
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  return assets.flatMap((asset): GeometryAsset[] => {
    if (asset.kind !== 'pointcloud' && asset.kind !== 'mesh') return [];
    const stage = asset.stageId ? byId.get(asset.stageId) : undefined;
    if (asset.stageId && stage?.status !== 'ready') return [];
    return [{ asset: { ...asset, kind: asset.kind }, stage }];
  }).sort((a, b) => a.asset.createdAt - b.asset.createdAt ||
    (a.stage?.seq ?? 0) - (b.stage?.seq ?? 0) || a.asset.id.localeCompare(b.asset.id));
}

export async function geometryBlob(entry: GeometryAsset): Promise<Blob> {
  const blob = await getAssetBlob(entry.asset.id);
  if (!blob) throw new Error(`形状「${entry.asset.name}」の本体データがありません`);
  return blob;
}

export async function loadGeometry(entry: GeometryAsset) {
  return decodeStoredGeometry(entry.asset.kind, await (await geometryBlob(entry)).arrayBuffer());
}
