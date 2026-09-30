import { db, now, uid } from '../db/db';
import { encodeMeshBinary } from '../export/formats';
import { validateMesh, validatePositions } from '../geometry/validation';
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

type PlyType = 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32' | 'float64';
interface PlyProperty { name: string; type: PlyType; countType?: PlyType }
interface PlyElement { name: string; count: number; properties: PlyProperty[] }

const PLY_TYPES: Record<string, PlyType> = {
  char: 'int8', uchar: 'uint8', short: 'int16', ushort: 'uint16', int: 'int32', uint: 'uint32',
  float: 'float32', double: 'float64', int8: 'int8', uint8: 'uint8', int16: 'int16',
  uint16: 'uint16', int32: 'int32', uint32: 'uint32', float32: 'float32', float64: 'float64',
};
const PLY_BYTES: Record<PlyType, number> = {
  int8: 1, uint8: 1, int16: 2, uint16: 2, int32: 4, uint32: 4, float32: 4, float64: 8,
};

/**
 * Read the supported PLY subset directly. Render loaders may silently stop at truncated input,
 * drop polygons, or expand colored faces into unindexed vertices; none is safe for saved geometry.
 * Ancillary properties are validated and skipped; original position/face topology is retained.
 */
function parsePly(buffer: ArrayBuffer, factor: number): { positions: Float32Array; indices?: Uint32Array } {
  const bytes = new Uint8Array(buffer);
  const prefix = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 65_536)));
  const end = /^end_header(?:\r\n|\r|\n)/m.exec(prefix);
  if (!/^ply(?:\r\n|\r|\n)/.test(prefix) || !end) {
    throw new Error('PLYヘッダが不正か長すぎます');
  }
  const headerBytes = new TextEncoder().encode(prefix.slice(0, end.index + end[0].length)).length;
  const elements: PlyElement[] = [];
  let format = '';
  let totalCount = 0;
  for (const line of prefix.slice(0, end.index).split(/\r\n|\r|\n/).slice(1)) {
    const words = line.trim().split(/\s+/);
    if (!words[0] || words[0] === 'comment' || words[0] === 'obj_info') continue;
    if (words[0] === 'format') {
      if (format || words.length !== 3 || words[2] !== '1.0' ||
          !['ascii', 'binary_little_endian', 'binary_big_endian'].includes(words[1])) {
        throw new Error('PLYの形式指定が不正です');
      }
      format = words[1];
    } else if (words[0] === 'element') {
      const count = Number(words[2]);
      if (words.length !== 3 || !/^\d+$/.test(words[2]) || !Number.isSafeInteger(count) ||
          elements.some((element) => element.name === words[1])) {
        throw new Error('PLYの要素数または要素名が不正です');
      }
      totalCount += count;
      if (totalCount > MAX_GEOMETRY_VERTICES + MAX_GEOMETRY_TRIANGLES ||
          (words[1] === 'vertex' && count > MAX_GEOMETRY_VERTICES) ||
          (words[1] === 'face' && count > MAX_GEOMETRY_TRIANGLES)) {
        throw new Error('PLYの要素数が上限を超えています');
      }
      elements.push({ name: words[1], count, properties: [] });
    } else if (words[0] === 'property') {
      const element = elements.at(-1);
      const list = words[1] === 'list';
      const typeName = words[list ? 3 : 1];
      const type = Object.hasOwn(PLY_TYPES, typeName) ? PLY_TYPES[typeName] : undefined;
      const countType = list && Object.hasOwn(PLY_TYPES, words[2]) ? PLY_TYPES[words[2]] : undefined;
      const name = words[list ? 4 : 2];
      if (!element || words.length !== (list ? 5 : 3) || !type || !name ||
          (list && (!countType || countType.startsWith('float'))) ||
          element.properties.some((property) => property.name === name)) {
        throw new Error('PLYのプロパティ指定が不正です');
      }
      element.properties.push({ name, type, countType });
    } else {
      throw new Error('PLYヘッダに未対応の項目があります');
    }
  }
  const vertices = elements.find((element) => element.name === 'vertex');
  const faces = elements.find((element) => element.name === 'face');
  if (!format || !vertices?.count || elements.some((element) => element.count > 0 && !element.properties.length)) {
    throw new Error('PLYの頂点またはプロパティが不足しています');
  }
  const coordinateNames = [['x', 'px', 'posx'], ['y', 'py', 'posy'], ['z', 'pz', 'posz']].map(
    (names) => names.find((name) => vertices.properties.some((property) => property.name === name && !property.countType)),
  );
  if (coordinateNames.some((name) => !name)) throw new Error('PLYのXYZ座標が不足しています');
  const faceProperty = faces?.properties.find((property) =>
    ['vertex_indices', 'vertex_index'].includes(property.name),
  );
  if (faces?.count && (!faceProperty?.countType || faceProperty.type.startsWith('float'))) {
    throw new Error('PLYの面の頂点参照が不正です');
  }

  const body = format === 'ascii' ? new TextDecoder().decode(bytes.subarray(headerBytes)) : '';
  const token = /\S+/g;
  const data = new DataView(buffer);
  const little = format === 'binary_little_endian';
  let offset = headerBytes;
  function scalar(type: PlyType): number {
    let value: number;
    if (format === 'ascii') {
      const next = token.exec(body)?.[0];
      if (next === undefined) throw new Error('PLYの本体データが不足しています');
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(next)) {
        throw new Error('PLYに不正な数値があります');
      }
      value = Number(next);
    } else {
      if (offset + PLY_BYTES[type] > bytes.length) throw new Error('PLYの本体データが不足しています');
      switch (type) {
        case 'int8': value = data.getInt8(offset); break;
        case 'uint8': value = data.getUint8(offset); break;
        case 'int16': value = data.getInt16(offset, little); break;
        case 'uint16': value = data.getUint16(offset, little); break;
        case 'int32': value = data.getInt32(offset, little); break;
        case 'uint32': value = data.getUint32(offset, little); break;
        case 'float32': value = data.getFloat32(offset, little); break;
        case 'float64': value = data.getFloat64(offset, little); break;
      }
      offset += PLY_BYTES[type];
    }
    if (!Number.isFinite(value) || (type === 'float32' && !Number.isFinite(Math.fround(value)))) {
      throw new Error('PLYに不正な数値があります');
    }
    if (!type.startsWith('float')) {
      const bits = PLY_BYTES[type] * 8;
      const signed = type.startsWith('int');
      if (!Number.isInteger(value) || value < (signed ? -(2 ** (bits - 1)) : 0) ||
          value > (signed ? 2 ** (bits - 1) - 1 : 2 ** bits - 1)) {
        throw new Error('PLYの整数値が範囲外です');
      }
    }
    return value;
  }

  const positions = new Float32Array(vertices.count * 3);
  const indexBuffer = new Uint32Array(Math.min(MAX_GEOMETRY_TRIANGLES, (faces?.count ?? 0) * 2) * 3);
  let indexCount = 0;
  for (const element of elements) {
    for (let row = 0; row < element.count; row++) {
      for (const property of element.properties) {
        if (property.countType) {
          const count = scalar(property.countType);
          if (count < 0 || count > MAX_GEOMETRY_VERTICES) throw new Error('PLYのリスト長が範囲外です');
          const isFace = element === faces && property === faceProperty;
          if (isFace && count !== 3 && count !== 4) {
            throw new Error('PLYの面は三角形または四角形にしてください');
          }
          const face: number[] = [];
          for (let i = 0; i < count; i++) {
            const value = scalar(property.type);
            if (isFace) {
              if (!Number.isInteger(value) || value < 0 || value >= vertices.count) {
                throw new Error('三角面の頂点参照が不正です');
              }
              face.push(value);
            }
          }
          if (isFace) {
            const triangles = count === 3 ? face : [face[0], face[1], face[3], face[1], face[2], face[3]];
            if (indexCount + triangles.length > indexBuffer.length) throw new Error('PLYの三角面数が上限を超えています');
            indexBuffer.set(triangles, indexCount);
            indexCount += triangles.length;
          }
        } else {
          const value = scalar(property.type);
          const axis = element === vertices ? coordinateNames.indexOf(property.name) : -1;
          if (axis >= 0) {
            const scaled = value * factor;
            if (!Number.isFinite(Math.fround(scaled))) throw new Error('頂点座標に無効な値があります');
            positions[row * 3 + axis] = scaled;
          }
        }
      }
    }
  }
  if (format === 'ascii' ? token.exec(body) !== null : offset !== bytes.length) {
    throw new Error('PLYの要素数と本体データの長さが一致しません');
  }
  if (indexCount) {
    const indices = indexBuffer.slice(0, indexCount);
    validateMesh(positions, indices);
    return { positions, indices };
  }
  validatePositions(positions);
  return { positions };
}

/** STLLoaderによる配列確保より前に宣言面数を制限する。 */
function checkStlHeader(buffer: ArrayBuffer): void {
  const bytes = new Uint8Array(buffer);
  // STLLoaderは先頭にsolidがなければbinary STLとして面数分の配列を確保する。
  if (bytes.length < 84) return;
  const asciiPrefix = [0, 1, 2, 3, 4].some((offset) =>
    bytes[offset] === 115 && bytes[offset + 1] === 111 && bytes[offset + 2] === 108 &&
    bytes[offset + 3] === 105 && bytes[offset + 4] === 100,
  );
  const faces = new DataView(buffer).getUint32(80, true);
  if (!asciiPrefix || 84 + faces * 50 === bytes.length) {
    if (faces > MAX_GEOMETRY_TRIANGLES || faces * 3 > MAX_GEOMETRY_VERTICES ||
        84 + faces * 50 > bytes.length) {
      throw new Error('STLの面数またはファイル長が不正です');
    }
  }
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
  const factor = MILLIMETRES[inputUnit] / MILLIMETRES[coordinateUnit];
  if (extension === 'ply') {
    const parsed = parsePly(buffer, factor);
    return { ...parsed, kind: parsed.indices ? 'mesh' : 'pointcloud', inputUnit, coordinateUnit };
  }
  checkStlHeader(buffer);
  const geometry = new (await import('three/examples/jsm/loaders/STLLoader.js')).STLLoader().parse(buffer);
  try {
    const attribute = geometry.getAttribute('position');
    if (!attribute || attribute.itemSize !== 3 || attribute.count === 0 ||
        attribute.count > MAX_GEOMETRY_VERTICES) {
      throw new Error('頂点が空か、頂点数が上限を超えています');
    }
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
    validateMesh(positions, indices);
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
  if (parsed.kind === 'pointcloud') validatePositions(parsed.positions);
  else {
    if (!parsed.indices) throw new Error('三角面の頂点参照がありません');
    validateMesh(parsed.positions, parsed.indices);
  }
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
