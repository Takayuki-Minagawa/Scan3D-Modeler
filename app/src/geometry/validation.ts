/** Geometry invariants shared by storage, imports, the viewer and exports. */
export function validatePositions(positions: Float32Array): void {
  if (positions.length === 0 || positions.length % 3 !== 0) {
    throw new Error('頂点座標は空でないXYZの組で指定してください');
  }
  for (const value of positions) {
    if (!Number.isFinite(value)) throw new Error('頂点座標に無効な値があります');
  }
}

export function validateMesh(positions: Float32Array, indices: Uint32Array): void {
  validatePositions(positions);
  if (indices.length === 0 || indices.length % 3 !== 0) {
    throw new Error('三角面は空でない3頂点の組で指定してください');
  }
  const vertexCount = positions.length / 3;
  for (const index of indices) {
    if (index >= vertexCount) throw new Error('三角面の頂点参照が不正です');
  }
}

export function decodePointCloud(buffer: ArrayBuffer): Float32Array {
  if (buffer.byteLength === 0 || buffer.byteLength % 12 !== 0) {
    throw new Error('点群データの長さが不正です');
  }
  const positions = new Float32Array(buffer);
  validatePositions(positions);
  return positions;
}
