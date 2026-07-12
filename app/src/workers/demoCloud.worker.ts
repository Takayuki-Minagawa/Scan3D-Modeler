/**
 * デモ用合成点群ジェネレータ(実撮影データではない)。
 * 穴付きL型ブラケット(使用書§30の推奨初回テスト対象)の表面点群を
 * チャンク単位で決定論的に生成する。チャンク番号+シードから再現できるため、
 * ジョブ再開時は途中チャンクから正確に続きを生成できる。
 *
 * 形状(単位mm):
 *   底板   x:[0,60], y:[0,6],  z:[0,40]
 *   立板   x:[0,60], y:[0,60], z:[34,40]
 *   立板の貫通穴 中心(x=30, y=35) 半径6(z方向貫通)
 */
interface GenRequest {
  type: 'gen';
  chunk: number;
  n: number;
  seed: number;
}

const HOLE = { cx: 30, cy: 35, r: 6 };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

const BASE: Box = { min: [0, 0, 0], max: [60, 6, 40] };
const WALL: Box = { min: [0, 0, 34], max: [60, 60, 40] };

function boxFaceAreas(b: Box): number[] {
  const dx = b.max[0] - b.min[0];
  const dy = b.max[1] - b.min[1];
  const dz = b.max[2] - b.min[2];
  // -x, +x, -y, +y, -z, +z
  return [dy * dz, dy * dz, dx * dz, dx * dz, dx * dy, dx * dy];
}

function samplePointOnBox(b: Box, rnd: () => number): [number, number, number] {
  const areas = boxFaceAreas(b);
  const total = areas.reduce((s, a) => s + a, 0);
  let pick = rnd() * total;
  let face = 0;
  for (; face < 6; face++) {
    if (pick < areas[face]) break;
    pick -= areas[face];
  }
  const u = rnd();
  const v = rnd();
  const p: [number, number, number] = [
    b.min[0] + u * (b.max[0] - b.min[0]),
    b.min[1] + v * (b.max[1] - b.min[1]),
    b.min[2] + rnd() * (b.max[2] - b.min[2]),
  ];
  const axis = Math.floor(face / 2);
  p[axis] = face % 2 === 0 ? b.min[axis] : b.max[axis];
  return p;
}

function inHole(x: number, y: number): boolean {
  const dx = x - HOLE.cx;
  const dy = y - HOLE.cy;
  return dx * dx + dy * dy < HOLE.r * HOLE.r;
}

function generateChunk(chunk: number, n: number, seed: number): Float32Array {
  const rnd = mulberry32(seed + chunk * 7919);
  const pts = new Float32Array(n * 3);
  let i = 0;
  while (i < n) {
    let p: [number, number, number];
    const sel = rnd();
    if (sel < 0.08) {
      // 穴の内周面(円筒壁)
      const th = rnd() * Math.PI * 2;
      p = [
        HOLE.cx + HOLE.r * Math.cos(th),
        HOLE.cy + HOLE.r * Math.sin(th),
        WALL.min[2] + rnd() * (WALL.max[2] - WALL.min[2]),
      ];
    } else {
      const box = sel < 0.5 ? BASE : WALL;
      p = samplePointOnBox(box, rnd);
      // 立板の大面では穴を抜く
      if (box === WALL && (p[2] === WALL.min[2] || p[2] === WALL.max[2]) && inHole(p[0], p[1])) {
        continue;
      }
      // 底板上面のうち立板と重なる部分は内部になるため除外
      if (box === BASE && p[1] === BASE.max[1] && p[2] >= WALL.min[2]) continue;
    }
    // スキャンノイズを模した微小ゆらぎ
    pts[i * 3] = p[0] + (rnd() - 0.5) * 0.12;
    pts[i * 3 + 1] = p[1] + (rnd() - 0.5) * 0.12;
    pts[i * 3 + 2] = p[2] + (rnd() - 0.5) * 0.12;
    i++;
  }
  return pts;
}

self.addEventListener('message', (ev: MessageEvent<GenRequest>) => {
  const { type, chunk, n, seed } = ev.data;
  if (type !== 'gen') return;
  const points = generateChunk(chunk, n, seed);
  (self as unknown as Worker).postMessage({ type: 'chunk', chunk, points }, [points.buffer]);
});
