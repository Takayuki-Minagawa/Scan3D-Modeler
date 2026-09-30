import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeGeometry,
  TOPOLOGY_MAX_TRIANGLES,
  TOPOLOGY_MAX_VERTICES,
} from '../.test-build/diagnostics.mjs';

const tetraPositions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
const tetraIndices = new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * 1e-12,
    `Expected ${actual} to be approximately ${expected}`);
}

test('closed tetrahedron reports analytic bounds, area and shared edges without mutating input', () => {
  const originalPositions = tetraPositions.slice();
  const originalIndices = tetraIndices.slice();
  const report = analyzeGeometry(tetraPositions, tetraIndices);
  assert.equal(report.vertexCount, 4);
  assert.equal(report.triangleCount, 4);
  assert.deepEqual(report.bounds, { min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1] });
  near(report.surfaceArea, 1.5 + Math.sqrt(3) / 2);
  assert.equal(report.degenerateTriangles, 0);
  assert.equal(report.topologyStatus, 'checked');
  assert.equal(report.topologySkipReason, null);
  assert.deepEqual(report.topology, {
    uniqueVertexCount: 4,
    weldedVertexCount: 0,
    analyzedTriangles: 4,
    boundaryEdges: 0,
    nonManifoldEdges: 0,
    inconsistentWindingEdges: 0,
    duplicateTriangles: 0,
  });
  assert.deepEqual(tetraPositions, originalPositions);
  assert.deepEqual(tetraIndices, originalIndices);
});

test('open square has four boundary edges and consistent internal winding', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const report = analyzeGeometry(positions, new Uint32Array([0, 1, 2, 0, 2, 3]));
  assert.equal(report.surfaceArea, 1);
  assert.equal(report.topology.boundaryEdges, 4);
  assert.equal(report.topology.nonManifoldEdges, 0);
  assert.equal(report.topology.inconsistentWindingEdges, 0);
  const reversed = analyzeGeometry(positions, new Uint32Array([0, 1, 2, 0, 3, 2]));
  assert.equal(reversed.topology.inconsistentWindingEdges, 1);
});

test('STL-style separate vertices join only by exact coordinates for topology', () => {
  const positions = new Float32Array(tetraIndices.length * 3);
  const indices = Uint32Array.from(tetraIndices, (_, i) => i);
  for (let i = 0; i < tetraIndices.length; i++) {
    positions.set(tetraPositions.subarray(tetraIndices[i] * 3, tetraIndices[i] * 3 + 3), i * 3);
  }
  // Signed zero has the same geometric position.
  positions[0] = -0;
  const report = analyzeGeometry(positions, indices);
  assert.equal(report.vertexCount, 12);
  assert.equal(report.topology.uniqueVertexCount, 4);
  assert.equal(report.topology.weldedVertexCount, 8);
  assert.equal(report.topology.boundaryEdges, 0);
  assert.equal(report.topology.inconsistentWindingEdges, 0);
  near(report.surfaceArea, 1.5 + Math.sqrt(3) / 2);
});

test('collinear and repeated-vertex triangles count as degenerate and do not hide boundaries', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0]);
  const report = analyzeGeometry(positions, new Uint32Array([0, 1, 2, 0, 1, 3, 0, 0, 1]));
  assert.equal(report.triangleCount, 3);
  assert.equal(report.surfaceArea, 0.5);
  assert.equal(report.degenerateTriangles, 2);
  assert.equal(report.topology.analyzedTriangles, 1);
  assert.equal(report.topology.boundaryEdges, 3);
  assert.equal(report.topology.duplicateTriangles, 0);
  const emptyTopology = analyzeGeometry(positions, new Uint32Array([0, 0, 1]));
  assert.equal(emptyTopology.surfaceArea, 0);
  assert.equal(emptyTopology.degenerateTriangles, 1);
  assert.equal(emptyTopology.topology.analyzedTriangles, 0);
  assert.equal(emptyTopology.topology.boundaryEdges, 0);
});

test('tiny nonzero triangles survive without a tolerance or squared-length underflow', () => {
  const positions = new Float32Array([0, 0, 0, 1e-40, 0, 0, 0, 1e-40, 0]);
  const report = analyzeGeometry(positions, new Uint32Array([0, 1, 2]));
  assert.ok(report.surfaceArea > 0);
  near(report.surfaceArea, positions[3] * positions[7] / 2);
  assert.equal(report.degenerateTriangles, 0);
  assert.equal(report.topology.uniqueVertexCount, 3);
  assert.equal(report.topology.boundaryEdges, 3);
});

test('three incident faces identify a non-manifold edge separately from two-face winding', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1]);
  const report = analyzeGeometry(positions, new Uint32Array([0, 1, 2, 1, 0, 3, 0, 1, 4]));
  assert.equal(report.topology.nonManifoldEdges, 1);
  assert.equal(report.topology.boundaryEdges, 6);
  assert.equal(report.topology.inconsistentWindingEdges, 0);
});

test('duplicates are counted independent of triangle ordering and winding', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const report = analyzeGeometry(positions, new Uint32Array([0, 1, 2, 2, 0, 1, 2, 1, 0]));
  assert.equal(report.topology.duplicateTriangles, 2);
  assert.equal(report.topology.nonManifoldEdges, 3);
  assert.equal(report.surfaceArea, 1.5);
  const reversedCopy = analyzeGeometry(positions, new Uint32Array([0, 1, 2, 2, 1, 0]));
  assert.equal(reversedCopy.topology.duplicateTriangles, 1);
  assert.equal(reversedCopy.topology.inconsistentWindingEdges, 0);
});

test('point clouds have bounds but no invented surface or topology results', () => {
  const report = analyzeGeometry(new Float32Array([-2, 3, -4, 5, -6, 7]));
  assert.equal(report.vertexCount, 2);
  assert.equal(report.triangleCount, 0);
  assert.deepEqual(report.bounds, { min: [-2, -6, -4], max: [5, 3, 7], size: [7, 9, 11] });
  assert.equal(report.surfaceArea, null);
  assert.equal(report.degenerateTriangles, null);
  assert.equal(report.topology, null);
  assert.equal(report.topologyStatus, 'skipped');
  assert.equal(report.topologySkipReason, 'pointcloud');
});

test('scaled coordinates change lengths linearly and surface area quadratically', () => {
  const factor = 3;
  const report = analyzeGeometry(tetraPositions.map(value => value * factor), tetraIndices);
  assert.deepEqual(report.bounds.size, [3, 3, 3]);
  near(report.surfaceArea, (1.5 + Math.sqrt(3) / 2) * factor ** 2);
  assert.equal(report.topology.boundaryEdges, 0);
});

test('invalid coordinates and indices fail validation before diagnostics', () => {
  assert.throws(() => analyzeGeometry(new Float32Array()));
  assert.throws(() => analyzeGeometry(new Float32Array([0, 1])));
  assert.throws(() => analyzeGeometry(new Float32Array([NaN, 0, 0])));
  assert.throws(() => analyzeGeometry(new Float32Array([Infinity, 0, 0])));
  assert.throws(() => analyzeGeometry(tetraPositions, new Uint32Array()));
  assert.throws(() => analyzeGeometry(tetraPositions, new Uint32Array([0, 1])));
  assert.throws(() => analyzeGeometry(tetraPositions, new Uint32Array([0, 1, 4])));
});

test('vertex topology limit is inclusive, then reports skipped while preserving area and bounds', () => {
  assert.ok(TOPOLOGY_MAX_VERTICES <= 200_000);
  const positions = new Float32Array((TOPOLOGY_MAX_VERTICES + 1) * 3);
  positions.set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint32Array([0, 1, 2]);
  const within = analyzeGeometry(positions.subarray(0, TOPOLOGY_MAX_VERTICES * 3), indices);
  assert.equal(within.topologyStatus, 'checked');
  assert.equal(within.topology.uniqueVertexCount, 3);
  const over = analyzeGeometry(positions, indices);
  assert.equal(over.topology, null);
  assert.equal(over.topologyStatus, 'skipped');
  assert.equal(over.topologySkipReason, 'limit');
  assert.equal(over.surfaceArea, 0.5);
  assert.deepEqual(over.bounds.size, [1, 1, 0]);
});

test('triangle topology limit reports skipped independently of the vertex count', () => {
  assert.ok(TOPOLOGY_MAX_TRIANGLES <= 200_000);
  const count = TOPOLOGY_MAX_TRIANGLES + 1;
  const indices = new Uint32Array(count * 3);
  for (let i = 0; i < indices.length; i += 3) indices.set([0, 1, 2], i);
  const report = analyzeGeometry(tetraPositions, indices);
  assert.equal(report.topology, null);
  assert.equal(report.topologyStatus, 'skipped');
  assert.equal(report.topologySkipReason, 'limit');
  assert.equal(report.surfaceArea, count / 2);
  assert.equal(report.degenerateTriangles, 0);
});
