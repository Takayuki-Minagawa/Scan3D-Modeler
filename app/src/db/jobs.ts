import { db, uid, now } from './db';
import { formatJobText, jobText } from '../jobs/text';
import type { JobRecord, JobStatus, JobStopMode, JobText, JobType } from '../types';

export class ActiveJobExistsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActiveJobExistsError';
  }
}

function strongerStop(a: JobStopMode | undefined, b: JobStopMode): JobStopMode {
  return a === 'cancel' || b === 'cancel' ? 'cancel' : 'pause';
}

function messageFields(text: JobText): Pick<JobRecord, 'message' | 'messageText'> {
  return { message: formatJobText(text, 'ja'), messageText: text };
}

function stoppedJob(j: JobRecord, mode: JobStopMode): JobRecord {
  const text = jobText(mode === 'pause' ? 'message.paused' : 'message.canceled');
  return {
    ...j,
    status: mode === 'pause' ? 'paused' : 'canceled',
    stopRequested: undefined,
    error: undefined,
    errorText: undefined,
    ...messageFields(text),
    updatedAt: now(),
  };
}

export async function createJobRecord(
  type: JobType,
  projectId: string,
  titleText: JobText,
  params: Record<string, unknown>,
  runToken: string,
): Promise<JobRecord> {
  const t = now();
  const job: JobRecord = {
    id: uid(),
    projectId,
    type,
    title: formatJobText(titleText, 'ja'),
    titleText,
    status: 'running',
    runToken,
    progress: 0,
    params,
    createdAt: t,
    updatedAt: t,
  };
  // project存在確認と追加を同一トランザクションで行い、別タブでの
  // プロジェクト削除と競合しても削除済みprojectIdを持つジョブを作らない
  const d = await db();
  const tx = d.transaction(['projects', 'jobs'], 'readwrite');
  const project = await tx.objectStore('projects').get(projectId);
  if (!project) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new Error('プロジェクトが見つかりません(削除された可能性があります)');
  }
  const jobs = tx.objectStore('jobs');
  // 同一動画のフレーム抽出は、running/pausedが既にあれば別job IDでも拒否する。
  // projects/jobsのreadwrite transaction内で確認するため、Web Locks非対応環境や
  // 2タブ同時開始でも先行transactionの作成結果を後続が必ず観測できる。
  const videoAssetId = params.videoAssetId;
  if (type === 'extractFrames' && typeof videoAssetId === 'string') {
    const existing = await jobs.index('byProject').getAll(projectId);
    if (
      existing.some(
        (j) =>
          j.type === 'extractFrames' &&
          (j.status === 'running' || j.status === 'paused') &&
          j.params.videoAssetId === videoAssetId,
      )
    ) {
      tx.abort();
      await tx.done.catch(() => undefined);
      throw new ActiveJobExistsError('この動画のフレーム抽出はすでに実行中または一時停止中です');
    }
  }
  await jobs.put(job);
  await tx.done;
  return job;
}

export async function getJob(id: string): Promise<JobRecord | undefined> {
  return (await db()).get('jobs', id);
}

/**
 * 実行権のclaim(開始・再開時)。単一トランザクションの条件付き更新で、
 * 現在のstatusが expect のいずれかのときだけ status='running' と新しい
 * runToken を書き込む。二重start/resume(同タブ連打・別タブ)では先勝ちし、
 * 負けた呼び出しは null を受け取って実行に進まないため、Web Lockと合わせて
 * 「多重に実行しない」だけでなく「逐次でも一度だけ実行する」を保証する。
 * claimできたら更新後のレコードを、できなければ null を返す。
 */
export async function claimJobRun(
  jobId: string,
  runToken: string,
  expect: JobStatus[],
  messageText?: JobText,
): Promise<JobRecord | null> {
  const d = await db();
  const tx = d.transaction('jobs', 'readwrite');
  const j = await tx.store.get(jobId);
  let claimed: JobRecord | null = null;
  if (j && expect.includes(j.status)) {
    claimed = {
      ...j,
      status: 'running',
      runToken,
      stopRequested: undefined,
      error: undefined,
      errorText: undefined,
      ...(messageText ? messageFields(messageText) : null),
      updatedAt: now(),
    };
    await tx.store.put(claimed);
  }
  await tx.done;
  return claimed;
}

/**
 * ロック取得後の最終確認。この実行要求(runToken)がまだ最新で、かつ
 * terminal(done/failed/canceled)でない場合のみ running へ揃えて更新後の
 * レコードを返す。別タブが先に完了/中止させていたり、別のstart/resumeが
 * 新しいrunTokenでclaimし直していれば null を返す(古い実行要求を破棄する)。
 * 整合処理(reconcile)がstatusをpausedへ落としていてもrunTokenは変えない
 * ため、一致する限りこの実行が正当と判断してrunningへ戻す。
 */
export type JobRunConfirmation =
  | { outcome: 'run'; job: JobRecord }
  | { outcome: 'stopped'; job: JobRecord; mode: JobStopMode };

export async function confirmJobRun(
  jobId: string,
  runToken: string,
): Promise<JobRunConfirmation | null> {
  const d = await db();
  const tx = d.transaction('jobs', 'readwrite');
  const j = await tx.store.get(jobId);
  let confirmed: JobRunConfirmation | null = null;
  if (j && j.runToken === runToken && (j.status === 'running' || j.status === 'paused')) {
    if (j.stopRequested) {
      const stopped = stoppedJob(j, j.stopRequested);
      confirmed = { outcome: 'stopped', job: stopped, mode: j.stopRequested };
      await tx.store.put(stopped);
    } else {
      const running = { ...j, status: 'running' as const, updatedAt: now() };
      confirmed = { outcome: 'run', job: running };
      await tx.store.put(running);
    }
  }
  await tx.done;
  return confirmed;
}

/** Controller登録前を含め、現在の実行世代に停止要求を永続化する。 */
export async function requestJobStop(
  jobId: string,
  runToken: string | undefined,
  mode: JobStopMode,
): Promise<JobRecord | null> {
  const d = await db();
  const tx = d.transaction('jobs', 'readwrite');
  const j = await tx.store.get(jobId);
  let requested: JobRecord | null = null;
  if (j && j.status === 'running' && j.runToken === runToken) {
    const stopRequested = strongerStop(j.stopRequested, mode);
    requested = {
      ...j,
      stopRequested,
      ...messageFields(jobText(stopRequested === 'cancel' ? 'message.canceling' : 'message.pausing')),
      updatedAt: now(),
    };
    await tx.store.put(requested);
  }
  await tx.done;
  return requested;
}

export type JobRunOutcome =
  | { kind: 'done' }
  | { kind: 'failed'; error: JobText }
  | { kind: 'stopped'; mode: JobStopMode };

export interface JobRunFinalization {
  job: JobRecord;
  outcome: 'done' | 'failed' | 'paused' | 'canceled';
}

/**
 * runToken照合とterminal遷移を単一transactionで行う。先に永続化された
 * stopRequestedがあれば、done/failedよりpause/cancelを優先する。
 */
export async function finalizeJobRun(
  jobId: string,
  runToken: string,
  outcome: JobRunOutcome,
): Promise<JobRunFinalization | null> {
  const d = await db();
  const tx = d.transaction('jobs', 'readwrite');
  const j = await tx.store.get(jobId);
  let finalized: JobRunFinalization | null = null;
  if (j && j.runToken === runToken && (j.status === 'running' || j.status === 'paused')) {
    const requested =
      outcome.kind === 'stopped'
        ? strongerStop(j.stopRequested, outcome.mode)
        : j.stopRequested;
    let next: JobRecord;
    if (requested) {
      next = stoppedJob(j, requested);
      finalized = {
        job: next,
        outcome: requested === 'pause' ? 'paused' : 'canceled',
      };
    } else if (outcome.kind === 'done') {
      next = {
        ...j,
        status: 'done',
        progress: 1,
        ...messageFields(jobText('message.completed')),
        error: undefined,
        errorText: undefined,
        stopRequested: undefined,
        updatedAt: now(),
      };
      finalized = { job: next, outcome: 'done' };
    } else if (outcome.kind === 'failed') {
      next = {
        ...j,
        status: 'failed',
        error: formatJobText(outcome.error, 'ja'),
        errorText: outcome.error,
        stopRequested: undefined,
        updatedAt: now(),
      };
      finalized = { job: next, outcome: 'failed' };
    } else {
      // outcome.kind === 'stopped' なら strongerStop() が必ずrequestedを返すため
      // 到達しない。型の網羅性を保つ安全網として同じ停止確定を行う。
      next = stoppedJob(j, outcome.mode);
      finalized = {
        job: next,
        outcome: outcome.mode === 'pause' ? 'paused' : 'canceled',
      };
    }
    await tx.store.put(next);
  }
  await tx.done;
  return finalized;
}

/** 実行lockを取得できた孤立runningを、停止要求込みで整合する。 */
export async function reconcileOrphanedJob(jobId: string): Promise<JobRecord | null> {
  const d = await db();
  const tx = d.transaction('jobs', 'readwrite');
  const j = await tx.store.get(jobId);
  let reconciled: JobRecord | null = null;
  if (j?.status === 'running') {
    reconciled = j.stopRequested
      ? stoppedJob(j, j.stopRequested)
      : {
          ...j,
          status: 'paused',
          ...messageFields(jobText('message.interrupted')),
          updatedAt: now(),
        };
    await tx.store.put(reconciled);
  }
  await tx.done;
  return reconciled;
}

/** 古い実行世代が最新レコードの進捗/message/checkpointを上書きしない部分更新。 */
export async function updateJobForRun(
  id: string,
  runToken: string,
  patch: Partial<JobRecord>,
): Promise<boolean> {
  const d = await db();
  const tx = d.transaction('jobs', 'readwrite');
  const j = await tx.store.get(id);
  const matches = !!j && j.status === 'running' && j.runToken === runToken;
  if (matches && j) {
    const next = {
      ...j,
      ...patch,
      id: j.id,
      status: j.status,
      runToken: j.runToken,
      updatedAt: now(),
    };
    // 停止要求後も最後のcheckpoint/progressは保存するが、UIの
    // 「一時停止/中止しています…」を通常進捗messageで上書きしない。
    if (j.stopRequested) {
      next.message = j.message;
      next.messageText = j.messageText;
    }
    await tx.store.put(next);
  }
  await tx.done;
  return matches;
}

/**
 * 部分更新。読み出し〜書き込みを単一トランザクションで行い、並行する更新
 * (進捗報告とcheckpoint保存など)の相互上書きによる巻き戻しを防ぐ。
 * レコードが削除済み(プロジェクト削除後など)なら何もしない。
 */
export async function updateJob(id: string, patch: Partial<JobRecord>): Promise<void> {
  const d = await db();
  const tx = d.transaction('jobs', 'readwrite');
  const j = await tx.store.get(id);
  if (j) await tx.store.put({ ...j, ...patch, id: j.id, updatedAt: now() });
  await tx.done;
}

/** ジョブが作成した段階(stage)を記録する。失敗/中止時の状態確定に使う */
export async function appendJobStage(id: string, stageId: string): Promise<void> {
  const d = await db();
  const tx = d.transaction('jobs', 'readwrite');
  const j = await tx.store.get(id);
  if (j && !(j.stageIds ?? []).includes(stageId)) {
    await tx.store.put({ ...j, stageIds: [...(j.stageIds ?? []), stageId], updatedAt: now() });
  }
  await tx.done;
}

export async function listJobs(projectId: string): Promise<JobRecord[]> {
  const all = await (await db()).getAllFromIndex('jobs', 'byProject', projectId);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listRunningJobs(): Promise<JobRecord[]> {
  return (await db()).getAllFromIndex('jobs', 'byStatus', 'running');
}
