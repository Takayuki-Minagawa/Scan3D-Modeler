import { validateMesh, validatePositions } from './validation';

// Bound the coordinate map and sorting buffers independently of import limits.
export const TOPOLOGY_MAX_VERTICES = 200_000;
export const TOPOLOGY_MAX_TRIANGLES = 200_000;

export type GeometryTriple = [number, number, number];

export interface GeometryTopology {
  /** All stored vertices after grouping exactly equal XYZ coordinates. */
  uniqueVertexCount: number;
  /** Stored vertices sharing an earlier vertex's exact XYZ coordinates. */
  weldedVertexCount: number;
  /** Zero-area triangles are excluded from all topology counts below. */
  analyzedTriangles: number;
  /** Undirected edges incident to exactly one non-degenerate triangle. */
  boundaryEdges: number;
  /** Undirected edges incident to more than two non-degenerate triangles. */
  nonManifoldEdges: number;
  /** Two-face edges traversed in the same direction by both faces. */
  inconsistentWindingEdges: number;
  /** Additional copies of an unordered triangle, regardless of winding. */
  duplicateTriangles: number;
}

export interface GeometryDiagnostics {
  vertexCount: number;
  triangleCount: number;
  bounds: { min: GeometryTriple; max: GeometryTriple; size: GeometryTriple };
  /** Sum of triangle areas, including overlapping or duplicate faces. */
  surfaceArea: number | null;
  /** Exact zero-area triangles; no tolerance or thinness threshold is used. */
  degenerateTriangles: number | null;
  topologyStatus: 'checked' | 'skipped';
  topologySkipReason: 'pointcloud' | 'limit' | null;
  topology: GeometryTopology | null;
}

/**
 * Inspect coordinates as supplied, without modifying or repairing geometry.
 * The caller applies the desired unit/scale before analysis. Topology groups
 * only exactly equal coordinates (including +0/-0), never nearby vertices.
 * These checks do not test self-intersections, vertex manifoldness, volume,
 * outward normals, or suitability for FEM.
 */
export function analyzeGeometry(
  positions: Float32Array,
  indices?: Uint32Array,
): GeometryDiagnostics {
  if (indices) validateMesh(positions, indices);
  else validatePositions(positions);

  const vertexCount = positions.length / 3;
  const triangleCount = indices ? indices.length / 3 : 0;
  const min: GeometryTriple = [Infinity, Infinity, Infinity];
  const max: GeometryTriple = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[i + axis]);
      max[axis] = Math.max(max[axis], positions[i + axis]);
    }
  }
  const result: GeometryDiagnostics = {
    vertexCount,
    triangleCount,
    bounds: { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] },
    surfaceArea: indices ? 0 : null,
    degenerateTriangles: indices ? 0 : null,
    topologyStatus: 'skipped',
    topologySkipReason: indices ? 'limit' : 'pointcloud',
    topology: null,
  };
  if (!indices) return result;

  const inspectTopology = vertexCount <= TOPOLOGY_MAX_VERTICES &&
    triangleCount <= TOPOLOGY_MAX_TRIANGLES;
  let canonical: Uint32Array | null = null;
  let uniqueVertexCount = 0;
  if (inspectTopology) {
    canonical = new Uint32Array(vertexCount);
    const coordinates = new Map<string, number>();
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const i = vertex * 3;
      const key = `${positions[i]},${positions[i + 1]},${positions[i + 2]}`;
      let id = coordinates.get(key);
      if (id === undefined) {
        id = uniqueVertexCount++;
        coordinates.set(key, id);
      }
      canonical[vertex] = id;
    }
  }

  // Numeric sorting avoids per-edge objects/strings. At the explicit 200k
  // vertex limit, even three packed IDs fit exactly in a JS safe integer:
  // 200000^3 - 1 < Number.MAX_SAFE_INTEGER.
  const edges = inspectTopology ? new Float64Array(indices.length) : null;
  const faces = inspectTopology ? new Float64Array(triangleCount) : null;
  let analyzedTriangles = 0;
  let surfaceArea = 0;
  let areaCorrection = 0;
  let degenerateTriangles = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    if (area === 0) {
      degenerateTriangles++;
      continue;
    }
    // Compensated summation retains contributions from small triangles.
    const correctedArea = area - areaCorrection;
    const nextArea = surfaceArea + correctedArea;
    areaCorrection = (nextArea - surfaceArea) - correctedArea;
    surfaceArea = nextArea;

    if (canonical && edges && faces) {
      const ca = canonical[indices[i]];
      const cb = canonical[indices[i + 1]];
      const cc = canonical[indices[i + 2]];
      const low = Math.min(ca, cb, cc);
      const high = Math.max(ca, cb, cc);
      const middle = ca + cb + cc - low - high;
      faces[analyzedTriangles] = (low * vertexCount + middle) * vertexCount + high;
      const offset = analyzedTriangles * 3;
      edges[offset] = packedEdge(ca, cb, vertexCount);
      edges[offset + 1] = packedEdge(cb, cc, vertexCount);
      edges[offset + 2] = packedEdge(cc, ca, vertexCount);
    }
    analyzedTriangles++;
  }
  result.surfaceArea = surfaceArea;
  result.degenerateTriangles = degenerateTriangles;
  if (!edges || !faces) return result;

  const sortedFaces = faces.subarray(0, analyzedTriangles).sort();
  let duplicateTriangles = 0;
  for (let i = 1; i < sortedFaces.length; i++) {
    if (sortedFaces[i] === sortedFaces[i - 1]) duplicateTriangles++;
  }
  const sortedEdges = edges.subarray(0, analyzedTriangles * 3).sort();
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let inconsistentWindingEdges = 0;
  for (let start = 0; start < sortedEdges.length;) {
    const edge = Math.floor(sortedEdges[start] / 2);
    let end = start + 1;
    while (end < sortedEdges.length && Math.floor(sortedEdges[end] / 2) === edge) end++;
    const incidence = end - start;
    if (incidence === 1) boundaryEdges++;
    else if (incidence > 2) nonManifoldEdges++;
    else if (sortedEdges[start] === sortedEdges[start + 1]) inconsistentWindingEdges++;
    start = end;
  }
  result.topologyStatus = 'checked';
  result.topologySkipReason = null;
  result.topology = {
    uniqueVertexCount,
    weldedVertexCount: vertexCount - uniqueVertexCount,
    analyzedTriangles,
    boundaryEdges,
    nonManifoldEdges,
    inconsistentWindingEdges,
    duplicateTriangles,
  };
  return result;
}

/** Direction occupies the low bit; the remaining integer identifies the edge. */
function packedEdge(a: number, b: number, stride: number): number {
  return (Math.min(a, b) * stride + Math.max(a, b)) * 2 + (a > b ? 1 : 0);
}
