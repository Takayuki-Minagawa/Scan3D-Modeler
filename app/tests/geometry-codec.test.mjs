import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeMeshBinary, encodeMeshBinary, plyFromPoints, stlFromMesh } from '../.test-build/formats.mjs';
import { decodePointCloud, validatePositions, validateMesh } from '../.test-build/validation.mjs';
import { scaledPositions } from '../.test-build/scale.mjs';
import { parseExternalGeometry } from '../.test-build/externalGeometry.mjs';

const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const indices = new Uint32Array([0, 1, 2]);
const meshBuffer = () => encodeMeshBinary(positions, indices);
const parsePly = (parts, inputUnit = 'mm', coordinateUnit = 'mm') =>
  parseExternalGeometry(new File(Array.isArray(parts) ? parts : [parts], 'shape.ply'), inputUnit, coordinateUnit);

function asciiPly({ vertexCount = 3, faceCount = 1, faceProperties = '', body = '0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n' } = {}) {
  return `ply\nformat ascii 1.0\nelement vertex ${vertexCount}\nproperty float x\nproperty float y\nproperty float z\nelement face ${faceCount}\nproperty list uchar int vertex_indices\n${faceProperties}end_header\n${body}`;
}

test('mesh codec round-trips data and rejects malformed headers, lengths and triangle indices', () => {
  const decoded = decodeMeshBinary(meshBuffer());
  assert.deepEqual(decoded.positions, positions);
  assert.deepEqual(decoded.indices, indices);
  assert.throws(() => decodeMeshBinary(new ArrayBuffer(4)), /ヘッダ/);
  assert.throws(() => decodeMeshBinary(meshBuffer().slice(0, -1)), /長さ/);
  const trailing = new Uint8Array(meshBuffer().byteLength + 4);
  trailing.set(new Uint8Array(meshBuffer()));
  assert.throws(() => decodeMeshBinary(trailing.buffer), /長さ/);
  const declared = meshBuffer();
  new Uint32Array(declared)[0] = 0xffffffff;
  assert.throws(() => decodeMeshBinary(declared), /頂点数/);
  const invalidIndex = meshBuffer();
  new Uint32Array(invalidIndex, 8 + positions.byteLength)[2] = 3;
  assert.throws(() => decodeMeshBinary(invalidIndex), /頂点参照/);
  const invalidPosition = meshBuffer();
  new Float32Array(invalidPosition, 8)[0] = NaN;
  assert.throws(() => decodeMeshBinary(invalidPosition), /座標/);
});

test('point cloud and exporters reject partial, empty, and nonfinite geometry', () => {
  assert.deepEqual(decodePointCloud(positions.buffer.slice(0)), positions);
  for (const length of [0, 4, 8, 13]) assert.throws(() => decodePointCloud(new ArrayBuffer(length)));
  assert.throws(() => validatePositions(new Float32Array([1, 2])), /XYZ/);
  assert.throws(() => validateMesh(positions, new Uint32Array([0, 1])), /3頂点/);
  assert.throws(() => plyFromPoints(new Float32Array([Infinity, 0, 0])), /座標/);
  assert.throws(() => stlFromMesh(positions, new Uint32Array([0, 1, 99])), /頂点参照/);
  assert.throws(() => encodeMeshBinary(positions, new Uint32Array()), /3頂点/);
});

test('scale conversion preserves originals and rejects Float32 overflow and invalid input even at factor 1', () => {
  const original = positions.slice();
  assert.deepEqual(scaledPositions(positions, 2), new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]));
  assert.deepEqual(positions, original);
  assert.throws(() => scaledPositions(new Float32Array([3e38, 0, 0]), 2), /有効範囲/);
  assert.throws(() => scaledPositions(new Float32Array([NaN, 0, 0]), 1), /座標/);
});

test('PLY retains faces with face color and UV properties', async () => {
  const result = await parsePly(asciiPly({
    faceProperties: 'property uchar red\nproperty uchar green\nproperty uchar blue\nproperty list uchar float texcoord\n',
    body: '0 0 0\n1 0 0\n0 1 0\n3 0 1 2 255 0 0 6 0 0 1 0 0 1\n',
  }));
  assert.equal(result.kind, 'mesh');
  assert.deepEqual(result.positions, positions);
  assert.deepEqual(result.indices, indices);
});

test('PLY triangle, quad and point-cloud inputs retain units and supported topology', async () => {
  const result = await parsePly(asciiPly(), 'cm', 'mm');
  assert.equal(result.positions[3], 10);
  const quad = await parsePly(asciiPly({ vertexCount: 4, body: '0 0 0\n1 0 0\n1 1 0\n0 1 0\n4 0 1 2 3\n' }));
  assert.deepEqual(quad.indices, new Uint32Array([0, 1, 3, 1, 2, 3]));
  const pointFile = await plyFromPoints(positions).arrayBuffer();
  const points = await parsePly(pointFile);
  assert.equal(points.kind, 'pointcloud');
  assert.deepEqual(points.positions, positions);
});

test('PLY rejects incomplete, unsupported and invalid shape input before accepting partial geometry', async () => {
  await assert.rejects(parsePly(asciiPly({ vertexCount: 4, body: '0 0 0\n1 0 0\n0 1 0\n' })), /不足/);
  await assert.rejects(parsePly(asciiPly({ body: '0 0 0\n1 0 0\n0 1 0\n3 0 1\n' })), /不足/);
  await assert.rejects(parsePly(asciiPly({ vertexCount: 5, body: '0 0 0\n1 0 0\n1 1 0\n0 1 0\n0 2 0\n5 0 1 2 3 4\n' })), /三角形または四角形/);
  await assert.rejects(parsePly(asciiPly({ body: '0 0 0\n1 0 0\n0 1 0\n3 -1 1 2\n' })), /頂点参照/);
  await assert.rejects(parsePly(asciiPly({ body: '0 0 0\n1 0 0\n0 1 0\n3 0 1 3\n' })), /頂点参照/);
  await assert.rejects(parsePly(asciiPly({ body: '0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n99\n' })), /一致しません/);
  await assert.rejects(parsePly(asciiPly().replace('0 0 0', 'NaN 0 0')), /不正な数値/);
  await assert.rejects(parsePly(asciiPly().replace('element vertex 3', 'element vertex 1000001')), /上限/);
  await assert.rejects(parsePly(asciiPly().replace('property float x', 'property constructor x')), /プロパティ/);
});

for (const little of [true, false]) {
  test(`binary PLY ${little ? 'little' : 'big'} endian validates exact payload and face indices`, async () => {
    const header = `ply\nformat binary_${little ? 'little' : 'big'}_endian 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n`;
    const bytes = new ArrayBuffer(positions.byteLength + 13);
    const view = new DataView(bytes);
    for (let i = 0; i < positions.length; i++) view.setFloat32(i * 4, positions[i], little);
    view.setUint8(36, 3);
    for (let i = 0; i < indices.length; i++) view.setInt32(37 + i * 4, indices[i], little);
    const parsed = await parsePly([header, bytes]);
    assert.deepEqual(parsed.positions, positions);
    assert.deepEqual(parsed.indices, indices);
    await assert.rejects(parsePly([header, bytes.slice(0, -1)]), /不足/);
    view.setInt32(45, -1, little);
    await assert.rejects(parsePly([header, bytes]), /頂点参照/);
  });
}

test('binary STL exports still reimport as mesh after shared geometry validation', async () => {
  const stl = stlFromMesh(positions, indices);
  const parsed = await parseExternalGeometry(new File([stl], 'triangle.stl'), 'mm', 'mm');
  assert.equal(parsed.kind, 'mesh');
  assert.deepEqual(parsed.positions, positions);
  assert.deepEqual(parsed.indices, indices);
});
test('binary PLY preserves a payload starting with LF after CR-only headers', async () => {
  for (const newline of ['\r', '\n', '\r\n']) {
    const header = new TextEncoder().encode([
      'ply', 'format binary_little_endian 1.0', 'comment 日本語コメント',
      'element vertex 1', 'property float x', 'property float y', 'property float z', 'end_header', '',
    ].join(newline));
    const bytes = new Uint8Array(header.length + 12);
    bytes.set(header);
    const payload = new DataView(bytes.buffer, header.length);
    payload.setUint32(0, 0x3f80000a, true);
    payload.setFloat32(4, 2, true);
    payload.setFloat32(8, 3, true);
    const parsed = await parseExternalGeometry(new File([bytes], 'cr-header.ply'), 'mm', 'mm');
    assert.deepEqual([...parsed.positions], [Math.fround(1.0000011920928955), 2, 3]);
  }
});
