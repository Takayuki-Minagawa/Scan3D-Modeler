import { addAsset } from '../db/assets';
import { scoreImageData, DEFAULT_BLUR_THRESHOLD, type BlurResult } from '../jobs/blurClient';
import type { AssetMeta, ImageAssetMetadata } from '../types';
import { buildImageMetadata, readExif } from './exif';

export const THUMBNAIL_MAX_DIM = 256;

export interface PreparedThumbnail {
  blob: Blob;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

export interface PreparedImageAsset {
  thumbnail: PreparedThumbnail;
  image: ImageAssetMetadata;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('画像のエンコードに失敗しました'))),
      type,
      quality,
    );
  });
}

/** 長辺をmaxDim以内に収める寸法計算。DOMなしで単体検証できる純粋関数。 */
export function thumbnailDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxDim = THUMBNAIL_MAX_DIM,
): { width: number; height: number } {
  if (!(sourceWidth > 0) || !(sourceHeight > 0) || !(maxDim > 0)) {
    throw new Error('画像またはサムネイルの寸法が不正です');
  }
  const scale = Math.min(1, maxDim / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function sourceDimensions(
  src: ImageBitmap | HTMLVideoElement | HTMLCanvasElement,
): { width: number; height: number } {
  return src instanceof HTMLVideoElement
    ? { width: src.videoWidth, height: src.videoHeight }
    : { width: src.width, height: src.height };
}

/** Canvas/ImageBitmap/Videoから一覧用JPEGサムネイルを生成する。 */
export async function createThumbnailFromSource(
  src: ImageBitmap | HTMLVideoElement | HTMLCanvasElement,
  maxDim = THUMBNAIL_MAX_DIM,
): Promise<PreparedThumbnail> {
  const { width: sourceWidth, height: sourceHeight } = sourceDimensions(src);
  const { width, height } = thumbnailDimensions(sourceWidth, sourceHeight, maxDim);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2Dコンテキストを取得できません');
  ctx.drawImage(src, 0, 0, width, height);
  return {
    blob: await canvasToBlob(canvas, 'image/jpeg', 0.78),
    width,
    height,
    sourceWidth,
    sourceHeight,
  };
}

/** Blob画像を一度だけデコードして一覧用サムネイルを作る。 */
export async function createImageThumbnail(blob: Blob): Promise<PreparedThumbnail> {
  const bitmap = await createImageBitmap(blob);
  try {
    return await createThumbnailFromSource(bitmap);
  } finally {
    bitmap.close();
  }
}

/** ファイル取込用: サムネイル生成と軽量EXIF読取を並行して行う。 */
export async function prepareImageAsset(blob: Blob): Promise<PreparedImageAsset> {
  const [thumbnail, exif] = await Promise.all([createImageThumbnail(blob), readExif(blob)]);
  return {
    thumbnail,
    image: buildImageMetadata(exif, thumbnail.sourceWidth, thumbnail.sourceHeight),
  };
}

/** Blob画像を縮小してImageDataへ(ブレ判定用) */
export async function blobToImageData(blob: Blob, maxDim = 320): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  try {
    return bitmapToImageData(bmp, maxDim);
  } finally {
    bmp.close();
  }
}

export function bitmapToImageData(
  src: ImageBitmap | HTMLVideoElement | HTMLCanvasElement,
  maxDim = 320,
): ImageData {
  const { width: sw, height: sh } = sourceDimensions(src);
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const w = Math.max(2, Math.round(sw * scale));
  const h = Math.max(2, Math.round(sh * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2Dコンテキストを取得できません');
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** <video>の現在フレームを静止画アセットとして保存(カメラ撮影・品質スコア付き) */
export async function saveStillFromVideo(
  video: HTMLVideoElement,
  projectId: string,
  name: string,
): Promise<{ asset: AssetMeta; blur: BlurResult }> {
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas 2Dコンテキストを取得できません');
  ctx.drawImage(video, 0, 0);
  // 採点は保存画像と同じフレーム(canvas)から行う。encode後のlive videoを
  // 再取得すると、撮影直後にカメラを動かした場合に保存画像と鮮鋭度が
  // 別フレームになり、ブレ画像の採否が逆転するため
  const blur = await scoreImageData(bitmapToImageData(c));
  const [blob, thumbnail] = await Promise.all([
    canvasToBlob(c, 'image/jpeg', 0.92),
    createThumbnailFromSource(c),
  ]);
  const asset = await addAsset({
    projectId,
    kind: 'image',
    name,
    blob,
    quality: { blur: Math.round(blur.score), sharp: blur.score >= DEFAULT_BLUR_THRESHOLD },
    thumbnail,
    image: { widthPx: c.width, heightPx: c.height },
    meta: { width: c.width, height: c.height, source: 'camera' },
  });
  return { asset, blur };
}
