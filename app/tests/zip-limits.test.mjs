import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, Zip, ZipPassThrough } from 'fflate';
import {
  allowedEntryName,
  MAX_ENTRIES,
  MAX_ENTRY_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_ZIP_BYTES,
  validateZipExportLayout,
} from '../.test-build/zipLimits.mjs';

function streamedZipBytes(entries) {
  let bytes = 0;
  let finished = false;
  const zip = new Zip((error, chunk, final) => {
    if (error) throw error;
    bytes += chunk.length;
    finished ||= final;
  });
  for (const [name, data] of entries) {
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    // Match the streaming exporter, including non-final chunks and a data descriptor.
    entry.push(data.subarray(0, 1));
    entry.push(data.subarray(1), true);
  }
  zip.end();
  assert.equal(finished, true);
  return bytes;
}

test('export preflight matches actual fflate ZIP headers, descriptors, names and EOF', () => {
  const manifest = strToU8(JSON.stringify({ name: '計測プロジェクト 🔬' }));
  const cases = [[], [{ id: 'a', size: 0 }], [
    { id: '550e8400-e29b-41d4-a716-446655440000', size: 3 },
    { id: 'Z'.repeat(128), size: 17 },
  ]];
  for (const assets of cases) {
    const layout = validateZipExportLayout(manifest.byteLength, assets);
    const entries = [['project.json', manifest], ...assets.map(({ id, size }) => [
      `assets/${id}`, new Uint8Array(size),
    ])];
    assert.equal(layout.zipBytes, streamedZipBytes(entries));
    assert.equal(layout.entryCount, entries.length);
    assert.equal(layout.expandedBytes, manifest.length + assets.reduce((sum, a) => sum + a.size, 0));
  }
});

test('asset and manifest limits include the exact boundary without allocating the payload', () => {
  assert.doesNotThrow(() => validateZipExportLayout(MAX_MANIFEST_BYTES, [
    { id: 'video', size: MAX_ENTRY_BYTES },
  ]));
  assert.throws(() => validateZipExportLayout(MAX_MANIFEST_BYTES + 1, []), /8MiB/);
  assert.throws(() => validateZipExportLayout(1, [{ id: 'video', size: MAX_ENTRY_BYTES + 1 }]), /256MiB/);
  for (const size of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateZipExportLayout(1, [{ id: 'a', size }]), /サイズが不正/);
    assert.throws(() => validateZipExportLayout(size, []), /プロジェクト情報/);
  }
  assert.throws(() => validateZipExportLayout(0, []), /プロジェクト情報/);
});

test('the manifest counts toward the entry limit', () => {
  const assets = Array.from({ length: MAX_ENTRIES - 1 }, (_, i) => ({ id: `a${i}`, size: 0 }));
  assert.equal(validateZipExportLayout(1, assets).entryCount, MAX_ENTRIES);
  assert.throws(() => validateZipExportLayout(1, [...assets, { id: 'overflow', size: 0 }]), /9,999件/);
});

test('archive size includes metadata and ZIP overhead at the 1 GiB boundary', () => {
  const manifestSize = 101;
  const assets = ['a', 'b', 'c', 'd'].map((id) => ({ id, size: 0 }));
  const overhead = validateZipExportLayout(manifestSize, assets).zipBytes;
  for (let i = 0; i < 3; i++) assets[i].size = MAX_ENTRY_BYTES;
  assets[3].size = MAX_ZIP_BYTES - overhead - 3 * MAX_ENTRY_BYTES;
  const layout = validateZipExportLayout(manifestSize, assets);
  assert.equal(layout.zipBytes, MAX_ZIP_BYTES);
  assert.ok(layout.expandedBytes < MAX_ZIP_BYTES);
  assets[3].size++;
  assert.throws(() => validateZipExportLayout(manifestSize, assets), /1GiB/);
  // Even payload bytes that exactly equal the import limit cannot fit their ZIP headers.
  assets.forEach((asset) => { asset.size = MAX_ENTRY_BYTES; });
  assert.throws(() => validateZipExportLayout(manifestSize, assets), /1GiB/);
});

test('archive entry names are shared with import and exclude path traversal, Unicode and duplicate IDs', () => {
  for (const id of ['x', 'A_0-z', 'a'.repeat(128)]) {
    assert.equal(allowedEntryName(`assets/${id}`), true);
    assert.doesNotThrow(() => validateZipExportLayout(1, [{ id, size: 0 }]));
  }
  assert.equal(allowedEntryName('project.json'), true);
  for (const id of ['', '..', '../x', 'x/y', 'x\\y', 'x\n', 'x\r', 'x\u0000', '日本語', 'a'.repeat(129)]) {
    assert.equal(allowedEntryName(`assets/${id}`), false);
    assert.throws(() => validateZipExportLayout(1, [{ id, size: 0 }]), /アセットID/);
  }
  for (const name of ['project.json\n', 'project.json/child', '/project.json', 'extra.json']) {
    assert.equal(allowedEntryName(name), false);
  }
  assert.throws(() => validateZipExportLayout(1, [{ id: 'a', size: 0 }, { id: 'a', size: 0 }]), /重複/);
});
