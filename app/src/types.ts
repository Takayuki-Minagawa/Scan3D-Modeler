// ドメイン型定義(作業計画 §2.2 / 使用書 §7, §25)

export type Unit = 'mm' | 'cm' | 'm';

export interface ApproxSize {
  w: number;
  h: number;
  d: number;
}

export type CaptureMethod = 'video' | 'photos' | 'mixed';
export type ScaleMethod = 'marker' | 'knownDimension' | 'twoPoint' | 'later';

export interface Project {
  id: string;
  name: string;
  objectName: string;
  unit: Unit;
  approxSize: ApproxSize;
  captureMethod: CaptureMethod;
  scaleMethod: ScaleMethod;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

// 段階データ(使用書§25: 元データを上書きせず、各段階を履歴として保持する)
export type StageKind =
  | 'frames' //   キーフレーム抽出結果
  | 'sparse' //   カメラ位置推定(SfM)+疎点群 …… フェーズ0検証後に実装
  | 'dense' //    密点群
  | 'surface' //  サーフェス
  | 'cleaned' //  クリーニング済みサーフェス
  | 'femShape' // FEM用形状(理想化後)
  | 'mesh'; //    四面体メッシュ

export type StageStatus = 'running' | 'ready' | 'failed';

export interface Stage {
  id: string;
  projectId: string;
  kind: StageKind;
  /** 同一kind内の履歴連番(追記のみ。上書きしない) */
  seq: number;
  status: StageStatus;
  /** 合成デモデータ(実撮影由来ではない)であることの明示 */
  demo?: boolean;
  params?: Record<string, unknown>;
  stats?: Record<string, string | number>;
  sourceStageId?: string | null;
  note?: string;
  createdAt: number;
}

export type AssetKind = 'image' | 'video' | 'frame' | 'pointcloud' | 'mesh' | 'json';

export interface AssetMeta {
  id: string;
  projectId: string;
  /** 段階成果物はstageIdを持つ。撮影/取込画像はnull(画像プール) */
  stageId: string | null;
  kind: AssetKind;
  name: string;
  mime: string;
  size: number;
  /** パイプライン入力から除外(ユーザー操作または自動ブレ判定) */
  excluded?: boolean;
  quality?: { blur?: number; sharp?: boolean };
  meta?: Record<string, unknown>;
  createdAt: number;
}

export type JobType = 'extractFrames' | 'scoreImages' | 'demoReconstruct';
export type JobStatus = 'running' | 'paused' | 'done' | 'failed' | 'canceled';
export type JobStopMode = 'pause' | 'cancel';

/**
 * ジョブ実行記録。checkpoint を IndexedDB に永続化することで、
 * タブを閉じた後・リロード後でも途中から再開できる(作業計画 1A-4)。
 */
export interface JobRecord {
  id: string;
  projectId: string;
  type: JobType;
  title: string;
  status: JobStatus;
  /**
   * 実行権の識別子。開始/再開のたびに新しい値で条件付き更新(claim)され、
   * ロック取得後にこの値を照合することで、古い実行要求が完了・失敗・中止
   * 済みのジョブを再実行してしまうのを防ぐ(at-most-once実行)
  */
  runToken?: string;
  /**
   * 実行タブがAbortSignalを受け取る前でも停止要求を失わないための永続フラグ。
   * runTokenと同じtransactionで照合し、terminal遷移時に必ず消費する。
   */
  stopRequested?: JobStopMode;
  /** 0..1 */
  progress: number;
  message?: string;
  params: Record<string, unknown>;
  checkpoint?: unknown;
  /** このジョブが作成した段階データID。失敗/中止時にrunningのまま残さないための関連付け */
  stageIds?: string[];
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export const STAGE_ORDER: StageKind[] = [
  'frames',
  'sparse',
  'dense',
  'surface',
  'cleaned',
  'femShape',
  'mesh',
];

export const STAGE_LABEL: Record<StageKind, string> = {
  frames: 'キーフレーム',
  sparse: 'カメラ位置推定(SfM)',
  dense: '密点群',
  surface: 'サーフェス',
  cleaned: 'クリーニング済み',
  femShape: 'FEM用形状',
  mesh: '四面体メッシュ',
};

export const UNIT_LABEL: Record<Unit, string> = { mm: 'mm', cm: 'cm', m: 'm' };

export const SCALE_METHOD_LABEL: Record<ScaleMethod, string> = {
  marker: '寸法既知マーカー',
  knownDimension: '対象物上の既知寸法',
  twoPoint: '2点間の実測寸法を後で入力',
  later: '後で設定',
};

export const CAPTURE_METHOD_LABEL: Record<CaptureMethod, string> = {
  video: '動画',
  photos: '静止画',
  mixed: '動画+静止画',
};
