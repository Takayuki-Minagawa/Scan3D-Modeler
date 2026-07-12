import { addAsset } from '../db/assets';
import { scoreImageData, DEFAULT_BLUR_THRESHOLD, type BlurResult } from '../jobs/blurClient';
import type { AssetMeta } from '../types';

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('画像のエンコードに失敗しました'))),
      type,
      quality,
    );
  });
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
  const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.width;
  const sh = src instanceof HTMLVideoElement ? src.videoHeight : src.height;
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
  const blob = await canvasToBlob(c, 'image/jpeg', 0.92);
  const blur = await scoreImageData(bitmapToImageData(video));
  const asset = await addAsset({
    projectId,
    kind: 'image',
    name,
    blob,
    quality: { blur: Math.round(blur.score), sharp: blur.score >= DEFAULT_BLUR_THRESHOLD },
    meta: { width: c.width, height: c.height, source: 'camera' },
  });
  return { asset, blur };
}
