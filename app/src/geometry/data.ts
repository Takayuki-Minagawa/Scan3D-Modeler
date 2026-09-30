import { decodeMeshBinary } from '../export/formats';
import { decodePointCloud } from './validation';

export type GeometryKind = 'pointcloud' | 'mesh';

/** One validation boundary for stored geometry, independent of IndexedDB and the UI. */
export function decodeStoredGeometry(kind: GeometryKind, buffer: ArrayBuffer): {
  positions: Float32Array;
  indices?: Uint32Array;
} {
  return kind === 'mesh'
    ? decodeMeshBinary(buffer)
    : { positions: decodePointCloud(buffer) };
}
