import { scaledPositions } from '../viewer/scale';
import { decodeStoredGeometry } from './data';
import { analyzeGeometry } from './diagnostics';
import type { GeometryWorkerRequest } from './workerClient';

self.onmessage = async (event: MessageEvent<GeometryWorkerRequest>) => {
  try {
    const { kind, blob, mode, factor } = event.data;
    const geometry = decodeStoredGeometry(kind, await blob.arrayBuffer());
    // Validation for ZIP restoration shares exactly the same decoder as inspection/export.
    const diagnostics = mode === 'validate' ? null : analyzeGeometry(
      scaledPositions(geometry.positions, factor), geometry.indices,
    );
    self.postMessage({ diagnostics });
  } catch (cause) {
    self.postMessage({ error: cause instanceof Error ? cause.message : String(cause) });
  }
};
