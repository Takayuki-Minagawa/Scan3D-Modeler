import assert from 'node:assert/strict';
import test from 'node:test';
import { parseExternalGeometry } from '../.test-build/externalGeometry.mjs';
import { stlFromMesh } from '../.test-build/formats.mjs';
import { parseStl } from '../.test-build/stl.mjs';

const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const indices = new Uint32Array([0, 1, 2]);
const facet = 'facet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\n';
const ascii = (body = facet) => `solid sample\n${body}endsolid sample\n`;
const parse = (parts, inputUnit = 'mm', coordinateUnit = 'mm') =>
  parseExternalGeometry(new File(Array.isArray(parts) ? parts : [parts], 'shape.stl'), inputUnit, coordinateUnit);

test('ASCII STL retains complete facets, multiple solids, BOM, line endings and units', async () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    const source = '\uFEFF  \t' + (ascii() + '\n' + ascii()).replaceAll('\n', newline);
    const parsed = await parse(source, 'cm', 'mm');
    assert.equal(parsed.kind, 'mesh');
    assert.deepEqual(parsed.positions, new Float32Array([...positions, ...positions].map((value) => value * 10)));
    assert.deepEqual(parsed.indices, new Uint32Array([0, 1, 2, 3, 4, 5]));
  }
  const scientific = await parse(ascii(facet.replace('vertex 1 0 0', 'vertex +1e0 -.0 .0')));
  assert.equal(scientific.positions[3], 1);
  assert.equal(scientific.positions[5], 0);
});

test('ASCII STL rejects incomplete facets instead of silently saving the complete prefix', async () => {
  const malformed = [
    ascii(facet + 'facet normal 0 0 1\nouter loop\nvertex 2 2 2\n'),
    ascii(facet + 'invalid content\n'),
    ascii(facet.replace('outer loop\n', '')),
    ascii(facet.replace('endloop\n', '')),
    ascii(facet.replace('endfacet\n', '')),
    ascii(facet.replace('vertex 0 1 0\n', '')),
    ascii(facet.replace('endloop', 'vertex 0 0 1\nendloop')),
    ascii().replace('endsolid sample\n', ''),
    ascii() + 'trailing garbage',
    ascii() + 'solid incomplete\n',
    ascii(facet.replace('facet normal 0 0 1', 'facet')),
    // A total multiple of three vertices must not hide malformed individual facets.
    ascii(facet.replace('vertex 0 1 0\n', '') + facet.replace('endloop', 'vertex 0 0 1\nendloop')),
  ];
  for (const source of malformed) await assert.rejects(parse(source), /STLの構文/);
  await assert.rejects(parse(ascii('')), /STLの面数/);
});

test('ASCII STL rejects invalid normal and vertex numbers and scaled coordinate overflow', async () => {
  for (const value of ['NaN', 'Infinity', '1e999', '1e40', '1garbage', '.']) {
    await assert.rejects(parse(ascii(facet.replace('normal 0 0 1', `normal ${value} 0 1`))), /STLに不正な数値/);
    await assert.rejects(parse(ascii(facet.replace('vertex 1 0 0', `vertex ${value} 0 0`))), /STLに不正な数値/);
  }
  await assert.rejects(parse(ascii(facet.replace('vertex 1 0 0', 'vertex 3e38 0 0')), 'm', 'mm'), /座標/);
  // Zero normals and degenerate faces are geometry-diagnostic concerns, not syntax errors.
  const degenerate = await parse(ascii(facet.replace('normal 0 0 1', 'normal 0 0 0').replace('vertex 0 1 0', 'vertex 1 0 0')));
  assert.equal(degenerate.indices.length, 3);
});

test('binary STL accepts a solid-prefixed header and ignores binary color attribute variants', async () => {
  const buffer = await stlFromMesh(positions, indices).arrayBuffer();
  new Uint8Array(buffer, 0, 5).set(new TextEncoder().encode('solid'));
  new DataView(buffer).setUint16(132, 0xffff, true);
  const parsed = await parse(buffer);
  assert.deepEqual(parsed.positions, positions);
  assert.deepEqual(parsed.indices, indices);
});

test('binary STL rejects missing bytes, surplus bytes and mismatched declared facet counts', async () => {
  const original = new Uint8Array(await stlFromMesh(positions, indices).arrayBuffer());
  for (const solidHeader of [false, true]) {
    const bytes = original.slice();
    if (solidHeader) bytes.set(new TextEncoder().encode('solid'));
    const excess = new Uint8Array(bytes.length + 50);
    excess.set(bytes);
    for (const malformed of [bytes.slice(0, -1), bytes.slice(0, 80), excess]) {
      await assert.rejects(parse(malformed));
    }
    for (const count of [0, 2, 0xffffffff]) {
      const malformed = bytes.slice();
      new DataView(malformed.buffer).setUint32(80, count, true);
      await assert.rejects(parse(malformed));
    }
  }
  await assert.rejects(parse(new Uint8Array([1, 2, 3])), /STLの面数/);
  await assert.rejects(parse(new Uint8Array(84)), /STLの面数/);
});

test('binary STL rejects nonfinite normals or vertices before exposing geometry', async () => {
  for (const offset of [84, 96, 128]) {
    for (const value of [NaN, Infinity, -Infinity]) {
      const buffer = await stlFromMesh(positions, indices).arrayBuffer();
      new DataView(buffer).setFloat32(offset, value, true);
      await assert.rejects(parse(buffer), /STLに不正な数値/);
    }
  }
});

test('STL enforces both triangle and expanded vertex limits before output allocation', async () => {
  const binary = await stlFromMesh(positions, indices).arrayBuffer();
  const text = new TextEncoder().encode(ascii()).buffer;
  for (const buffer of [binary, text]) {
    assert.throws(() => parseStl(buffer, 1, { maxVertices: 2, maxTriangles: 1 }), /STLの面数/);
    assert.throws(() => parseStl(buffer, 1, { maxVertices: 3, maxTriangles: 0 }), /STLの面数/);
    assert.deepEqual(parseStl(buffer, 1, { maxVertices: 3, maxTriangles: 1 }).positions, positions);
  }
});
