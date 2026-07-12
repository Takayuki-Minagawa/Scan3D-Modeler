import { addAsset, getAsset, getAssetBlob, listAssets, updateAsset } from '../db/assets';
import { createStage, setStageStatus } from '../db/stages';
import { scoreImageData, thumbDiff, DEFAULT_BLUR_THRESHOLD } from '../jobs/blurClient';
import { throwIfStopped, type JobContext } from '../jobs/runner';
import { blobToImageData, bitmapToImageData, canvasToBlob } from './imageUtil';

/**
 * 動画からのキーフレーム抽出エンジン(作業計画 1B-3)。
 * - 一定間隔でシークしながらフレームを取得
 * - ブレ判定(Workerでラプラシアン分散)
 * - 直前採用フレームとの重複判定(縮小グレー画像の平均絶対差)
 * - 1フレーム処理ごとにチェックポイント保存 → 中断後は続きから再開
 */
export interface ExtractParams {
  videoAssetId: string;
  stepMs: number;
  blurThreshold: number;
  [key: string]: unknown;
}

interface ExtractCheckpoint {
  stageId: string;
  nextMs: number;
  kept: number;
  scanned: number;
  lastThumb: Float32Array | null;
}

const DEDUP_DIFF_THRESHOLD = 2.0;

export async function extractFramesEngine(
  ctx: JobContext<ExtractParams, ExtractCheckpoint>,
): Promise<void> {
  const { videoAssetId, stepMs, blurThreshold } = ctx.params;
  const videoAsset = await getAsset(videoAssetId);
  const blob = await getAssetBlob(videoAssetId);
  if (!videoAsset || !blob) throw new Error('動画データが見つかりません');

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const url = URL.createObjectURL(blob);
  try {
    video.src = url;
    await waitEvent(video, 'loadedmetadata', 15000);
    const durationMs = (await realDurationSec(video)) * 1000;
    if (!(durationMs > 0)) throw new Error('動画の長さを取得できません');

    // 再開時は既存stage、初回は新規stage(履歴として追加)
    let cp: ExtractCheckpoint;
    if (ctx.checkpoint) {
      cp = ctx.checkpoint;
    } else {
      const stage = await createStage(ctx.job.projectId, 'frames', {
        params: { stepMs, blurThreshold, video: videoAsset.name },
        note: `動画「${videoAsset.name}」から抽出`,
      });
      cp = { stageId: stage.id, nextMs: 0, kept: 0, scanned: 0, lastThumb: null };
      await ctx.saveCheckpoint(cp);
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const c2d = canvas.getContext('2d');
    if (!c2d) throw new Error('canvas 2Dコンテキストを取得できません');

    for (let t = cp.nextMs; t <= durationMs; t += stepMs) {
      throwIfStopped(ctx.signal);
      await seek(video, t / 1000);
      c2d.drawImage(video, 0, 0);
      const { score, thumb } = await scoreImageData(bitmapToImageData(video));
      cp.scanned++;

      const isDuplicate = cp.lastThumb !== null && thumbDiff(cp.lastThumb, thumb) < DEDUP_DIFF_THRESHOLD;
      if (!isDuplicate) {
        const frameBlob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
        const sharp = score >= blurThreshold;
        await addAsset({
          projectId: ctx.job.projectId,
          stageId: cp.stageId,
          kind: 'frame',
          name: `frame_${String(Math.round(t)).padStart(7, '0')}ms.jpg`,
          blob: frameBlob,
          excluded: !sharp,
          quality: { blur: Math.round(score), sharp },
          meta: { timeMs: Math.round(t), video: videoAsset.name },
        });
        cp.kept++;
        cp.lastThumb = thumb;
      }

      cp.nextMs = t + stepMs;
      await ctx.saveCheckpoint(cp);
      ctx.report(
        Math.min(0.999, t / durationMs),
        `${cp.kept}枚保持 / ${cp.scanned}コマ検査(重複除外あり)`,
      );
    }
    await setStageStatus(cp.stageId, 'ready', { 保持枚数: cp.kept, 検査コマ数: cp.scanned });
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * 取込済み画像の一括ブレ判定エンジン(quality未設定のものだけ処理)。
 * 「未処理のものを探して処理する」構造のため、checkpointなしで自然に再開できる。
 */
export async function scoreImagesEngine(ctx: JobContext): Promise<void> {
  const images = (await listAssets(ctx.job.projectId, ['image', 'frame'])).filter(
    (a) => a.quality?.blur === undefined,
  );
  let done = 0;
  for (const asset of images) {
    throwIfStopped(ctx.signal);
    const blob = await getAssetBlob(asset.id);
    if (blob) {
      const img = await blobToImageData(blob);
      const { score } = await scoreImageData(img);
      await updateAsset(asset.id, {
        quality: { blur: Math.round(score), sharp: score >= DEFAULT_BLUR_THRESHOLD },
      });
    }
    done++;
    ctx.report(done / images.length, `${done}/${images.length} 枚を判定`);
  }
}

function waitEvent(el: HTMLMediaElement, name: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`動画の読み込みがタイムアウトしました(${name})`));
    }, timeoutMs);
    const ok = () => {
      cleanup();
      resolve();
    };
    const err = () => {
      cleanup();
      reject(new Error('動画を読み込めません(未対応の形式の可能性)'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener(name, ok);
      el.removeEventListener('error', err);
    };
    el.addEventListener(name, ok);
    el.addEventListener('error', err);
  });
}

/**
 * MediaRecorder製webmは duration が Infinity になることがある(既知のChrome挙動)。
 * 末尾へ大きくシークすると実時間が確定する。
 */
async function realDurationSec(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  video.currentTime = 1e7;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 3000);
    const on = () => {
      if (Number.isFinite(video.duration)) {
        clearTimeout(timer);
        video.removeEventListener('durationchange', on);
        resolve();
      }
    };
    video.addEventListener('durationchange', on);
  });
  const d = Number.isFinite(video.duration) ? video.duration : 0;
  await seek(video, 0);
  return d;
}

function seek(video: HTMLVideoElement, sec: number): Promise<void> {
  return new Promise((resolve) => {
    // 同一位置へのシークでは seeked が発火しないことがあるためタイムアウトで保険
    const timer = setTimeout(done, 2000);
    function done() {
      clearTimeout(timer);
      video.removeEventListener('seeked', done);
      resolve();
    }
    video.addEventListener('seeked', done);
    video.currentTime = sec;
  });
}
