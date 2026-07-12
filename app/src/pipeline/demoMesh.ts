/**
 * デモ用L字断面サーフェスメッシュ(合成データ)。
 * L字断面ポリゴンをZ方向へ押し出した三角形メッシュを生成する。
 * ビューアのメッシュ表示・STL出力の動作確認用。
 */
export interface TriMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export function makeDemoLMesh(): TriMesh {
  // L字断面(反時計回り)。脚の厚さ6、辺長60。
  const poly: Array<[number, number]> = [
    [0, 0],
    [60, 0],
    [60, 6],
    [6, 6],
    [6, 60],
    [0, 60],
  ];
  const z0 = 0;
  const z1 = 40;
  const nv = poly.length;
  const positions = new Float32Array(nv * 2 * 3);
  for (let i = 0; i < nv; i++) {
    const [x, y] = poly[i];
    positions.set([x, y, z1], i * 3); // 前面 (0..5)
    positions.set([x, y, z0], (nv + i) * 3); // 背面 (6..11)
  }
  const idx: number[] = [];
  // 前面(+z, CCW): 頂点0からの扇形分割(この断面では凸分割として成立する)
  for (let i = 1; i < nv - 1; i++) idx.push(0, i, i + 1);
  // 背面(-z): 巻き方向を反転
  for (let i = 1; i < nv - 1; i++) idx.push(nv, nv + i + 1, nv + i);
  // 側面
  for (let i = 0; i < nv; i++) {
    const j = (i + 1) % nv;
    idx.push(i, nv + i, nv + j);
    idx.push(i, nv + j, j);
  }
  return { positions, indices: new Uint32Array(idx) };
}
