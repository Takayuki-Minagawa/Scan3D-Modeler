import type { AssetMeta } from '../types';

/**
 * 動画から抽出したフレームを特定する。新しいフレームは sourceAssetId で動画を指す。
 * 動画IDを持たない旧フレームは動画名で照合するが、同名の動画が複数ある場合は
 * 取り違えを避けるため対象にしない。
 */
export function framesOfVideo(video: AssetMeta, assets: AssetMeta[]): AssetMeta[] {
  const sameName = assets.filter((asset) => asset.kind === 'video' && asset.name === video.name);
  return assets.filter(
    (asset) =>
      asset.kind === 'frame' &&
      (asset.sourceAssetId === video.id ||
        (!asset.sourceAssetId && sameName.length === 1 && asset.meta?.video === video.name)),
  );
}
