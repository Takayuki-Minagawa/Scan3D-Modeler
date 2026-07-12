/**
 * ブレ(鮮鋭度)判定ワーカー。
 * グレースケール化 → 3x3ラプラシアン → 分散 をスコアとする。
 * スコアが小さいほどブレ・ピンボケの可能性が高い。
 * あわせて重複フレーム判定用の 64x64 縮小グレー画像を返す。
 */
interface BlurRequest {
  id: number;
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA
}

const THUMB = 64;

self.addEventListener('message', (ev: MessageEvent<BlurRequest>) => {
  const { id, width: w, height: h, data } = ev.data;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      sum += lap;
      sum2 += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  const score = sum2 / n - mean * mean; // ラプラシアン分散

  // 64x64 ボックスサンプリング(重複判定用)
  const thumb = new Float32Array(THUMB * THUMB);
  for (let ty = 0; ty < THUMB; ty++) {
    const sy = Math.min(h - 1, Math.floor(((ty + 0.5) * h) / THUMB));
    for (let tx = 0; tx < THUMB; tx++) {
      const sx = Math.min(w - 1, Math.floor(((tx + 0.5) * w) / THUMB));
      thumb[ty * THUMB + tx] = gray[sy * w + sx];
    }
  }
  (self as unknown as Worker).postMessage({ id, score, thumb }, [thumb.buffer]);
});
