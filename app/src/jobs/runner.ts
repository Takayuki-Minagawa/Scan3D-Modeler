import { appendJobStage, createJobRecord, getJob, listJobs, updateJob } from '../db/jobs';
import { getStage, setStageStatus } from '../db/stages';
import type { JobRecord, JobType } from '../types';
import { tryRunWithJobLock, waitJobLockReleased } from './lock';

/**
 * ジョブ実行基盤(作業計画 1A-4)。
 *
 * 設計方針:
 * - 各ジョブは「エンジン」(async関数)として登録する。重い計算はエンジン内部で
 *   Web Workerへ委譲する(例: ブレ判定)。カメラ・<video>要素などDOMが必要な
 *   処理はメインスレッド側エンジンで行う。
 * - エンジンは処理の区切りごとに saveCheckpoint() を呼ぶ。checkpoint は
 *   IndexedDBに永続化されるため、一時停止・タブクローズ・ブラウザ強制終了の
 *   いずれでも「途中から再開」できる。
 * - 停止は2種類: pause(checkpoint保持、再開可能) / cancel(打ち切り)。
 * - 実行中はジョブごとのWeb Lockを保持し、複数タブからの二重実行を防ぐ
 *   (lock.ts)。停止要求と状態変化はBroadcastChannelでタブ間に転送する。
 */
export interface JobContext<P = Record<string, unknown>, C = unknown> {
  job: JobRecord;
  params: P;
  /** 再開時は前回保存したチェックポイント。初回は undefined */
  checkpoint: C | undefined;
  signal: AbortSignal;
  report: (progress: number, message?: string) => void;
  saveCheckpoint: (cp: C) => Promise<void>;
  /**
   * エンジンが作成したstageをジョブに関連付ける。失敗/中止で終わったとき、
   * runningのまま残ったstageをfailedへ確定させるために必要。
   * 再開時にも呼んでよい(冪等)。
   */
  bindStage: (stageId: string) => Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JobEngine = (ctx: JobContext<any, any>) => Promise<void>;

export class JobStopped extends Error {
  constructor(public mode: 'pause' | 'cancel') {
    super(`job ${mode}`);
    this.name = 'JobStopped';
  }
}

const engines = new Map<JobType, JobEngine>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();

/** タブ間同期: 停止要求の転送と状態変化の通知 */
type ChannelMessage =
  | { type: 'changed' }
  | { type: 'stop'; jobId: string; mode: 'pause' | 'cancel' };
const channel =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('scan2fem-jobs') : null;
channel?.addEventListener('message', (ev: MessageEvent<ChannelMessage>) => {
  const m = ev.data;
  if (m?.type === 'stop') {
    controllers.get(m.jobId)?.abort(new JobStopped(m.mode));
  } else if (m?.type === 'changed') {
    notifyLocal();
  }
});

export function registerEngine(type: JobType, engine: JobEngine): void {
  engines.set(type, engine);
}

/** ジョブ状態変化の購読(UI更新用)。他タブでの変化も通知される */
export function onJobsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyLocal(): void {
  for (const fn of listeners) fn();
}

function emit(): void {
  notifyLocal();
  channel?.postMessage({ type: 'changed' } satisfies ChannelMessage);
}

export async function startJob(
  type: JobType,
  projectId: string,
  title: string,
  params: Record<string, unknown>,
): Promise<string> {
  const job = await createJobRecord(type, projectId, title, params);
  void run(job.id);
  return job.id;
}

export async function resumeJob(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job || job.status !== 'paused' || controllers.has(jobId)) return;
  await updateJob(jobId, { status: 'running', error: undefined, message: '再開しました' });
  void run(jobId);
}

export function stopJob(jobId: string, mode: 'pause' | 'cancel'): void {
  controllers.get(jobId)?.abort(new JobStopped(mode));
  // 他タブで実行中の場合にも停止要求を届ける
  channel?.postMessage({ type: 'stop', jobId, mode } satisfies ChannelMessage);
}

/**
 * プロジェクトの実行中ジョブを全タブで中止し、エンジン停止(=ロック解放)を待つ。
 * プロジェクト削除の前に必ず呼ぶこと(削除後の書き込みで孤児データが残るのを防ぐ)。
 */
export async function stopProjectJobs(projectId: string): Promise<void> {
  const jobs = await listJobs(projectId);
  const active = jobs.filter((j) => j.status === 'running');
  for (const j of active) stopJob(j.id, 'cancel');
  await Promise.all(active.map((j) => waitJobLockReleased(j.id, 5000)));
}

/** このタブで現在実行中か(操作ボタンの出し分けに使用) */
export function isJobLive(jobId: string): boolean {
  return controllers.has(jobId);
}

/** エンジンのループ内で停止要求を検出するためのヘルパ */
export function throwIfStopped(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}

async function run(jobId: string): Promise<void> {
  if (controllers.has(jobId)) return;
  const acquired = await tryRunWithJobLock(jobId, () => execute(jobId));
  if (!acquired) {
    // 他タブがロック保持中 = 実行中。二重実行はしない
    await updateJob(jobId, { message: '別のタブで実行中です' });
    emit();
  }
}

async function execute(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) return;
  const engine = engines.get(job.type);
  if (!engine) {
    await updateJob(jobId, { status: 'failed', error: `エンジン未登録: ${job.type}` });
    emit();
    return;
  }
  // 起動直後に他タブのreconcileと競合した場合に備え、状態を実行中へ揃える
  await updateJob(jobId, { status: 'running' });
  const ac = new AbortController();
  controllers.set(jobId, ac);
  let lastPersist = 0;
  const ctx: JobContext = {
    job,
    params: job.params,
    checkpoint: job.checkpoint,
    signal: ac.signal,
    report: (progress, message) => {
      const t = Date.now();
      // 書き込み頻度を抑えつつ進捗を永続化する
      if (t - lastPersist > 300) {
        lastPersist = t;
        void updateJob(jobId, { progress, message }).then(emit);
      }
    },
    saveCheckpoint: async (cp) => {
      await updateJob(jobId, { checkpoint: cp });
    },
    bindStage: (stageId) => appendJobStage(jobId, stageId),
  };
  emit();
  try {
    await engine(ctx);
    await updateJob(jobId, { status: 'done', progress: 1, message: '完了' });
  } catch (e) {
    if (e instanceof JobStopped) {
      await updateJob(jobId, {
        status: e.mode === 'pause' ? 'paused' : 'canceled',
        message: e.mode === 'pause' ? '一時停止中(再開できます)' : '中止しました',
      });
      if (e.mode === 'cancel') await failBoundStages(jobId, 'ジョブ中止により未完了');
    } else {
      await updateJob(jobId, {
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      });
      await failBoundStages(jobId, 'ジョブ失敗により未完了');
    }
  } finally {
    controllers.delete(jobId);
    emit();
  }
}

/** 失敗/中止で終わったジョブが作成したrunningのstageをfailedへ確定させる */
async function failBoundStages(jobId: string, note: string): Promise<void> {
  const job = await getJob(jobId);
  for (const sid of job?.stageIds ?? []) {
    const s = await getStage(sid);
    if (s?.status === 'running') await setStageStatus(sid, 'failed', { 備考: note });
  }
}
