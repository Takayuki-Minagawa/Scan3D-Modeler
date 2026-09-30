import type { GeometryKind } from './data';
import type { GeometryDiagnostics } from './diagnostics';

export interface GeometryWorkerRequest {
  kind: GeometryKind;
  blob: Blob;
  mode: 'inspect' | 'validate';
  factor: number;
}

/** A bounded, read-only inspection; cancel/timeout always releases the worker and its arrays. */
function run(request: GeometryWorkerRequest, signal?: AbortSignal): Promise<GeometryDiagnostics | null> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./inspect.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const abort = () => fail(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => fail(new Error('形状診断が時間切れになりました')), 30_000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ diagnostics?: GeometryDiagnostics | null; error?: string }>) => {
      if (event.data.error) { fail(new Error(event.data.error)); return; }
      if (event.data.diagnostics === undefined ||
          (request.mode === 'inspect' && event.data.diagnostics === null)) {
        fail(new Error('形状診断の結果が不正です'));
        return;
      }
      cleanup();
      resolve(event.data.diagnostics);
    };
    worker.onerror = () => fail(new Error('形状診断ワーカーが停止しました'));
    worker.onmessageerror = () => fail(new Error('形状診断の結果が不正です'));
    try { worker.postMessage(request); } catch (cause) {
      fail(cause instanceof Error ? cause : new Error(String(cause)));
    }
  });
}

export async function inspectGeometryBlob(
  blob: Blob, kind: GeometryKind, factor: number, signal?: AbortSignal,
): Promise<GeometryDiagnostics> {
  return (await run({ blob, kind, factor, mode: 'inspect' }, signal))!;
}

export async function validateGeometryBlob(blob: Blob, kind: GeometryKind): Promise<void> {
  await run({ blob, kind, factor: 1, mode: 'validate' });
}
