import { decodeStoredGeometry } from '../geometry/data';
import { scaledPositions } from '../viewer/scale';
import { plyFromMesh, plyFromPoints, stlFromMesh } from './formats';
import type { GeometryExportRequest } from './geometryWorkerClient';

self.onmessage = async (event: MessageEvent<GeometryExportRequest>) => {
  try {
    const { blob, kind, mode, factor } = event.data;
    if ((kind !== 'pointcloud' && kind !== 'mesh') ||
        (mode !== 'ply' && mode !== 'stl') || (kind === 'pointcloud' && mode === 'stl')) {
      throw new Error('形状の種類と出力形式の組み合わせが不正です');
    }
    const geometry = decodeStoredGeometry(kind, await blob.arrayBuffer());
    const positions = scaledPositions(geometry.positions, factor);
    const output = kind === 'pointcloud' ? plyFromPoints(positions)
      : mode === 'ply' ? plyFromMesh(positions, geometry.indices!)
      : stlFromMesh(positions, geometry.indices!);
    self.postMessage({ blob: output });
  } catch (cause) {
    self.postMessage({ error: cause instanceof Error ? cause.message : String(cause) });
  }
};
