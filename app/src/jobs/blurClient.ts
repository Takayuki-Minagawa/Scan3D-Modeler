/** blur.worker への非同期リクエストクライアント(シングルトンWorker) */
export interface BlurResult {
  score: number;
  thumb: Float32Array;
}

let worker: Worker | null = null;
let nextId = 1;
interface PendingRequest {
  resolve: (r: BlurResult) => void;
  reject: (e: Error) => void;
}
const pending = new Map<number, PendingRequest>();

/**
 * Workerのエラーで保留中の全要求を失敗させる。放置すると呼び出し側の
 * ジョブがawaitのまま永久待機し、一時停止も完了もできなくなるため。
 * 壊れたWorkerは破棄し、次回要求時に作り直す。
 */
function failAllPending(message: string): void {
  const err = new Error(message);
  for (const p of pending.values()) p.reject(err);
  pending.clear();
  worker?.terminate();
  worker = null;
}

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/blur.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (ev: MessageEvent<{ id: number; score: number; thumb: Float32Array }>) => {
      const { id, score, thumb } = ev.data;
      pending.get(id)?.resolve({ score, thumb });
      pending.delete(id);
    };
    worker.onerror = (e) =>
      failAllPending(`ブレ判定ワーカーでエラーが発生しました: ${e.message || '不明なエラー'}`);
    worker.onmessageerror = () => failAllPending('ブレ判定ワーカーとの通信に失敗しました');
  }
  return worker;
}

/** ImageDataのバッファは転送されるため呼び出し後は再利用不可 */
export function scoreImageData(img: ImageData): Promise<BlurResult> {
  const w = ensureWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, width: img.width, height: img.height, data: img.data }, [
      img.data.buffer,
    ]);
  });
}

/** 縮小グレー画像同士の平均絶対差(重複フレーム判定) */
export function thumbDiff(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return s / n;
}

/** 既定のブレ判定しきい値(ラプラシアン分散)。これ未満は既定で除外扱い */
export const DEFAULT_BLUR_THRESHOLD = 60;
