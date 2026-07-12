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
  // デモ点群(demoCloud.worker)と同じ配置のL字形状:
  //   底板 x:[0,60], y:[0,6],  z:[0,40] / 立板 x:[0,60], y:[0,60], z:[34,40]
  // 断面(z,y)平面のL字ポリゴンをx方向(0→60)へ押し出す。穴は省略(簡略形状)。
  const profile: Array<[number, number]> = [
    // [z, y] 反時計回り
    [0, 0],
    [40, 0],
    [40, 60],
    [34, 60],
    [34, 6],
    [0, 6],
  ];
  // 凹多角形のため手動三角形分割(底板2枚+立板2枚)
  const faceTris: Array<[number, number, number]> = [
    [0, 1, 4],
    [0, 4, 5],
    [4, 1, 2],
    [4, 2, 3],
  ];
  const x0 = 0;
  const x1 = 60;
  const nv = profile.length;
  const positions = new Float32Array(nv * 2 * 3);
  for (let i = 0; i < nv; i++) {
    const [z, y] = profile[i];
    positions.set([x0, y, z], i * 3); // x=0側 (0..5)
    positions.set([x1, y, z], (nv + i) * 3); // x=60側 (6..11)
  }
  const idx: number[] = [];
  // x=0端面(外向き-x)
  for (const [a, b, c] of faceTris) idx.push(a, b, c);
  // x=60端面(外向き+x: 巻き方向を反転)
  for (const [a, b, c] of faceTris) idx.push(nv + a, nv + c, nv + b);
  // 側面(プロファイル各辺を押し出した四角形)
  for (let i = 0; i < nv; i++) {
    const j = (i + 1) % nv;
    idx.push(i, nv + j, j);
    idx.push(i, nv + i, nv + j);
  }
  return { positions, indices: new Uint32Array(idx) };
}
