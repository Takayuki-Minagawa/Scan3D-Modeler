import { strToU8, strFromU8, unzip, zip, type Zippable } from 'fflate';
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
const FOCAL_PX_SOURCES = new Set(['exifFocalPlaneResolution', 'exif35mmEquivalent']);
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

function zipAsync(data: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(data, { level: 0 }, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

export async function exportProjectZip(projectId: string): Promise<ExportZipResult> {
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

  const manifest: Manifest = {
    format: 'scan2fem-project',
    version: 2,
    exportedAt: now(),
    project,
    stages,
    assets,
  };
  const files: Zippable = {
    'project.json': strToU8(JSON.stringify(manifest, null, 1)),
  };
  for (const a of assets) {
    const blob = blobs.get(a.id);
    if (blob) files[`assets/${a.id}`] = new Uint8Array(await blob.arrayBuffer());
  }
  const out = await zipAsync(files);
  const buf = new ArrayBuffer(out.byteLength);
  new Uint8Array(buf).set(out);
  return {
    blob: new Blob([buf], { type: 'application/zip' }),
    excludedRunningStages: allStages.length - stages.length,
  };
}

/** インポート。ID衝突を避けるため全IDを振り直して新規プロジェクトとして取り込む */
export async function importProjectZip(file: Blob): Promise<Project> {
  const entries = await unzipAsync(new Uint8Array(await file.arrayBuffer()));
  const manifestRaw = entries['project.json'];
  if (!manifestRaw) throw new Error('project.json がありません(scan2femのZIPではありません)');
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(manifestRaw)) as unknown;
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
    const data = entries[`assets/${a.id}`];
    if (!data) broken.push(`${a.name}(本体なし)`);
    else if (typeof a.size === 'number' && data.byteLength !== a.size) {
      broken.push(`${a.name}(サイズ不一致: ${data.byteLength}≠${a.size})`);
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

  // ArrayBuffer/Blob生成はtransaction開始前に完了させる。大容量データの
  // allocationが同期throwしても、DB書込みを1件もqueueしていないため
  // 部分プロジェクトも未処理のrequest rejectionも残らない。
  const preparedAssets = assets.map(({ meta, oldId }) => {
    const data = entries[`assets/${oldId}`]; // 存在・サイズは上で検証済み
    const buf = new ArrayBuffer(data.byteLength);
    new Uint8Array(buf).set(data);
    return { meta, blob: new Blob([buf], { type: meta.mime }) };
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
