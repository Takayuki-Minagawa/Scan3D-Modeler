import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeometryReport, diagnosticScale } from '../.test-build/report.mjs';
import { analyzeGeometry } from '../.test-build/diagnostics.mjs';
import { scaledPositions } from '../.test-build/scale.mjs';
import { inspectGeometryBlob, validateGeometryBlob } from '../.test-build/workerClient.mjs';

const entry = {
  asset: { id: 'asset-1', stageId: 'surface-1', name: 'part.stl', kind: 'mesh' },
  stage: { id: 'surface-1', sourceStageId: 'dense-1', origin: 'external', sourceFileName: 'original.stl' },
};
const project = {
  id: 'project-1', name: 'Part', unit: 'mm',
  scaleCalibration: { factor: 2, sourceStageId: 'dense-1', sourceAssetId: 'cloud-1' },
};
const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const indices = new Uint32Array([0, 1, 2]);

test('report records calibrated units, source, exact metrics and untested conditions', () => {
  const diagnostics = analyzeGeometry(scaledPositions(positions, diagnosticScale(project, entry).factor), indices);
  const report = createGeometryReport(project, entry, diagnostics, '2026-09-30T00:00:00.000Z');
  assert.equal(report.format, 'scan2fem-geometry-diagnostics');
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.source.assetId, 'asset-1');
  assert.equal(report.source.fileName, 'original.stl');
  assert.equal(report.source.origin, 'external');
  assert.equal(report.project.unit, 'mm');
  assert.deepEqual(report.scale, { factor: 2, status: 'calibrated' });
  assert.deepEqual(report.diagnostics.bounds.size, [2, 2, 0]);
  assert.equal(report.diagnostics.surfaceArea, 2);
  assert.ok(report.unchecked.includes('self-intersections'));
  assert.ok(report.unchecked.includes('FEM suitability'));
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  assert.deepEqual([...positions], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
});

test('unrelated calibration is never applied and legacy demo provenance is preserved', () => {
  const other = { ...entry, stage: { ...entry.stage, sourceStageId: null, demo: true, origin: undefined } };
  assert.deepEqual(diagnosticScale(project, other), { factor: 1, status: 'different-source' });
  assert.deepEqual(diagnosticScale({ ...project, scaleCalibration: undefined }, other), { factor: 1, status: 'not-calibrated' });
  assert.equal(createGeometryReport(project, other, analyzeGeometry(positions, indices)).source.origin, 'demo');
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

test('worker success releases resources and ZIP validation uses validation mode', async (t) => {
  const workers = mockWorker(t);
  const data = analyzeGeometry(positions, indices);
  const promise = inspectGeometryBlob(new Blob(), 'mesh', 2);
  assert.equal(workers[0].request.factor, 2);
  workers[0].onmessage({ data: { diagnostics: data } });
  assert.deepEqual(await promise, data);
  assert.equal(workers[0].terminated, 1);
  const validation = validateGeometryBlob(new Blob(), 'pointcloud');
  assert.equal(workers[1].request.mode, 'validate');
  workers[1].onmessage({ data: { diagnostics: null } });
  await validation;
  assert.equal(workers[1].terminated, 1);
});

test('cancel before start creates no worker; cancel during work terminates it', async (t) => {
  const workers = mockWorker(t);
  const before = new AbortController();
  before.abort();
  await assert.rejects(inspectGeometryBlob(new Blob(), 'mesh', 1, before.signal), { name: 'AbortError' });
  assert.equal(workers.length, 0);
  const during = new AbortController();
  const promise = inspectGeometryBlob(new Blob(), 'mesh', 1, during.signal);
  during.abort();
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(workers[0].terminated, 1);
});

test('worker runtime, decode, message and postMessage failures reject and terminate', async (t) => {
  const workers = mockWorker(t);
  for (const fail of [
    (w) => w.onerror(),
    (w) => w.onmessageerror(),
    (w) => w.onmessage({ data: { error: 'invalid geometry' } }),
    (w) => w.onmessage({ data: {} }),
    (w) => w.onmessage({ data: { diagnostics: null } }),
  ]) {
    const promise = inspectGeometryBlob(new Blob(), 'mesh', 1);
    const worker = workers.at(-1);
    fail(worker);
    await assert.rejects(promise);
    assert.equal(worker.terminated, 1);
  }
  globalThis.Worker.prototype.postMessage = () => { throw new Error('clone failed'); };
  await assert.rejects(inspectGeometryBlob(new Blob(), 'mesh', 1), /clone failed/);
  assert.equal(workers.at(-1).terminated, 1);
});

test('timeout terminates the worker and clears its timer', async (t) => {
  const workers = mockWorker(t);
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  let callback;
  let cleared = false;
  globalThis.setTimeout = (fn, ms) => { assert.equal(ms, 30_000); callback = fn; return 42; };
  globalThis.clearTimeout = (id) => { assert.equal(id, 42); cleared = true; };
  t.after(() => { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; });
  const promise = inspectGeometryBlob(new Blob(), 'mesh', 1);
  callback();
  await assert.rejects(promise, /時間切れ/);
  assert.equal(workers[0].terminated, 1);
  assert.equal(cleared, true);
});
