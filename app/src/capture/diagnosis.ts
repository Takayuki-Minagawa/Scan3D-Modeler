import type { AssetMeta } from '../types';

function dimensions(asset: AssetMeta): string | null {
  const width = asset.image?.widthPx ?? asset.meta?.width;
  const height = asset.image?.heightPx ?? asset.meta?.height;
  return typeof width === 'number' && typeof height === 'number' &&
    Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
    ? `${width}×${height}`
    : null;
}

export function diagnoseImageSet(assets: AssetMeta[]) {
  const kept = assets.filter((asset) => !asset.excluded);
  const resolutionCounts = new Map<string, number>();
  const cameraCounts = new Map<string, number>();
  const blurryIds: string[] = [];
  const missingFocalIds: string[] = [];
  const missingDimensionsIds: string[] = [];
  for (const asset of kept) {
    const resolution = dimensions(asset);
    if (resolution) resolutionCounts.set(resolution, (resolutionCounts.get(resolution) ?? 0) + 1);
    else missingDimensionsIds.push(asset.id);
    const camera = [asset.image?.cameraMake, asset.image?.cameraModel].filter(Boolean).join(' ').trim();
    if (camera) cameraCounts.set(camera, (cameraCounts.get(camera) ?? 0) + 1);
    if (asset.quality?.sharp === false) blurryIds.push(asset.id);
    if (!asset.image?.intrinsics?.focalPx) missingFocalIds.push(asset.id);
  }
  return {
    kept: kept.length,
    excluded: assets.length - kept.length,
    resolutionCounts,
    cameraCounts,
    blurryIds,
    missingFocalIds,
    missingDimensionsIds,
  };
}

export interface ThumbnailDiagnosis {
  exposure?: 'dark' | 'bright';
  /** 直前200枚との簡易画素比較。幾何学的な重なりや復元可否は判定しない。 */
  similarTo?: string;
}

export interface ThumbnailProfile {
  assetId: string;
  pixels: Uint8Array;
  mean: number;
}

/** 原画を読まず、保存済み256pxサムネイルから16×16の明度だけを得る。 */
export async function profileThumbnail(blob: Blob, assetId: string): Promise<ThumbnailProfile> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('サムネイルを検査できません');
    ctx.drawImage(bitmap, 0, 0, 16, 16);
    const rgba = ctx.getImageData(0, 0, 16, 16).data;
    const pixels = new Uint8Array(256);
    let sum = 0;
    for (let i = 0; i < pixels.length; i++) {
      const p = i * 4;
      const gray = Math.round(0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]);
      pixels[i] = gray;
      sum += gray;
    }
    return { assetId, pixels, mean: sum / pixels.length };
  } finally {
    bitmap.close();
  }
}

export function diagnoseThumbnail(
  profile: ThumbnailProfile,
  previous: ThumbnailProfile[],
): ThumbnailDiagnosis {
  const exposure = profile.mean < 35 ? 'dark' : profile.mean > 220 ? 'bright' : undefined;
  for (let i = previous.length - 1; i >= Math.max(0, previous.length - 200); i--) {
    const other = previous[i];
    let distance = 0;
    for (let p = 0; p < profile.pixels.length; p++) {
      distance += Math.abs(profile.pixels[p] - other.pixels[p]);
    }
    if (distance / profile.pixels.length < 4) {
      return { exposure, similarTo: other.assetId };
    }
  }
  return { exposure };
}
