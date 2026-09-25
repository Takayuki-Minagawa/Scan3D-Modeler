import { strToU8, Zip, ZipPassThrough, Unzip, UnzipInflate } from 'fflate';
import { db, uid, now } from '../db/db';
import type { AssetMeta, Project, Stage } from '../types';

/**
 * プロジェクトZIP入出力(作業計画 1A-3)。
 * スマホで撮影 → ZIPで持ち出し → PCブラウザで処理継続、という
 * 端末間の引き継ぎ経路を兼ねる(リスクR1/R2対策)。
 *
 * ZIP構成:
 *   project.json     … マニフェスト(プロジェクト+段階+アセットメタ)
 *   assets/<id>      … 各アセットのバイナリ
 *
 * ジョブ実行状態(checkpoint含む)は端末ローカルの実行状態のため含めない。
 * したがって実行中(running)のstageは、取り込み先で再開できず永久に
 * 実行中のまま残ってしまうため、エクスポート対象から除外する。
 */
interface Manifest {
  format: 'scan2fem-project';
  version: 1 | 2;
  exportedAt: number;
  project: Project;
  stages: Stage[];
  assets: AssetMeta[];
}

const UNITS = new Set(['mm', 'cm', 'm']);
const CAPTURE_METHODS = new Set(['video', 'photos', 'mixed']);
const SCALE_METHODS = new Set(['marker', 'knownDimension', 'twoPoint', 'later']);
const STAGE_KINDS = new Set([
  'frames',
  'sparse',
  'dense',
  'surface',
  'cleaned',
  'femShape',
  'mesh',
]);
const STAGE_STATUSES = new Set(['running', 'ready', 'failed']);
const ASSET_KINDS = new Set([
  'image',
  'video',
  'frame',
  'thumbnail',
  'pointcloud',
  'mesh',
  'json',
]);
const FOCAL_PX_SOURCES = new Set(['exifFocalPlaneResolution', 'exif35mmEquivalent', 'user']);
const STAGE_ORIGINS = new Set(['demo', 'capture', 'external']);
const MIN_SCALE_FACTOR = 1e-9;
const MAX_SCALE_FACTOR = 1e9;
const MIN_MODEL_DISTANCE = 1e-9;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaError(path: string): never {
  throw new Error(`project.json の「${path}」が不正です`);
}

function expectRecord(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) schemaError(path);
  return value;
}

function expectOnlyKeys(record: UnknownRecord, allowed: readonly string[], path: string): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(record).find((key) => !allowedKeys.has(key));
  if (unexpected !== undefined) schemaError(`${path}.${unexpected}`);
}

function expectString(value: unknown, path: string, nonEmpty = false): string {
  if (typeof value !== 'string' || (nonEmpty && value.length === 0)) schemaError(path);
  return value;
}

function expectFiniteNumber(
  value: unknown,
  path: string,
  options: { min?: number; integer?: boolean; exclusiveMin?: boolean } = {},
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) schemaError(path);
  if (options.integer && !Number.isSafeInteger(value)) schemaError(path);
  if (
    options.min !== undefined &&
    (options.exclusiveMin ? value <= options.min : value < options.min)
  ) {
    schemaError(path);
  }
  return value;
}

function expectEnum(value: unknown, values: ReadonlySet<string>, path: string): string {
  if (typeof value !== 'string' || !values.has(value)) schemaError(path);
  return value;
}

function validateOptionalString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'string') schemaError(path);
}

function validateOptionalId(value: unknown, path: string): void {
  if (value !== undefined && (typeof value !== 'string' || value.length === 0)) schemaError(path);
}

function validateNullableId(value: unknown, path: string, optional = false): void {
  if (optional && value === undefined) return;
  if (value !== null && (typeof value !== 'string' || value.length === 0)) schemaError(path);
}

function validateOptionalBoolean(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'boolean') schemaError(path);
}

function validateOptionalPositiveNumber(value: unknown, path: string): void {
  if (value !== undefined) expectFiniteNumber(value, path, { min: 0, exclusiveMin: true });
}

/** Record<string, unknown> 内にも 1e400 由来の Infinity 等を残さない。 */
function validateJsonData(value: unknown, path: string): void {
  const pending: Array<{ value: unknown; path: string }> = [{ value, path }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (
      current.value === null ||
      typeof current.value === 'string' ||
      typeof current.value === 'boolean'
    ) {
      continue;
    }
    if (typeof current.value === 'number') {
      expectFiniteNumber(current.value, current.path);
      continue;
    }
    if (Array.isArray(current.value)) {
      current.value.forEach((item, index) => {
        pending.push({ value: item, path: `${current.path}[${index}]` });
      });
      continue;
    }
    if (isRecord(current.value)) {
      for (const [key, item] of Object.entries(current.value)) {
        pending.push({ value: item, path: `${current.path}.${key}` });
      }
      continue;
    }
    schemaError(current.path);
  }
}

function validatePoint(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.length !== 3) schemaError(path);
  value.forEach((coordinate, index) => expectFiniteNumber(coordinate, `${path}[${index}]`));
}

function validateScaleCalibration(value: unknown, path: string): void {
  const calibration = expectRecord(value, path);
  expectOnlyKeys(
    calibration,
    [
      'factor',
      'modelDistance',
      'measuredDistance',
      'unit',
      'pointA',
      'pointB',
      'sourceStageId',
      'sourceAssetId',
      'updatedAt',
    ],
    path,
  );
  const factor = expectFiniteNumber(calibration.factor, `${path}.factor`, {
    min: MIN_SCALE_FACTOR,
  });
  const modelDistance = expectFiniteNumber(calibration.modelDistance, `${path}.modelDistance`, {
    min: MIN_MODEL_DISTANCE,
    exclusiveMin: true,
  });
  const measuredDistance = expectFiniteNumber(
    calibration.measuredDistance,
    `${path}.measuredDistance`,
    { min: 0, exclusiveMin: true },
  );
  expectEnum(calibration.unit, UNITS, `${path}.unit`);
  validatePoint(calibration.pointA, `${path}.pointA`);
  validatePoint(calibration.pointB, `${path}.pointB`);
  expectFiniteNumber(calibration.updatedAt, `${path}.updatedAt`, { min: 0 });
  validateNullableId(calibration.sourceStageId, `${path}.sourceStageId`, true);
  validateNullableId(calibration.sourceAssetId, `${path}.sourceAssetId`, true);
  if (factor > MAX_SCALE_FACTOR) schemaError(`${path}.factor`);

  // 倍率と元の2距離が食い違うZIPを取り込むと、画面表示と保存値の説明が
  // 一致しない。浮動小数点の直列化誤差だけを許容する。
  const expectedFactor = measuredDistance / modelDistance;
  const tolerance = Math.max(1e-12, Math.abs(expectedFactor) * 1e-10);
  if (!Number.isFinite(expectedFactor) || Math.abs(factor - expectedFactor) > tolerance) {
    schemaError(`${path}.factor`);
  }
  const pointA = calibration.pointA as number[];
  const pointB = calibration.pointB as number[];
  const pointDistance = Math.hypot(
    pointB[0] - pointA[0],
    pointB[1] - pointA[1],
    pointB[2] - pointA[2],
  );
  const distanceTolerance = Math.max(1e-12, Math.abs(modelDistance) * 1e-10);
  if (
    !Number.isFinite(pointDistance) ||
    Math.abs(modelDistance - pointDistance) > distanceTolerance
  ) {
    schemaError(`${path}.modelDistance`);
  }
}

function validateProject(value: unknown): asserts value is Project {
  const project = expectRecord(value, 'project');
  expectOnlyKeys(
    project,
    [
      'id',
      'name',
      'objectName',
      'unit',
      'approxSize',
      'captureMethod',
      'scaleMethod',
      'scaleCalibration',
      'note',
      'createdAt',
      'updatedAt',
    ],
    'project',
  );
  expectString(project.id, 'project.id', true);
  expectString(project.name, 'project.name');
  expectString(project.objectName, 'project.objectName');
  expectEnum(project.unit, UNITS, 'project.unit');
  const approxSize = expectRecord(project.approxSize, 'project.approxSize');
  expectOnlyKeys(approxSize, ['w', 'h', 'd'], 'project.approxSize');
  expectFiniteNumber(approxSize.w, 'project.approxSize.w', { min: 0 });
  expectFiniteNumber(approxSize.h, 'project.approxSize.h', { min: 0 });
  expectFiniteNumber(approxSize.d, 'project.approxSize.d', { min: 0 });
  expectEnum(project.captureMethod, CAPTURE_METHODS, 'project.captureMethod');
  expectEnum(project.scaleMethod, SCALE_METHODS, 'project.scaleMethod');
  if (project.scaleCalibration !== undefined) {
    validateScaleCalibration(project.scaleCalibration, 'project.scaleCalibration');
    const calibration = project.scaleCalibration as UnknownRecord;
    if (calibration.unit !== project.unit) schemaError('project.scaleCalibration.unit');
    if (project.scaleMethod !== 'twoPoint') schemaError('project.scaleMethod');
  }
  validateOptionalString(project.note, 'project.note');
  expectFiniteNumber(project.createdAt, 'project.createdAt', { min: 0 });
  expectFiniteNumber(project.updatedAt, 'project.updatedAt', { min: 0 });
}

function validateStage(value: unknown, index: number): asserts value is Stage {
  const path = `stages[${index}]`;
  const stage = expectRecord(value, path);
  expectOnlyKeys(
    stage,
    [
      'id',
      'projectId',
      'kind',
      'seq',
      'status',
      'demo',
      'origin',
      'inputUnit',
      'sourceFileName',
      'params',
      'stats',
      'sourceStageId',
      'note',
      'createdAt',
    ],
    path,
  );
  expectString(stage.id, `${path}.id`, true);
  expectString(stage.projectId, `${path}.projectId`, true);
  expectEnum(stage.kind, STAGE_KINDS, `${path}.kind`);
  expectFiniteNumber(stage.seq, `${path}.seq`, { min: 1, integer: true });
  expectEnum(stage.status, STAGE_STATUSES, `${path}.status`);
  validateOptionalBoolean(stage.demo, `${path}.demo`);
  if (stage.origin !== undefined) expectEnum(stage.origin, STAGE_ORIGINS, `${path}.origin`);
  if (stage.inputUnit !== undefined) expectEnum(stage.inputUnit, UNITS, `${path}.inputUnit`);
  validateOptionalString(stage.sourceFileName, `${path}.sourceFileName`);
  if (stage.origin === 'external' && (!stage.inputUnit || !stage.sourceFileName || stage.demo)) {
    schemaError(path);
  }
  if (stage.params !== undefined) {
    expectRecord(stage.params, `${path}.params`);
    validateJsonData(stage.params, `${path}.params`);
  }
  if (stage.stats !== undefined) {
    const stats = expectRecord(stage.stats, `${path}.stats`);
    for (const [key, statistic] of Object.entries(stats)) {
      if (typeof statistic === 'number') expectFiniteNumber(statistic, `${path}.stats.${key}`);
      else if (typeof statistic !== 'string') schemaError(`${path}.stats.${key}`);
    }
  }
  validateNullableId(stage.sourceStageId, `${path}.sourceStageId`, true);
  validateOptionalString(stage.note, `${path}.note`);
  expectFiniteNumber(stage.createdAt, `${path}.createdAt`, { min: 0 });
}

function validateImageMetadata(value: unknown, path: string): void {
  const image = expectRecord(value, path);
  expectOnlyKeys(
    image,
    [
      'widthPx',
      'heightPx',
      'capturedAt',
      'cameraMake',
      'cameraModel',
      'orientation',
      'intrinsics',
    ],
    path,
  );
  if (image.widthPx !== undefined) {
    expectFiniteNumber(image.widthPx, `${path}.widthPx`, { min: 1, integer: true });
  }
  if (image.heightPx !== undefined) {
    expectFiniteNumber(image.heightPx, `${path}.heightPx`, { min: 1, integer: true });
  }
  validateOptionalString(image.capturedAt, `${path}.capturedAt`);
  validateOptionalString(image.cameraMake, `${path}.cameraMake`);
  validateOptionalString(image.cameraModel, `${path}.cameraModel`);
  if (image.orientation !== undefined) {
    expectFiniteNumber(image.orientation, `${path}.orientation`, { min: 1, integer: true });
    if ((image.orientation as number) > 8) schemaError(`${path}.orientation`);
  }
  if (image.intrinsics !== undefined) {
    const intrinsics = expectRecord(image.intrinsics, `${path}.intrinsics`);
    expectOnlyKeys(
      intrinsics,
      [
        'focalLengthMm',
        'focalLength35mm',
        'sensorWidthMm',
        'sensorHeightMm',
        'focalPx',
        'focalPxSource',
        'focalPxNote',
      ],
      `${path}.intrinsics`,
    );
    validateOptionalPositiveNumber(intrinsics.focalLengthMm, `${path}.intrinsics.focalLengthMm`);
    validateOptionalPositiveNumber(intrinsics.focalLength35mm, `${path}.intrinsics.focalLength35mm`);
    validateOptionalPositiveNumber(intrinsics.sensorWidthMm, `${path}.intrinsics.sensorWidthMm`);
    validateOptionalPositiveNumber(intrinsics.sensorHeightMm, `${path}.intrinsics.sensorHeightMm`);
    validateOptionalPositiveNumber(intrinsics.focalPx, `${path}.intrinsics.focalPx`);
    if (intrinsics.focalPxSource !== undefined) {
      expectEnum(
        intrinsics.focalPxSource,
        FOCAL_PX_SOURCES,
        `${path}.intrinsics.focalPxSource`,
      );
    }
    validateOptionalString(intrinsics.focalPxNote, `${path}.intrinsics.focalPxNote`);
    if (intrinsics.focalPxSource === 'user' &&
        (intrinsics.focalPx === undefined ||
          typeof intrinsics.focalPxNote !== 'string' ||
          !intrinsics.focalPxNote.trim())) {
      schemaError(`${path}.intrinsics.focalPxNote`);
    }
  }
}

function validateAsset(value: unknown, index: number): asserts value is AssetMeta {
  const path = `assets[${index}]`;
  const asset = expectRecord(value, path);
  expectOnlyKeys(
    asset,
    [
      'id',
      'projectId',
      'stageId',
      'kind',
      'name',
      'mime',
      'size',
      'excluded',
      'quality',
      'thumbnailAssetId',
      'sourceAssetId',
      'image',
      'meta',
      'createdAt',
    ],
    path,
  );
  expectString(asset.id, `${path}.id`, true);
  expectString(asset.projectId, `${path}.projectId`, true);
  validateNullableId(asset.stageId, `${path}.stageId`);
  expectEnum(asset.kind, ASSET_KINDS, `${path}.kind`);
  expectString(asset.name, `${path}.name`);
  expectString(asset.mime, `${path}.mime`);
  expectFiniteNumber(asset.size, `${path}.size`, { min: 0, integer: true });
  validateOptionalBoolean(asset.excluded, `${path}.excluded`);
  if (asset.quality !== undefined) {
    const quality = expectRecord(asset.quality, `${path}.quality`);
    expectOnlyKeys(quality, ['blur', 'sharp'], `${path}.quality`);
    if (quality.blur !== undefined) {
      expectFiniteNumber(quality.blur, `${path}.quality.blur`, { min: 0 });
    }
    validateOptionalBoolean(quality.sharp, `${path}.quality.sharp`);
  }
  validateOptionalId(asset.thumbnailAssetId, `${path}.thumbnailAssetId`);
  validateOptionalId(asset.sourceAssetId, `${path}.sourceAssetId`);
  if (asset.image !== undefined) validateImageMetadata(asset.image, `${path}.image`);
  if (asset.meta !== undefined) {
    expectRecord(asset.meta, `${path}.meta`);
    validateJsonData(asset.meta, `${path}.meta`);
  }
  expectFiniteNumber(asset.createdAt, `${path}.createdAt`, { min: 0 });
}

/** 旧v1 ZIPが含み得る重複seqを、kindごとの昇順を保って一意化する。 */
export function normalizeImportedStageSequences(stages: Stage[]): void {
  const byKind = new Map<string, Stage[]>();
  for (const s of stages) {
    const g = byKind.get(s.kind);
    if (g) g.push(s);
    else byKind.set(s.kind, [s]);
  }
  for (const g of byKind.values()) {
    // ES2019以降のstable sortにより、seq/createdAt同値はmanifest記載順を保つ。
    g.sort((a, b) => a.seq - b.seq || a.createdAt - b.createdAt);
    let last = 0;
    for (const s of g) {
      if (s.seq <= last) s.seq = last + 1;
      last = s.seq;
    }
  }
}

export interface ExportZipResult {
  blob: Blob;
  /** 実行中(未完了)のため除外した段階数 */
  excludedRunningStages: number;
}

interface ProjectSnapshot {
  manifest: Manifest;
  blobs: Map<string, Blob>;
  excludedRunningStages: number;
}

async function snapshotProject(projectId: string): Promise<ProjectSnapshot> {
  const d = await db();
  // 実行中ジョブはstage/assetを書き換え続けるため、まず停止を求める
  const jobs = await d.getAllFromIndex('jobs', 'byProject', projectId);
  if (jobs.some((j) => j.status === 'running')) {
    throw new Error(
      '実行中のジョブがあります。一時停止または完了させてからエクスポートしてください',
    );
  }

  // 単一トランザクションで読み出し、途中で変更が入らない一貫した
  // スナップショットを取る(stage参照切れ・blob欠落の混入防止)。
  // 注意: このトランザクション内でIndexedDB以外のawaitを挟まないこと
  const tx = d.transaction(['projects', 'stages', 'assets', 'blobs']);
  const project = await tx.objectStore('projects').get(projectId);
  if (!project) throw new Error('プロジェクトが見つかりません');
  const allStages = await tx.objectStore('stages').index('byProject').getAll(projectId);
  const allAssets = await tx.objectStore('assets').index('byProject').getAll(projectId);
  const stages = allStages.filter((s) => s.status !== 'running');
  const stageIds = new Set(stages.map((s) => s.id));
  const assets = allAssets.filter((a) => a.stageId === null || stageIds.has(a.stageId));
  const blobs = new Map<string, Blob>();
  for (const a of assets) {
    const rec = await tx.objectStore('blobs').get(a.id);
    if (!rec) {
      throw new Error(
        `アセット「${a.name}」の本体データが見つかりません(データ破損の可能性)。エクスポートを中止しました`,
      );
    }
    blobs.set(a.id, rec.blob);
  }
  await tx.done;

  return { manifest: {
    format: 'scan2fem-project',
    version: 2,
    exportedAt: now(),
    project,
    stages,
    assets,
  }, blobs,
    excludedRunningStages: allStages.length - stages.length,
  };
}

/** 入力Blobをチャンク単位で読み、ZIP出力先のwrite完了を待ってから次へ進む。 */
async function streamSnapshot(
  snapshot: ProjectSnapshot,
  write: (chunk: Uint8Array) => Promise<void>,
): Promise<void> {
  let pending = Promise.resolve();
  let failed: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) {
      failed = error;
      return;
    }
    if (chunk.length > 0) pending = pending.then(() => write(chunk));
  });
  try {
    const manifestFile = new ZipPassThrough('project.json');
    zip.add(manifestFile);
    manifestFile.push(strToU8(JSON.stringify(snapshot.manifest)), true);
    await pending;
    for (const asset of snapshot.manifest.assets) {
      const blob = snapshot.blobs.get(asset.id)!;
      const entry = new ZipPassThrough(`assets/${asset.id}`);
      zip.add(entry);
      const reader = blob.stream().getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          entry.push(value);
          await pending;
          if (failed) throw failed;
        }
        entry.push(new Uint8Array(0), true);
        await pending;
      } finally {
        reader.releaseLock();
      }
    }
    zip.end();
    await pending;
    if (failed) throw failed;
  } catch (error) {
    zip.terminate();
    throw error;
  }
}

/** File System Access APIが使えないブラウザ向け。元BlobのarrayBuffer全読込は行わない。 */
export async function exportProjectZip(projectId: string): Promise<ExportZipResult> {
  const snapshot = await snapshotProject(projectId);
  const totalBytes = [...snapshot.blobs.values()].reduce((sum, blob) => sum + blob.size, 0);
  if (totalBytes > 128 * 1024 * 1024) {
    throw new Error('128MiBを超えるZIPは直接保存に対応したブラウザで出力してください');
  }
  const chunks: Uint8Array[] = [];
  await streamSnapshot(snapshot, async (chunk) => { chunks.push(chunk); });
  return {
    blob: new Blob(chunks as BlobPart[], { type: 'application/zip' }),
    excludedRunningStages: snapshot.excludedRunningStages,
  };
}

export async function saveProjectZipDirectly(
  projectId: string,
  suggestedName: string,
): Promise<{ excludedRunningStages: number }> {
  const picker = (window as Window & {
    showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
  }).showSaveFilePicker;
  if (!picker) throw new Error('このブラウザは直接保存に対応していません');
  // ユーザー操作の有効期間内にダイアログを開くため、最初のawaitで呼ぶ。
  const handle = await picker.call(window, { suggestedName, types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }] });
  const writable = await handle.createWritable();
  try {
    const snapshot = await snapshotProject(projectId);
    await streamSnapshot(snapshot, async (chunk) => { await writable.write(new Uint8Array(chunk)); });
    await writable.close();
    return { excludedRunningStages: snapshot.excludedRunningStages };
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
}

const MAX_ZIP_BYTES = 1024 * 1024 * 1024;
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;
const MAX_IN_MEMORY_IMPORT_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;

interface CentralEntry { size: number; crc: number; compression: number }

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let value = i;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[i] = value >>> 0;
}

function updateCrc(crc: number, chunk: Uint8Array): number {
  for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return crc >>> 0;
}

function allowedEntryName(name: string): boolean {
  return name === 'project.json' || /^assets\/[A-Za-z0-9_-]{1,128}$/.test(name);
}

/** EOCDと中央ディレクトリを先に確認し、欠落・余分な項目・CRC不一致を検出する。 */
async function readCentralDirectory(file: Blob): Promise<Map<string, CentralEntry>> {
  const tailStart = Math.max(0, file.size - 65_557);
  const tail = new DataView(await file.slice(tailStart).arrayBuffer());
  let eocd = -1;
  for (let offset = tail.byteLength - 22; offset >= 0; offset--) {
    if (tail.getUint32(offset, true) === 0x06054b50 &&
        offset + 22 + tail.getUint16(offset + 20, true) === tail.byteLength) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0 || tail.getUint16(eocd + 4, true) !== 0 ||
      tail.getUint16(eocd + 6, true) !== 0) throw new Error('ZIPの終端が不正です');
  const count = tail.getUint16(eocd + 10, true);
  const centralSize = tail.getUint32(eocd + 12, true);
  const centralOffset = tail.getUint32(eocd + 16, true);
  if (count === 0 || count > MAX_ENTRIES || count !== tail.getUint16(eocd + 8, true) ||
      centralSize > 16 * 1024 * 1024 || centralOffset + centralSize > tailStart + eocd) {
    throw new Error('ZIPの中央ディレクトリが不正です');
  }
  const view = new DataView(await file.slice(centralOffset, centralOffset + centralSize).arrayBuffer());
  const entries = new Map<string, CentralEntry>();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let offset = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('ZIPの中央ディレクトリが途中で途切れています');
    }
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > view.byteLength || flags & 1 || ![0, 8].includes(compression) ||
        view.getUint16(offset + 34, true) !== 0 ||
        view.getUint32(offset + 42, true) >= centralOffset) {
      throw new Error('ZIPの項目情報が不正です');
    }
    let name: string;
    try {
      name = decoder.decode(new Uint8Array(view.buffer, offset + 46, nameLength));
    } catch {
      throw new Error('ZIPの項目名が不正です');
    }
    if (!allowedEntryName(name) || entries.has(name) ||
        size > (name === 'project.json' ? MAX_MANIFEST_BYTES : MAX_ENTRY_BYTES)) {
      throw new Error(`ZIPに許可されない項目があります: ${name}`);
    }
    entries.set(name, { size, crc, compression });
    offset = end;
  }
  if (offset !== view.byteLength) throw new Error('ZIPの中央ディレクトリに余分なデータがあります');
  return entries;
}

interface ExtractedZip {
  entries: Map<string, Blob>;
  cleanup: () => Promise<void>;
}

const IMPORT_OPFS_PREFIX = 'scan2fem-import-';
const IMPORT_LOCK = 'scan2fem-zip-import';

/** 再読込などで中断されたOPFSの一時ディレクトリを、他タブの取込と排他して掃除する。 */
export async function cleanupStaleZipImports(): Promise<void> {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };
  if (!storage.getDirectory || !navigator.locks) return;
  await navigator.locks.request(IMPORT_LOCK, async () => {
    const root = await storage.getDirectory!();
    const iterable = root as FileSystemDirectoryHandle & {
      entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    };
    for await (const [name, handle] of iterable.entries()) {
      if (name.startsWith(IMPORT_OPFS_PREFIX) && handle.kind === 'directory') {
        await root.removeEntry(name, { recursive: true });
      }
    }
  });
}

async function unzipBounded(file: Blob): Promise<ExtractedZip> {
  if (file.size === 0 || file.size > MAX_ZIP_BYTES) {
    throw new Error('ZIPファイルのサイズが許容範囲外です');
  }
  const central = await readCentralDirectory(file);
  const expandedHint = [...central.values()].reduce((sum, entry) => sum + entry.size, 0);
  if (expandedHint > MAX_EXPANDED_BYTES) {
    throw new Error('ZIPの展開後サイズが上限を超えています');
  }
  const useOpfs = expandedHint > MAX_IN_MEMORY_IMPORT_BYTES;
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };
  if (useOpfs && (!storage.getDirectory || !navigator.locks)) {
    throw new Error('64MiBを超えるZIPの取込にはOPFSとWeb Locks対応ブラウザが必要です');
  }
  const opfsRoot = useOpfs ? await storage.getDirectory!() : null;
  const tempName = useOpfs ? `${IMPORT_OPFS_PREFIX}${crypto.randomUUID()}` : null;
  const tempDir = opfsRoot && tempName
    ? await opfsRoot.getDirectoryHandle(tempName, { create: true })
    : null;
  const cleanup = async () => {
    if (opfsRoot && tempName) await opfsRoot.removeEntry(tempName, { recursive: true });
  };
  const entries = new Map<string, Blob>();
  const staged = new Map<string, Promise<FileSystemFileHandle>>();
  const writers: Array<Promise<FileSystemWritableFileStream>> = [];
  const names = new Set<string>();
  let expandedTotal = 0;
  let fatal: Error | null = null;
  let writeQueue = Promise.resolve();
  const unzip = new Unzip((entry) => {
    if (fatal) return;
    const expected = central.get(entry.name);
    if (names.size >= MAX_ENTRIES || names.has(entry.name) || !expected ||
        entry.compression !== expected.compression ||
        (entry.originalSize !== undefined && entry.originalSize !== expected.size)) {
      fatal = new Error(`ZIPに許可されない項目があります: ${entry.name}`);
      return;
    }
    names.add(entry.name);
    const parts: Uint8Array[] = [];
    const stagedHandle = tempDir
      ? tempDir.getFileHandle(entry.name === 'project.json' ? 'project.json' : entry.name.slice(7), { create: true })
      : null;
    if (stagedHandle) staged.set(entry.name, stagedHandle);
    const writable = stagedHandle?.then((handle) => handle.createWritable());
    if (writable) writers.push(writable);
    let size = 0;
    let crc = 0xffffffff;
    entry.ondata = (error, chunk, final) => {
      if (fatal) return;
      if (error) { fatal = error; return; }
      size += chunk.length;
      expandedTotal += chunk.length;
      crc = updateCrc(crc, chunk);
      if (size > expected.size ||
          size > (entry.name === 'project.json' ? MAX_MANIFEST_BYTES : MAX_ENTRY_BYTES) ||
          expandedTotal > MAX_EXPANDED_BYTES ||
          (!tempDir && expandedTotal > MAX_IN_MEMORY_IMPORT_BYTES)) {
        fatal = new Error('ZIPの展開後サイズが上限を超えています');
        entry.terminate();
        return;
      }
      if (writable) {
        const copy = chunk.slice();
        writeQueue = writeQueue.then(async () => {
          const stream = await writable;
          if (copy.length) await stream.write(new Uint8Array(copy));
          if (final) await stream.close();
        });
      } else if (chunk.length) {
        parts.push(chunk.slice());
      }
      if (final) {
        if (size !== expected.size || ((crc ^ 0xffffffff) >>> 0) !== expected.crc) {
          fatal = new Error(`ZIPの項目が破損しています: ${entry.name}`);
          return;
        }
        if (!writable) entries.set(entry.name, new Blob(parts as BlobPart[]));
      }
    };
    try { entry.start(); } catch (error) { fatal = error instanceof Error ? error : new Error(String(error)); }
  });
  unzip.register(UnzipInflate);
  const reader = file.stream().getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      for (let offset = 0; offset < value.length; offset += 8192) {
        unzip.push(value.subarray(offset, offset + 8192));
        if (fatal) throw fatal;
        await writeQueue;
      }
    }
    unzip.push(new Uint8Array(0), true);
    if (fatal) throw fatal;
    await writeQueue;
    if (names.size !== central.size || (!tempDir && entries.size !== names.size)) {
      throw new Error('ZIPの項目が途中で途切れています');
    }
    if (tempDir) {
      for (const [name, handle] of staged) entries.set(name, await (await handle).getFile());
      if (entries.size !== names.size) throw new Error('ZIPの一時保存が途中で途切れています');
    }
    return { entries, cleanup };
  } catch (error) {
    await writeQueue.catch(() => undefined);
    for (const writer of writers) {
      await writer.then((stream) => stream.abort()).catch(() => undefined);
    }
    await cleanup().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** インポート。ID衝突を避けるため全IDを振り直して新規プロジェクトとして取り込む */
export async function importProjectZip(file: Blob): Promise<Project> {
  if (navigator.locks) {
    return navigator.locks.request(IMPORT_LOCK, () => importProjectZipUnlocked(file));
  }
  return importProjectZipUnlocked(file);
}

async function importProjectZipUnlocked(file: Blob): Promise<Project> {
  const { entries, cleanup } = await unzipBounded(file);
  try {
    return await importProjectEntries(entries);
  } finally {
    await cleanup();
  }
}

async function importProjectEntries(entries: Map<string, Blob>): Promise<Project> {
  const manifestRaw = entries.get('project.json');
  if (!manifestRaw) throw new Error('project.json がありません(scan2femのZIPではありません)');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await manifestRaw.text()) as unknown;
  } catch {
    throw new Error('project.json がJSONとして不正です');
  }
  const manifestRecord = expectRecord(parsed, 'ルート');
  expectOnlyKeys(
    manifestRecord,
    ['format', 'version', 'exportedAt', 'project', 'stages', 'assets'],
    'ルート',
  );
  if (manifestRecord.format !== 'scan2fem-project') {
    throw new Error('対応していない形式です');
  }
  if (manifestRecord.version !== 1 && manifestRecord.version !== 2) {
    throw new Error('このZIPは新しい形式です。アプリを更新してから再度インポートしてください');
  }
  expectFiniteNumber(manifestRecord.exportedAt, 'exportedAt', { min: 0 });
  if (!Array.isArray(manifestRecord.stages) || !Array.isArray(manifestRecord.assets)) {
    throw new Error('project.json のプロジェクト・段階・アセット構造が不正です');
  }
  validateProject(manifestRecord.project);
  manifestRecord.stages.forEach((stage, index) => validateStage(stage, index));
  manifestRecord.assets.forEach((asset, index) => validateAsset(asset, index));
  const manifest: Manifest = {
    format: 'scan2fem-project',
    version: manifestRecord.version,
    exportedAt: manifestRecord.exportedAt as number,
    project: manifestRecord.project,
    stages: manifestRecord.stages,
    assets: manifestRecord.assets,
  };

  const stageIds = new Set<string>();
  const stageById = new Map<string, Stage>();
  for (const stage of manifest.stages) {
    if (stage.projectId !== manifest.project.id) {
      throw new Error(`段階「${stage.id}」のプロジェクト参照が不正です`);
    }
    if (stageIds.has(stage.id)) {
      throw new Error('project.json に不正または重複した段階IDがあります');
    }
    stageIds.add(stage.id);
    stageById.set(stage.id, stage);
  }
  for (const stage of manifest.stages) {
    if (stage.sourceStageId === stage.id) {
      throw new Error(`段階「${stage.id}」が自分自身を参照しています`);
    }
    if (
      stage.sourceStageId !== undefined &&
      stage.sourceStageId !== null &&
      !stageIds.has(stage.sourceStageId)
    ) {
      throw new Error(`段階「${stage.id}」の参照元がZIP内にありません`);
    }
  }
  for (const stage of manifest.stages) {
    const seen = new Set([stage.id]);
    let current: Stage | undefined = stage;
    while (current?.sourceStageId) {
      if (seen.has(current.sourceStageId)) {
        throw new Error(`段階「${stage.id}」の参照関係が循環しています`);
      }
      seen.add(current.sourceStageId);
      current = stageById.get(current.sourceStageId);
    }
  }

  const assetById = new Map<string, AssetMeta>();
  for (const asset of manifest.assets) {
    if (asset.projectId !== manifest.project.id) {
      throw new Error(`アセット「${asset.name}」のプロジェクト参照が不正です`);
    }
    if (assetById.has(asset.id)) {
      throw new Error('project.json に不正または重複したアセットIDがあります');
    }
    if (asset.stageId !== null && !stageIds.has(asset.stageId)) {
      throw new Error(`アセット「${asset.name}」の段階参照がZIP内にありません`);
    }
    assetById.set(asset.id, asset);
  }
  if (entries.size !== manifest.assets.length + 1 ||
      [...entries.keys()].some((name) => name !== 'project.json' &&
        !assetById.has(name.slice('assets/'.length)))) {
    throw new Error('ZIPにマニフェストから参照されない項目があります');
  }

  const calibration = manifest.project.scaleCalibration as
    | (NonNullable<Project['scaleCalibration']> & {
        sourceStageId?: string | null;
        sourceAssetId?: string | null;
      })
    | undefined;
  if (calibration) {
    const hasSourceStage = typeof calibration.sourceStageId === 'string';
    const hasSourceAsset = typeof calibration.sourceAssetId === 'string';
    if (hasSourceStage !== hasSourceAsset) {
      throw new Error('2点校正の参照元は段階とアセットの両方が必要です');
    }
    if (hasSourceStage && !stageIds.has(calibration.sourceStageId as string)) {
      throw new Error('2点校正の参照元段階がZIP内にありません');
    }
    if (hasSourceAsset && !assetById.has(calibration.sourceAssetId as string)) {
      throw new Error('2点校正の参照元アセットがZIP内にありません');
    }
    if (hasSourceStage && hasSourceAsset) {
      const sourceAsset = assetById.get(calibration.sourceAssetId as string)!;
      const assetStage = sourceAsset.stageId ? stageById.get(sourceAsset.stageId) : undefined;
      const coordinateStageId =
        sourceAsset.kind === 'mesh'
          ? (assetStage?.sourceStageId ?? assetStage?.id)
          : assetStage?.id;
      if (
        !['pointcloud', 'mesh'].includes(sourceAsset.kind) ||
        coordinateStageId !== calibration.sourceStageId
      ) {
        throw new Error('2点校正の参照元と座標系列が一致しません');
      }
    }
  }
  for (const asset of manifest.assets) {
    if (asset.thumbnailAssetId) {
      const thumbnail = assetById.get(asset.thumbnailAssetId);
      if (
        !['image', 'frame'].includes(asset.kind) ||
        thumbnail?.kind !== 'thumbnail' ||
        thumbnail.sourceAssetId !== asset.id ||
        thumbnail.stageId !== asset.stageId
      ) {
        throw new Error(`アセット「${asset.name}」のサムネイル参照が不正です`);
      }
    }
    if (asset.kind === 'thumbnail') {
      const source = asset.sourceAssetId ? assetById.get(asset.sourceAssetId) : undefined;
      if (
        !source ||
        !['image', 'frame'].includes(source.kind) ||
        source.thumbnailAssetId !== asset.id ||
        source.stageId !== asset.stageId
      ) {
        throw new Error(`サムネイル「${asset.name}」の原画参照が不正です`);
      }
    } else if (asset.sourceAssetId) {
      throw new Error(`アセット「${asset.name}」に不正な原画参照があります`);
    }
  }

  // 書き込みを始める前に、全アセットの本体データがZIP内に揃っているかを
  // 検証する(欠落を黙って飛ばすと「成功」表示なのに表示・出力できない
  // プロジェクトができてしまうため)
  const broken: string[] = [];
  for (const a of manifest.assets) {
    const data = entries.get(`assets/${a.id}`);
    if (!data) broken.push(`${a.name}(本体なし)`);
    else if (typeof a.size === 'number' && data.size !== a.size) {
      broken.push(`${a.name}(サイズ不一致: ${data.size}≠${a.size})`);
    }
  }
  if (broken.length > 0) {
    const head = broken.slice(0, 5).join('、');
    const rest = broken.length > 5 ? ` 他${broken.length - 5}件` : '';
    throw new Error(
      `ZIP内のアセット本体が欠落・破損しています: ${head}${rest}。壊れたZIPの可能性があるためインポートを中止しました(何も取り込んでいません)`,
    );
  }

  const idMap = new Map<string, string>();
  const remap = (oldId: string): string => {
    let v = idMap.get(oldId);
    if (!v) {
      v = uid();
      idMap.set(oldId, v);
    }
    return v;
  };

  const t = now();
  const remappedCalibration = calibration
    ? {
        ...calibration,
        sourceStageId:
          typeof calibration.sourceStageId === 'string'
            ? remap(calibration.sourceStageId)
            : undefined,
        sourceAssetId:
          typeof calibration.sourceAssetId === 'string'
            ? remap(calibration.sourceAssetId)
            : undefined,
      }
    : undefined;
  const project: Project = {
    ...manifest.project,
    id: remap(manifest.project.id),
    name: `${manifest.project.name}(インポート)`,
    ...(remappedCalibration ? { scaleCalibration: remappedCalibration } : null),
    updatedAt: t,
  };
  const stages: Stage[] = manifest.stages.map((s) => ({
    ...s,
    id: remap(s.id),
    projectId: project.id,
    sourceStageId: s.sourceStageId ? remap(s.sourceStageId) : null,
    // 旧形式ZIPに実行中stageが含まれる場合、ジョブ実行状態(checkpoint)は
    // 引き継げないため失敗扱いに変換する(永久に実行中のまま残るのを防ぐ)
    ...(s.status === 'running'
      ? {
          status: 'failed' as const,
          note: [s.note, '実行途中に出力されたZIPのため中断扱い'].filter(Boolean).join(' / '),
        }
      : null),
  }));
  // 旧v1実装が出力したZIPには同一(kind, seq)の段階が含まれ得る。そのまま
  // 書き込むとv2の一意index(byProjectKindSeq)に違反してトランザクション
  // 全体がabortし、バックアップを復元できなくなるため、ローカルDB移行
  // (db.ts)と同じ規則でkindごとに再採番する(sortは安定なので同値は
  // マニフェスト記載順を保つ)
  normalizeImportedStageSequences(stages);
  const assets: Array<{ meta: AssetMeta; oldId: string }> = manifest.assets.map((a) => ({
    oldId: a.id,
    meta: {
      ...a,
      id: remap(a.id),
      projectId: project.id,
      stageId: a.stageId ? remap(a.stageId) : null,
      thumbnailAssetId: a.thumbnailAssetId ? remap(a.thumbnailAssetId) : undefined,
      sourceAssetId: a.sourceAssetId ? remap(a.sourceAssetId) : undefined,
    },
  }));

  // Blob準備はtransaction開始前に完了させる。途中の失敗で部分取込を残さない。
  const preparedAssets = assets.map(({ meta, oldId }) => {
    const data = entries.get(`assets/${oldId}`)!; // 存在・サイズは上で検証済み
    return { meta, blob: data.slice(0, data.size, meta.mime) };
  });

  const d = await db();
  const tx = d.transaction(['projects', 'stages', 'assets', 'blobs'], 'readwrite');
  const puts: Promise<unknown>[] = [tx.objectStore('projects').put(project)];
  for (const s of stages) puts.push(tx.objectStore('stages').put(s));
  for (const { meta, blob } of preparedAssets) {
    puts.push(tx.objectStore('assets').put(meta));
    puts.push(tx.objectStore('blobs').put({ assetId: meta.id, blob }));
  }
  // requestとtx.doneの両方へ同時にreject handlerを登録し、ConstraintError等で
  // transactionがabortしても未処理rejectionを残さない。
  await Promise.all([...puts, tx.done]);
  return project;
}
