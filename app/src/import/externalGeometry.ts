import { db, now, uid } from '../db/db';
import { encodeMeshBinary } from '../export/formats';
import type { AssetMeta, Project, Stage, Unit } from '../types';

// 暫定的な安全上限。実機測定後に端末別の値へ調整する。
export const MAX_GEOMETRY_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_GEOMETRY_VERTICES = 1_000_000;
export const MAX_GEOMETRY_TRIANGLES = 1_000_000;

const MILLIMETRES: Record<Unit, number> = { mm: 1, cm: 10, m: 1000 };

export interface ParsedGeometry {
  kind: 'pointcloud' | 'mesh';
  positions: Float32Array;
  indices?: Uint32Array;
  inputUnit: Unit;
  coordinateUnit: Unit;
}

/** 外部形状の検査を完了してから保存する。STL/PLYは単位を規定しないため利用者に選択してもらう。 */
export async function parseExternalGeometry(
  file: File,
  inputUnit: Unit,
  coordinateUnit: Unit,
): Promise<ParsedGeometry> {
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  if (extension !== 'ply' && extension !== 'stl') {
    throw new Error('取込形式はPLYまたはSTLに限ります');
  }
  if (file.size === 0 || file.size > MAX_GEOMETRY_FILE_BYTES) {
    throw new Error(`ファイルは1B以上${MAX_GEOMETRY_FILE_BYTES / 1024 / 1024}MiB以下にしてください`);
  }

  const buffer = await file.arrayBuffer();
  const geometry = extension === 'ply'
    ? new (await import('three/examples/jsm/loaders/PLYLoader.js')).PLYLoader().parse(buffer)
    : new (await import('three/examples/jsm/loaders/STLLoader.js')).STLLoader().parse(buffer);
  try {
    const attribute = geometry.getAttribute('position');
    if (!attribute || attribute.itemSize !== 3 || attribute.count === 0 ||
        attribute.count > MAX_GEOMETRY_VERTICES) {
      throw new Error('頂点が空か、頂点数が上限を超えています');
    }
    const factor = MILLIMETRES[inputUnit] / MILLIMETRES[coordinateUnit];
    const positions = new Float32Array(attribute.count * 3);
    for (let vertex = 0; vertex < attribute.count; vertex++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = attribute.getComponent(vertex, axis) * factor;
        if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
          throw new Error('頂点座標に無効な値があります');
        }
        positions[vertex * 3 + axis] = value;
      }
    }

    // PLYでfaceがない場合だけ点群として扱う。STLは三角面が必須。
    const isMesh = extension === 'stl' || geometry.index !== null;
    if (!isMesh) {
      return { kind: 'pointcloud', positions, inputUnit, coordinateUnit };
    }
    const indexCount = geometry.index?.count ?? attribute.count;
    if (indexCount === 0 || indexCount % 3 !== 0 ||
        indexCount / 3 > MAX_GEOMETRY_TRIANGLES) {
      throw new Error('三角面が空か、面数が上限を超えています');
    }
    const indices = new Uint32Array(indexCount);
    for (let i = 0; i < indexCount; i++) {
      const index = geometry.index?.getX(i) ?? i;
      if (!Number.isSafeInteger(index) || index < 0 || index >= attribute.count) {
        throw new Error('三角面の頂点参照が不正です');
      }
      indices[i] = index;
    }
    return { kind: 'mesh', positions, indices, inputUnit, coordinateUnit };
  } finally {
    geometry.dispose();
  }
}

/** 大きな形状のパースと検査をUIスレッドから切り離す。 */
export async function parseExternalGeometryInWorker(
  file: File,
  inputUnit: Unit,
  coordinateUnit: Unit,
): Promise<ParsedGeometry> {
  if (file.size === 0 || file.size > MAX_GEOMETRY_FILE_BYTES) {
    throw new Error(`ファイルは1B以上${MAX_GEOMETRY_FILE_BYTES / 1024 / 1024}MiB以下にしてください`);
  }
  const worker = new Worker(new URL('./parse-geometry.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<ParsedGeometry>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('形状の解析が時間切れになりました')), 120_000);
      worker.onmessage = (event: MessageEvent<{ parsed?: ParsedGeometry; error?: string }>) => {
        window.clearTimeout(timeout);
        if (event.data.error) reject(new Error(event.data.error));
        else if (event.data.parsed) resolve(event.data.parsed);
        else reject(new Error('形状の解析結果が不正です'));
      };
      worker.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('形状解析ワーカーが停止しました'));
      };
      worker.onmessageerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('形状解析結果を受け取れませんでした'));
      };
      worker.postMessage({ file, inputUnit, coordinateUnit });
    });
  } finally {
    worker.terminate();
  }
}

/** 検査済みの形状を段階・アセット・Blobとして単一transactionで追記する。 */
export async function saveExternalGeometry(
  project: Project,
  fileName: string,
  parsed: ParsedGeometry,
): Promise<Stage> {
  const kind = parsed.kind === 'pointcloud' ? 'dense' : 'surface';
  const blob = parsed.kind === 'pointcloud'
    ? new Blob([parsed.positions.buffer as ArrayBuffer], { type: 'application/octet-stream' })
    : new Blob([encodeMeshBinary(parsed.positions, parsed.indices!)], {
        type: 'application/octet-stream',
      });
  const d = await db();
  const tx = d.transaction(['projects', 'stages', 'assets', 'blobs'], 'readwrite');
  const savedProject = await tx.objectStore('projects').get(project.id);
  if (!savedProject || savedProject.unit !== parsed.coordinateUnit) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new Error('プロジェクトが削除されたか、単位が変更されています');
  }
  const stages = tx.objectStore('stages');
  const last = await stages.index('byProjectKindSeq').openCursor(
    IDBKeyRange.bound([project.id, kind, -Infinity], [project.id, kind, Infinity]),
    'prev',
  );
  const stage: Stage = {
    id: uid(),
    projectId: project.id,
    kind,
    seq: (last?.value.seq ?? 0) + 1,
    status: 'ready',
    origin: 'external',
    inputUnit: parsed.inputUnit,
    sourceFileName: fileName,
    sourceStageId: null,
    stats: {
      vertices: parsed.positions.length / 3,
      ...(parsed.indices ? { triangles: parsed.indices.length / 3 } : null),
    },
    createdAt: now(),
  };
  const asset: AssetMeta = {
    id: uid(),
    projectId: project.id,
    stageId: stage.id,
    kind: parsed.kind,
    name: fileName,
    mime: blob.type,
    size: blob.size,
    meta: { sourceFormat: fileName.split('.').at(-1)?.toLowerCase(), coordinateUnit: project.unit },
    createdAt: stage.createdAt,
  };
  await Promise.all([
    stages.put(stage),
    tx.objectStore('assets').put(asset),
    tx.objectStore('blobs').put({ assetId: asset.id, blob }),
    tx.done,
  ]);
  return stage;
}
