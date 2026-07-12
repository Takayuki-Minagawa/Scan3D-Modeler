/** blur.worker への非同期リクエストクライアント(シングルトンWorker) */
export interface BlurResult {
  score: number;
  thumb: Float32Array;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: BlurResult) => void>();

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/blur.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (ev: MessageEvent<{ id: number; score: number; thumb: Float32Array }>) => {
      const { id, score, thumb } = ev.data;
      pending.get(id)?.({ score, thumb });
      pending.delete(id);
    };
  }
  return worker;
}

/** ImageDataのバッファは転送されるため呼び出し後は再利用不可 */
export function scoreImageData(img: ImageData): Promise<BlurResult> {
  const w = ensureWorker();
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
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
