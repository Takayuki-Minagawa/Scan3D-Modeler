import { createJobRecord, getJob, updateJob } from '../db/jobs';
import type { JobRecord, JobType } from '../types';

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
 */
export interface JobContext<P = Record<string, unknown>, C = unknown> {
  job: JobRecord;
  params: P;
  /** 再開時は前回保存したチェックポイント。初回は undefined */
  checkpoint: C | undefined;
  signal: AbortSignal;
  report: (progress: number, message?: string) => void;
  saveCheckpoint: (cp: C) => Promise<void>;
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

export function registerEngine(type: JobType, engine: JobEngine): void {
  engines.set(type, engine);
}

/** ジョブ状態変化の購読(UI更新用) */
export function onJobsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn();
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
}

/** このタブで現在実行中か(pausedとの表示分けに使用) */
export function isJobLive(jobId: string): boolean {
  return controllers.has(jobId);
}

/** エンジンのループ内で停止要求を検出するためのヘルパ */
export function throwIfStopped(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}

async function run(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) return;
  const engine = engines.get(job.type);
  if (!engine) {
    await updateJob(jobId, { status: 'failed', error: `エンジン未登録: ${job.type}` });
    emit();
    return;
  }
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
    } else {
      await updateJob(jobId, {
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } finally {
    controllers.delete(jobId);
    emit();
  }
}
