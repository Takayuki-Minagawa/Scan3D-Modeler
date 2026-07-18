import type { AssetMeta, ScaleCalibration, Stage, Unit } from '../types';
import type { MeasurementPoint } from './threeView';

export interface ScaleCalibrationSource {
  stageId?: string;
  assetId: string;
}

const MIN_DISTANCE = 1e-9;
const MIN_SCALE_FACTOR = 1e-9;
const MAX_SCALE_FACTOR = 1e9;

export function isValidScaleFactor(factor: number): boolean {
  return (
    Number.isFinite(factor) && factor >= MIN_SCALE_FACTOR && factor <= MAX_SCALE_FACTOR
  );
}

/** アセットが使う座標系。サーフェスは通常、元点群の段階IDを引き継ぐ。 */
export function scaleSourceForAsset(asset: AssetMeta, stage?: Stage): ScaleCalibrationSource {
  const stageId =
    asset.kind === 'mesh'
      ? (stage?.sourceStageId ?? stage?.id ?? asset.stageId ?? undefined)
      : (stage?.id ?? asset.stageId ?? undefined);
  return { stageId, assetId: asset.id };
}

/** provenanceのない旧校正は、安全のため新しい形状へ自動適用しない。 */
export function calibrationMatchesSource(
  calibration: ScaleCalibration | undefined,
  source: ScaleCalibrationSource | undefined,
): boolean {
  if (!calibration || !source || !isValidScaleFactor(calibration.factor)) return false;
  if (calibration.sourceStageId) return calibration.sourceStageId === source.stageId;
  if (calibration.sourceAssetId) return calibration.sourceAssetId === source.assetId;
  return false;
}

export function scaleSourcesMatch(
  left: ScaleCalibrationSource,
  right: ScaleCalibrationSource,
): boolean {
  if (left.stageId || right.stageId) return Boolean(left.stageId && left.stageId === right.stageId);
  return left.assetId === right.assetId;
}

export function modelDistance(a: MeasurementPoint, b: MeasurementPoint): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

export function makeScaleCalibration(
  points: readonly [MeasurementPoint, MeasurementPoint],
  measuredDistance: number,
  unit: Unit,
  source: ScaleCalibrationSource,
  updatedAt = Date.now(),
): ScaleCalibration {
  const rawDistance = modelDistance(points[0], points[1]);
  if (!Number.isFinite(rawDistance) || rawDistance <= MIN_DISTANCE) {
    throw new Error('選択した2点の間隔が小さすぎます。離れた2点を選択してください');
  }
  if (!Number.isFinite(measuredDistance) || measuredDistance <= 0) {
    throw new Error('実測距離には0より大きい値を入力してください');
  }
  if (!source.assetId || !source.stageId) {
    throw new Error('スケール校正の元データを特定できません');
  }
  const factor = measuredDistance / rawDistance;
  if (!isValidScaleFactor(factor)) {
    throw new Error('スケール倍率が有効範囲を超えています。入力した距離を確認してください');
  }
  return {
    factor,
    modelDistance: rawDistance,
    measuredDistance,
    unit,
    pointA: [...points[0]],
    pointB: [...points[1]],
    sourceStageId: source.stageId,
    sourceAssetId: source.assetId,
    updatedAt,
  };
}

/** 元配列を上書きせず、出力用座標へ校正倍率を適用する。 */
export function scaledPositions(positions: Float32Array, factor: number): Float32Array {
  if (!isValidScaleFactor(factor)) {
    throw new Error('保存済みのスケール倍率が不正です。校正をやり直してください');
  }
  if (factor === 1) return positions.slice();
  const scaled = new Float32Array(positions.length);
  for (let index = 0; index < positions.length; index += 1) {
    const value = positions[index] * factor;
    if (!Number.isFinite(value)) {
      throw new Error('スケール適用後の座標が有効範囲を超えています。校正をやり直してください');
    }
    scaled[index] = value;
  }
  return scaled;
}
