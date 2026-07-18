/**
 * 実再構成パイプラインのインターフェース定義(作業計画 1C / フェーズ0)。
 *
 * ここに定義するプロトコルで SfM / MVS / サーフェス再構成のWASMワーカーを
 * 実装する予定。実装はフェーズ0(WASM移植検証)の結果待ちのため、現時点では
 * 「未実装」を明示するスタブのみ提供する。
 *
 * 実装時の予定構成(作業計画 §2.2):
 * - SfM:  OpenMVG (MPL-2.0)のWASM移植
 * - MVS:  自前PatchMatch (JS/WASM、代替: 疎点群+深度補間)
 * - 表面: PoissonRecon + Manifold + libiglコアのみ(copyleft配下は使用しない)
 * - 四面体: fTetWild (MPL-2.0)のWASM移植
 * 候補本体と推移依存は、実装前にCIのライセンス許可リストで検査する。
 */

/** SfM入力: 採用画像のID列とカメラ内部パラメータ推定設定 */
export interface SfmRequest {
  type: 'sfm';
  imageAssetIds: string[];
  maxImageDim: number;
}

/** SfM出力: カメラ姿勢と疎点群 */
export interface SfmResult {
  cameras: Array<{
    imageAssetId: string;
    /** 3x4 [R|t] 行優先 */
    pose: number[];
    focalPx: number;
  }>;
  sparsePoints: Float32Array;
  /** 画像ごとの再投影誤差(撮影品質マップの入力。フェーズ2) */
  reprojErrors: number[];
}

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(
      `${feature} は未実装です。フェーズ0(WASM移植検証)の完了後に実装します。` +
        '現在はデモ生成(合成データ)でパイプライン後段の動作を確認できます。' +
        '詳細: Webアプリ構築_作業計画.md §3 フェーズ0',
    );
    this.name = 'NotImplementedError';
  }
}

export function runSfm(_req: SfmRequest): Promise<SfmResult> {
  return Promise.reject(new NotImplementedError('カメラ位置推定(SfM)'));
}

export function runDenseReconstruction(): Promise<never> {
  return Promise.reject(new NotImplementedError('密点群生成(MVS)'));
}

export function runSurfaceReconstruction(): Promise<never> {
  return Promise.reject(new NotImplementedError('サーフェス再構成(Poisson)'));
}

export function runTetMeshing(): Promise<never> {
  return Promise.reject(new NotImplementedError('四面体メッシュ生成(fTetWild WASM)'));
}
