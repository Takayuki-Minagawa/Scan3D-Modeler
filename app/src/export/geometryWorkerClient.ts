import type { GeometryKind } from '../geometry/data';

export type GeometryExportMode = 'ply' | 'stl';

export interface GeometryExportRequest {
  blob: Blob;
  kind: GeometryKind;
  mode: GeometryExportMode;
  factor: number;
}

/** Decode, calibrate and encode off the UI thread; every completion releases the worker. */
export function exportGeometryBlob(
  blob: Blob, kind: GeometryKind, mode: GeometryExportMode, factor: number, signal?: AbortSignal,
): Promise<Blob> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => fail(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => fail(new Error('形状出力が時間切れになりました')), 30_000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ blob?: Blob; error?: string } | null>) => {
      if (settled) return;
      const result = event.data;
      if (typeof result?.error === 'string' && result.error) {
        fail(new Error(result.error));
        return;
      }
      if (!(result?.blob instanceof Blob) || result.blob.size === 0) {
        fail(new Error('形状出力の結果が不正です'));
        return;
      }
      settled = true;
      cleanup();
      resolve(result.blob);
    };
    worker.onerror = () => fail(new Error('形状出力ワーカーが停止しました'));
    worker.onmessageerror = () => fail(new Error('形状出力の結果が不正です'));
    if (signal?.aborted) { abort(); return; }
    try { worker.postMessage({ blob, kind, mode, factor } satisfies GeometryExportRequest); } catch (cause) {
      fail(cause instanceof Error ? cause : new Error(String(cause)));
    }
  });
}
