import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeMeshBinary, plyFromMesh, plyFromPoints } from '../.test-build/formats.mjs';
import { parseExternalGeometry } from '../.test-build/externalGeometry.mjs';
import { exportGeometryBlob } from '../.test-build/geometryExportClient.mjs';

const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
const indices = new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]);
const parseExport = (blob, extension = 'ply') =>
  parseExternalGeometry(new File([blob], `export.${extension}`), 'mm', 'mm');

// Execute the production worker handler with the same Blob/message interface.
const previousSelf = globalThis.self;
const workerScope = {};
globalThis.self = workerScope;
await import('../.test-build/geometryExportWorker.mjs');
globalThis.self = previousSelf;
async function runWorker(request) {
  const original = globalThis.self;
  const messages = [];
  globalThis.self = { postMessage: (result) => messages.push(result) };
  try {
    await workerScope.onmessage({ data: request });
    assert.equal(messages.length, 1);
    return messages[0];
  } finally {
    globalThis.self = original;
  }
}

test('binary surface PLY round-trip preserves shared vertices, winding and unused vertices', async () => {
  const withUnusedVertex = new Float32Array([...positions, 5.5, -7.25, 9]);
  const blob = plyFromMesh(withUnusedVertex, indices);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const headerEnd = new TextEncoder().encode('end_header\n');
  const headerLength = bytes.findIndex((_, offset) => headerEnd.every((value, i) => bytes[offset + i] === value))
    + headerEnd.length;
  const header = new TextDecoder().decode(bytes.subarray(0, headerLength));
  assert.match(header, /format binary_little_endian 1.0/);
  assert.match(header, /element vertex 5/);
  assert.match(header, /element face 4/);
  assert.match(header, /property list uchar uint vertex_indices/);
  assert.equal(blob.size, headerLength + withUnusedVertex.byteLength + 13 * 4);
  const payload = new DataView(bytes.buffer, headerLength);
  assert.equal(payload.getFloat32(12 * 4, true), 5.5);
  assert.equal(payload.getUint8(withUnusedVertex.byteLength), 3);
  assert.equal(payload.getUint32(withUnusedVertex.byteLength + 5, true), 2);
  const parsed = await parseExport(blob);
  assert.equal(parsed.kind, 'mesh');
  assert.deepEqual(parsed.positions, withUnusedVertex);
  assert.deepEqual(parsed.indices, indices);
  assert.deepEqual(withUnusedVertex, new Float32Array([...positions, 5.5, -7.25, 9]));
  assert.deepEqual(indices, new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]));
});

test('point-cloud PLY shares binary encoding without fabricating faces; invalid surfaces are refused', async () => {
  const parsed = await parseExport(plyFromPoints(positions));
  assert.equal(parsed.kind, 'pointcloud');
  assert.deepEqual(parsed.positions, positions);
  assert.equal(parsed.indices, undefined);
  assert.throws(() => plyFromMesh(new Float32Array([NaN, 0, 0]), new Uint32Array([0, 0, 0])), /座標/);
  assert.throws(() => plyFromMesh(positions, new Uint32Array()), /3頂点/);
  assert.throws(() => plyFromMesh(positions, new Uint32Array([0, 1, 4])), /頂点参照/);
});

test('export worker calibrates point PLY, surface PLY and STL without modifying stored bytes', async () => {
  for (const [kind, mode] of [['pointcloud', 'ply'], ['mesh', 'ply'], ['mesh', 'stl']]) {
    const source = kind === 'mesh' ? encodeMeshBinary(positions, indices) : positions.buffer.slice(0);
    const originalBytes = new Uint8Array(source.slice(0));
    const input = new Blob([source]);
    const result = await runWorker({ blob: input, kind, mode, factor: 2.5 });
    assert.equal(result.error, undefined);
    const parsed = await parseExport(result.blob, mode);
    assert.equal(parsed.kind, kind);
    if (mode === 'ply') {
      assert.deepEqual(parsed.positions, positions.map((value) => value * 2.5));
      assert.deepEqual(parsed.indices, kind === 'mesh' ? indices : undefined);
    } else {
      assert.equal(parsed.indices.length, indices.length);
      assert.deepEqual(parsed.positions, Float32Array.from(
        [...indices].flatMap((index) => [...positions.subarray(index * 3, index * 3 + 3)].map((value) => value * 2.5)),
      ));
    }
    assert.deepEqual(new Uint8Array(await input.arrayBuffer()), originalBytes);
    assert.deepEqual(new Uint8Array(source), originalBytes);
  }
});

test('export worker rejects unsupported modes, corrupt stored geometry and invalid calibration', async () => {
  const valid = { blob: new Blob([encodeMeshBinary(positions, indices)]), kind: 'mesh', mode: 'ply', factor: 1 };
  for (const request of [
    { ...valid, kind: 'pointcloud', mode: 'stl' },
    { ...valid, kind: 'unknown' },
    { ...valid, mode: 'unknown' },
  ]) {
    assert.match((await runWorker(request)).error, /組み合わせ/);
  }
  assert.match((await runWorker({ ...valid, blob: new Blob([new Uint8Array(4)]) })).error, /ヘッダ/);
  assert.match((await runWorker({ ...valid, factor: 0 })).error, /倍率/);
  const overflow = new Blob([new Float32Array([3e38, 0, 0])]);
  assert.match((await runWorker({ ...valid, blob: overflow, kind: 'pointcloud', factor: 2 })).error, /有効範囲/);
  const nonfinite = new Blob([new Float32Array([NaN, 0, 0])]);
  assert.match((await runWorker({ ...valid, blob: nonfinite, kind: 'pointcloud' })).error, /座標/);
});

function mockWorker(t) {
  const original = globalThis.Worker;
  const instances = [];
  class Worker {
    terminated = 0;
    constructor() { instances.push(this); }
    postMessage(request) { this.request = request; }
    terminate() { this.terminated++; }
  }
  globalThis.Worker = Worker;
  t.after(() => { globalThis.Worker = original; });
  return instances;
}

test('export client forwards source Blob and calibration; success terminates once and ignores later abort', async (t) => {
  const workers = mockWorker(t);
  const input = new Blob([encodeMeshBinary(positions, indices)]);
  const result = plyFromMesh(positions, indices);
  const controller = new AbortController();
  const promise = exportGeometryBlob(input, 'mesh', 'ply', 2, controller.signal);
  assert.deepEqual(workers[0].request, { blob: input, kind: 'mesh', mode: 'ply', factor: 2 });
  workers[0].onmessage({ data: { blob: result } });
  assert.equal(await promise, result);
  controller.abort();
  assert.equal(workers[0].terminated, 1);
  assert.equal(workers[0].onmessage, null);
});

test('export client cancels before creation and terminates running work', async (t) => {
  const workers = mockWorker(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(exportGeometryBlob(new Blob(), 'mesh', 'ply', 1, controller.signal), { name: 'AbortError' });
  assert.equal(workers.length, 0);
  const running = new AbortController();
  const promise = exportGeometryBlob(new Blob(), 'mesh', 'stl', 1, running.signal);
  running.abort();
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(workers[0].terminated, 1);
});

test('export client releases workers on runtime, message, decode and clone errors', async (t) => {
  const workers = mockWorker(t);
  for (const fail of [
    (worker) => worker.onerror(),
    (worker) => worker.onmessageerror(),
    (worker) => worker.onmessage({ data: { error: 'Invalid geometry' } }),
    (worker) => worker.onmessage({ data: {} }),
    (worker) => worker.onmessage({ data: null }),
    (worker) => worker.onmessage({ data: { blob: new Blob() } }),
    (worker) => worker.onmessage({ data: { blob: 'bad result' } }),
  ]) {
    const promise = exportGeometryBlob(new Blob(), 'mesh', 'ply', 1);
    fail(workers.at(-1));
    await assert.rejects(promise);
    assert.equal(workers.at(-1).terminated, 1);
  }
  globalThis.Worker.prototype.postMessage = () => { throw new Error('clone failed'); };
  await assert.rejects(exportGeometryBlob(new Blob(), 'mesh', 'ply', 1), /clone failed/);
  assert.equal(workers.at(-1).terminated, 1);
});

test('export client timeout terminates once and clears the timeout', async (t) => {
  const workers = mockWorker(t);
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  let timeout;
  let clears = 0;
  globalThis.setTimeout = (callback, milliseconds) => {
    assert.equal(milliseconds, 30_000);
    timeout = callback;
    return 13;
  };
  globalThis.clearTimeout = (id) => { assert.equal(id, 13); clears++; };
  t.after(() => { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; });
  const controller = new AbortController();
  const promise = exportGeometryBlob(new Blob(), 'mesh', 'ply', 1, controller.signal);
  timeout();
  controller.abort();
  await assert.rejects(promise, /時間切れ/);
  assert.equal(workers[0].terminated, 1);
  assert.equal(clears, 1);
});
