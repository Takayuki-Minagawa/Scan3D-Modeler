import { addAsset, getAsset, getAssetBlob, listAssets, updateAsset } from '../db/assets';
import { createStage, setStageStatus } from '../db/stages';
import { scoreImageData, thumbDiff, DEFAULT_BLUR_THRESHOLD } from '../jobs/blurClient';
import { throwIfStopped, type JobContext } from '../jobs/runner';
import { JobTextError, jobText } from '../jobs/text';
import {
  blobToImageData,
  bitmapToImageData,
  canvasToBlob,
  createThumbnailFromSource,
} from './imageUtil';

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
  /** 直前に採用した鮮明フレームの縮小画(採用系の重複判定基準) */
  lastThumb: Float32Array | null;
  /** 直前に保存したブレフレームの縮小画(ブレ画像同士の重複判定基準) */
  lastBlurThumb?: Float32Array | null;
}

const DEDUP_DIFF_THRESHOLD = 2.0;

export async function extractFramesEngine(
  ctx: JobContext<ExtractParams, ExtractCheckpoint>,
): Promise<void> {
  const { videoAssetId, stepMs, blurThreshold } = ctx.params;
  const videoAsset = await getAsset(videoAssetId);
  const blob = await getAssetBlob(videoAssetId);
  if (!videoAsset || !blob) throw new JobTextError(jobText('error.videoNotFound'));

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const url = URL.createObjectURL(blob);
  try {
    video.src = url;
    await waitEvent(video, 'loadedmetadata', 15000);
    const durationMs = (await realDurationSec(video)) * 1000;
    if (!(durationMs > 0)) throw new JobTextError(jobText('error.videoDurationUnavailable'));

    // 再開時は既存stage、初回は新規stage(履歴として追加)
    let cp: ExtractCheckpoint;
    if (ctx.checkpoint) {
      cp = ctx.checkpoint;
    } else {
      const stage = await createStage(ctx.job.projectId, 'frames', {
        params: { stepMs, blurThreshold, video: videoAsset.name },
        note: `動画「${videoAsset.name}」から抽出`,
      });
      cp = {
        stageId: stage.id,
        nextMs: 0,
        kept: 0,
        scanned: 0,
        lastThumb: null,
        lastBlurThumb: null,
      };
      await ctx.saveCheckpoint(cp);
    }
    // ジョブが失敗/中止で終わるときにstageをrunningのまま残さないよう関連付ける
    // (再開時にも呼ぶ: 冪等)
    await ctx.bindStage(cp.stageId);

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const c2d = canvas.getContext('2d');
    if (!c2d) throw new JobTextError(jobText('error.canvasUnavailable'));

    for (let t = cp.nextMs; t <= durationMs; t += stepMs) {
      throwIfStopped(ctx.signal);
      await seek(video, t / 1000);
      c2d.drawImage(video, 0, 0);
      const { score, thumb } = await scoreImageData(bitmapToImageData(video));
      cp.scanned++;
      const sharp = score >= blurThreshold;

      // 重複判定は2系統の基準で行う:
      // - 採用の基準(lastThumb)は「直前に採用した鮮明フレーム」のみ。
      //   ブレ除外フレームを基準にすると、同じ構図でピントの合った次の
      //   フレームまで重複扱いになって良品を失うため
      // - ブレフレーム同士は直前に保存したブレフレーム(lastBlurThumb)とも
      //   比較する。これがないと全編ブレの動画で毎コマ全解像度JPEGを
      //   保存し続け、端末の保存容量を使い切ってしまうため
      const dupOfSharp =
        cp.lastThumb !== null && thumbDiff(cp.lastThumb, thumb) < DEDUP_DIFF_THRESHOLD;
      const dupOfBlur =
        !sharp &&
        cp.lastBlurThumb != null &&
        thumbDiff(cp.lastBlurThumb, thumb) < DEDUP_DIFF_THRESHOLD;
      if (!dupOfSharp && !dupOfBlur) {
        const [frameBlob, thumbnail] = await Promise.all([
          canvasToBlob(canvas, 'image/jpeg', 0.85),
          createThumbnailFromSource(canvas),
        ]);
        await addAsset({
          projectId: ctx.job.projectId,
          stageId: cp.stageId,
          kind: 'frame',
          name: `frame_${String(Math.round(t)).padStart(7, '0')}ms.jpg`,
          blob: frameBlob,
          excluded: !sharp,
          quality: { blur: Math.round(score), sharp },
          thumbnail,
          image: { widthPx: canvas.width, heightPx: canvas.height },
          meta: {
            timeMs: Math.round(t),
            video: videoAsset.name,
            width: canvas.width,
            height: canvas.height,
          },
        });
        if (sharp) {
          cp.kept++;
          cp.lastThumb = thumb;
          cp.lastBlurThumb = null; // 構図が進んだためブレ側の基準はリセット
        } else {
          // ブレフレームは参考用に除外印付きで保存するだけで、
          // 採用数にも採用側の重複基準にも含めない
          cp.lastBlurThumb = thumb;
        }
      }

      cp.nextMs = t + stepMs;
      await ctx.saveCheckpoint(cp);
      ctx.report(
        Math.min(0.999, t / durationMs),
        jobText('message.frameProgress', { kept: cp.kept, scanned: cp.scanned }),
      );
    }
    // 停止契約: 最終フレーム保存中に届いた停止要求もready確定前に観測する
    // (checkpointは全コマ処理済みのため、再開時はループを飛ばして確定だけ行う)
    throwIfStopped(ctx.signal);
    await setStageStatus(cp.stageId, 'ready', { 採用枚数: cp.kept, 検査コマ数: cp.scanned });
    ctx.notifyDataChanged();
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
    (a) => a.quality?.blur === undefined && a.meta?.scoreSkipped === undefined,
  );
  let done = 0;
  for (const asset of images) {
    throwIfStopped(ctx.signal);
    const blob = await getAssetBlob(asset.id);
    let img: ImageData | null = null;
    if (blob) {
      try {
        img = await blobToImageData(blob);
      } catch {
        // HEIC等、ブラウザがデコードできない原画は保持したまま採点だけをスキップする。
      }
    }
    if (img) {
      const { score } = await scoreImageData(img);
      await updateAsset(asset.id, {
        quality: { blur: Math.round(score), sharp: score >= DEFAULT_BLUR_THRESHOLD },
      });
    } else {
      // 1件の未知形式/欠損で後続JPEGまでfailedにしない。理由は言語非依存で永続化する。
      await updateAsset(asset.id, {
        meta: { ...asset.meta, scoreSkipped: blob ? 'decode-failed' : 'missing-blob' },
      });
    }
    done++;
    ctx.report(done / images.length, jobText('message.scoreProgress', { done, total: images.length }));
  }
}

function waitEvent(el: HTMLMediaElement, name: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new JobTextError(jobText('error.videoLoadTimeout', { event: name })));
    }, timeoutMs);
    const ok = () => {
      cleanup();
      resolve();
    };
    const err = () => {
      cleanup();
      reject(new JobTextError(jobText('error.videoUnsupported')));
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
