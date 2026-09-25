import type { Unit } from '../types';
import { parseExternalGeometry } from './externalGeometry';

self.onmessage = async (event: MessageEvent<{ file: File; inputUnit: Unit; coordinateUnit: Unit }>) => {
  try {
    const parsed = await parseExternalGeometry(
      event.data.file,
      event.data.inputUnit,
      event.data.coordinateUnit,
    );
    const transfers: Transferable[] = [parsed.positions.buffer as ArrayBuffer];
    if (parsed.indices) transfers.push(parsed.indices.buffer as ArrayBuffer);
    (self as unknown as Worker).postMessage({ parsed }, transfers);
  } catch (cause) {
    (self as unknown as Worker).postMessage({ error: cause instanceof Error ? cause.message : String(cause) });
  }
};
