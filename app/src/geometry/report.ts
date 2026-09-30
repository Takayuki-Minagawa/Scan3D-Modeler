import type { Project } from '../types';
import { calibrationMatchesSource, scaleSourceForAsset } from '../viewer/scale';
import { TOPOLOGY_MAX_TRIANGLES, TOPOLOGY_MAX_VERTICES, type GeometryDiagnostics } from './diagnostics';
import type { GeometryAsset } from './repository';

export function diagnosticScale(project: Project, entry: GeometryAsset) {
  const calibration = project.scaleCalibration;
  const applies = calibrationMatchesSource(calibration, scaleSourceForAsset(entry.asset, entry.stage));
  return {
    factor: applies ? calibration!.factor : 1,
    status: applies ? 'calibrated' as const : calibration ? 'different-source' as const : 'not-calibrated' as const,
  };
}

/** A portable snapshot: provenance, units, scale and limitations travel with the numbers. */
export function createGeometryReport(
  project: Project, entry: GeometryAsset, diagnostics: GeometryDiagnostics,
  generatedAt = new Date().toISOString(),
) {
  return {
    schemaVersion: 1,
    format: 'scan2fem-geometry-diagnostics',
    generatedAt,
    project: { id: project.id, name: project.name, unit: project.unit },
    source: {
      assetId: entry.asset.id,
      stageId: entry.asset.stageId,
      fileName: entry.stage?.sourceFileName ?? entry.asset.name,
      kind: entry.asset.kind,
      origin: entry.stage?.demo ? 'demo' : entry.stage?.origin ?? 'unknown',
    },
    scale: diagnosticScale(project, entry),
    methods: {
      bounds: 'axis-aligned; all stored vertices; project coordinate axes',
      coordinates: 'Float32 after applying the source-matched calibration, as for PLY/STL export',
      surfaceArea: 'sum of all triangle areas, including duplicates and overlaps; squared project unit',
      degenerateTriangles: 'exactly zero cross-product area; no tolerance or thin-triangle test',
      topology: 'exact-coordinate vertex welding for inspection only; zero-area faces excluded',
      duplicateTriangles: 'second and later occurrences of the same welded vertices, ignoring winding',
      inconsistentWindingEdges: 'same directed edge in exactly two incident nondegenerate triangles',
      topologyVertexLimit: TOPOLOGY_MAX_VERTICES,
      topologyTriangleLimit: TOPOLOGY_MAX_TRIANGLES,
    },
    unchecked: [
      'self-intersections', 'vertex manifoldness', 'outward orientation',
      'near-coincident vertices', 'thin triangle quality', 'physical accuracy', 'FEM suitability',
    ],
    diagnostics,
  };
}

export type GeometryReport = ReturnType<typeof createGeometryReport>;
