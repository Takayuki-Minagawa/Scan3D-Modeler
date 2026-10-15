import { db, uid, now } from './db';
import type { AssetKind, AssetMeta, ImageAssetMetadata } from '../types';
import { framesOfVideo } from './videoFrames';

export { framesOfVideo };

export interface NewAssetThumbnail {
  blob: Blob;
  width: number;
  height: number;
}

export interface NewAsset {
  projectId: string;
  stageId?: string | null;
  kind: AssetKind;
  name: string;
  blob: Blob;
  excluded?: boolean;
  quality?: AssetMeta['quality'];
  thumbnail?: NewAssetThumbnail;
  image?: ImageAssetMetadata;
  /** frame から抽出元 video への参照。ZIP復元時にIDが振り直される。 */
  sourceAssetId?: string;
  meta?: Record<string, unknown>;
}

export async function addAsset(input: NewAsset): Promise<AssetMeta> {
  const d = await db();
  const createdAt = now();
  const thumbnailId = input.thumbnail ? uid() : undefined;
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
    thumbnailAssetId: thumbnailId,
    sourceAssetId: input.sourceAssetId,
    image: input.image,
    meta: input.meta,
    createdAt,
  };
  const thumbnailMeta: AssetMeta | undefined = input.thumbnail
    ? {
        id: thumbnailId!,
        projectId: input.projectId,
        stageId: input.stageId ?? null,
        kind: 'thumbnail',
        name: `${input.name}.thumbnail.jpg`,
        mime: input.thumbnail.blob.type || 'image/jpeg',
        size: input.thumbnail.blob.size,
        sourceAssetId: meta.id,
        meta: {
          role: 'galleryThumbnail',
          width: input.thumbnail.width,
          height: input.thumbnail.height,
        },
        createdAt,
      }
    : undefined;
  // project存在確認と書き込みを同一トランザクションで行い、
  // プロジェクト削除と競合しても孤児アセットを残さない
  const tx = d.transaction(['projects', 'assets', 'blobs'], 'readwrite');
  const project = await tx.objectStore('projects').get(input.projectId);
  if (!project) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new Error('プロジェクトが見つかりません(削除された可能性があります)');
  }
  const writes: Promise<unknown>[] = [
    tx.objectStore('assets').put(meta),
    tx.objectStore('blobs').put({ assetId: meta.id, blob: input.blob }),
  ];
  if (thumbnailMeta && input.thumbnail) {
    writes.push(tx.objectStore('assets').put(thumbnailMeta));
    writes.push(
      tx.objectStore('blobs').put({ assetId: thumbnailMeta.id, blob: input.thumbnail.blob }),
    );
  }
  await Promise.all(writes);
  await tx.done;
  return meta;
}

/**
 * 旧DB/旧ZIPの原画に後からサムネイルを関連付ける。
 * 生成はtransaction外で行い、関連付けと2レコードの保存だけを原子的に行う。
 * 別タブが先に補完済みなら既存関連を採用し、重複サムネイルを作らない。
 */
export async function attachAssetThumbnail(
  sourceAssetId: string,
  thumbnail: NewAssetThumbnail,
): Promise<AssetMeta | undefined> {
  const d = await db();
  const tx = d.transaction(['projects', 'assets', 'blobs'], 'readwrite');
  const assets = tx.objectStore('assets');
  const blobs = tx.objectStore('blobs');
  const source = await assets.get(sourceAssetId);
  if (
    !source ||
    !['image', 'frame'].includes(source.kind) ||
    !(await tx.objectStore('projects').get(source.projectId))
  ) {
    await tx.done;
    return undefined;
  }

  if (source.thumbnailAssetId) {
    const [existingMeta, existingBlob] = await Promise.all([
      assets.get(source.thumbnailAssetId),
      blobs.get(source.thumbnailAssetId),
    ]);
    if (
      existingMeta?.kind === 'thumbnail' &&
      existingMeta.sourceAssetId === source.id &&
      existingBlob
    ) {
      await tx.done;
      return source;
    }
    // 自分に属する壊れたサムネイルだけを掃除する。破損/細工された他asset参照を
    // 追って削除しない（原画データの巻き込み防止）。
    if (existingMeta?.kind === 'thumbnail' && existingMeta.sourceAssetId === source.id) {
      await Promise.all([
        assets.delete(source.thumbnailAssetId),
        blobs.delete(source.thumbnailAssetId),
      ]);
    }
  }

  const id = uid();
  const createdAt = now();
  const thumbnailMeta: AssetMeta = {
    id,
    projectId: source.projectId,
    stageId: source.stageId,
    kind: 'thumbnail',
    name: `${source.name}.thumbnail.jpg`,
    mime: thumbnail.blob.type || 'image/jpeg',
    size: thumbnail.blob.size,
    sourceAssetId: source.id,
    meta: { role: 'galleryThumbnail', width: thumbnail.width, height: thumbnail.height },
    createdAt,
  };
  const updated = { ...source, thumbnailAssetId: id };
  await Promise.all([
    assets.put(updated),
    assets.put(thumbnailMeta),
    blobs.put({ assetId: id, blob: thumbnail.blob }),
  ]);
  await tx.done;
  return updated;
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
  const assets = tx.objectStore('assets');
  const blobs = tx.objectStore('blobs');
  const asset = await assets.get(id);
  const deletes: Promise<unknown>[] = [assets.delete(id), blobs.delete(id)];
  if (asset?.thumbnailAssetId) {
    const thumbnail = await assets.get(asset.thumbnailAssetId);
    if (thumbnail?.kind === 'thumbnail' && thumbnail.sourceAssetId === asset.id) {
      deletes.push(assets.delete(asset.thumbnailAssetId), blobs.delete(asset.thumbnailAssetId));
    }
  }
  // 通常は原画側から削除するが、サムネイル単体削除にも参照整合性を持たせる。
  if (asset?.sourceAssetId) {
    const source = await assets.get(asset.sourceAssetId);
    if (
      source &&
      ['image', 'frame'].includes(source.kind) &&
      source.thumbnailAssetId === id &&
      asset.kind === 'thumbnail'
    ) {
      deletes.push(assets.put({ ...source, thumbnailAssetId: undefined }));
    }
  }
  await Promise.all(deletes);
  await tx.done;
}

export class VideoInUseError extends Error {
  constructor() {
    super('この動画のフレーム抽出ジョブが実行中または一時停止中です。パイプラインタブで中止してから削除してください');
    this.name = 'VideoInUseError';
  }
}

/**
 * 動画を削除する。抽出済みフレームは同時に削除するか、動画への参照だけ外して残す。
 * 抽出ジョブの確認と削除を単一transactionで行い、実行中ジョブの入力を消さない。
 */
export async function deleteVideoAsset(
  videoId: string,
  options: { deleteFrames: boolean },
): Promise<{ frames: number }> {
  const d = await db();
  const tx = d.transaction(['assets', 'blobs', 'jobs'], 'readwrite');
  const assetsStore = tx.objectStore('assets');
  const blobs = tx.objectStore('blobs');
  const video = await assetsStore.get(videoId);
  if (!video || video.kind !== 'video') {
    await tx.done;
    return { frames: 0 };
  }
  const jobs = await tx.objectStore('jobs').index('byProject').getAll(video.projectId);
  if (
    jobs.some(
      (job) =>
        job.type === 'extractFrames' &&
        (job.status === 'running' || job.status === 'paused') &&
        job.params.videoAssetId === videoId,
    )
  ) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new VideoInUseError();
  }
  const projectAssets = await assetsStore.index('byProject').getAll(video.projectId);
  const frames = framesOfVideo(video, projectAssets);
  const byId = new Map(projectAssets.map((asset) => [asset.id, asset]));
  const writes: Promise<unknown>[] = [assetsStore.delete(videoId), blobs.delete(videoId)];
  for (const frame of frames) {
    if (options.deleteFrames) {
      writes.push(assetsStore.delete(frame.id), blobs.delete(frame.id));
      const thumbnail = frame.thumbnailAssetId ? byId.get(frame.thumbnailAssetId) : undefined;
      if (thumbnail?.kind === 'thumbnail' && thumbnail.sourceAssetId === frame.id) {
        writes.push(assetsStore.delete(thumbnail.id), blobs.delete(thumbnail.id));
      }
    } else if (frame.sourceAssetId === videoId) {
      // 参照切れを残さない(ZIP検証は frame→video 参照の実在を要求する)。
      const { sourceAssetId: _removed, ...rest } = frame;
      writes.push(assetsStore.put(rest));
    }
  }
  await Promise.all(writes);
  await tx.done;
  return { frames: frames.length };
}
