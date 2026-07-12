import { uid } from '../db/db';
import {
  appendJobStage,
  claimJobRun,
  confirmJobRun,
  createJobRecord,
  finalizeJobRun,
  getJob,
  listJobs,
  listRunningJobs,
  reconcileOrphanedJob,
  requestJobStop,
  updateJobForRun,
} from '../db/jobs';
import { getStage, setStageStatus } from '../db/stages';
import { errorToJobText, formatJobText, jobText } from './text';
import type { JobRecord, JobStopMode, JobText, JobType } from '../types';
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
  /** Progress text is persisted as a language-neutral descriptor. */
  report: (progress: number, message?: JobText) => void;
  saveCheckpoint: (cp: C) => Promise<void>;
  /**
   * エンジンが作成したstageをジョブに関連付ける。失敗/中止で終わったとき、
   * runningのまま残ったstageをfailedへ確定させるために必要。
   * 再開時にも呼んでよい(冪等)。
   */
  bindStage: (stageId: string) => Promise<void>;
  /**
   * stage確定など「データが変わった」ことをUIへ通知する(kind: 'change')。
   * 進捗通知(kind: 'progress')では一覧・3D表示は再読込されないため、
   * ジョブ完了前に成果物を表示へ反映したいタイミングで呼ぶ。
   */
  notifyDataChanged: () => void;
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
interface ActiveRun {
  controller: AbortController;
  runToken: string;
}
const controllers = new Map<string, ActiveRun>();

/**
 * ジョブ変化通知。購読側が「どのプロジェクトの・どの種類の変化か」で
 * 間引けるよう情報を付ける(全通知でビューア/ギャラリーのBlob再読込を
 * 走らせると、大きなモデル表示中はタブ間の進捗通知だけでjank/OOM要因になる)。
 */
export interface JobsChangedEvent {
  /** 対象プロジェクト。特定できない場合はnull(全プロジェクト扱い) */
  projectId: string | null;
  /**
   * progress: 実行中の進捗のみ(表示中の進捗バー更新用)
   * change:   状態遷移・stage/アセットのデータ変化(一覧・3D表示の再読込対象)
   */
  kind: 'progress' | 'change';
}
const listeners = new Set<(ev: JobsChangedEvent) => void>();

/** タブ間同期: 停止要求の転送と状態変化の通知 */
type ChannelMessage =
  | { type: 'changed'; event: JobsChangedEvent }
  | { type: 'stop'; jobId: string; runToken?: string; mode: JobStopMode };
const channel =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('scan2fem-jobs') : null;
channel?.addEventListener('message', (ev: MessageEvent<ChannelMessage>) => {
  const m = ev.data;
  if (m?.type === 'stop') {
    const active = controllers.get(m.jobId);
    // 古い/世代不明の停止要求が再開後の新しい実行を止めないよう必ず照合する。
    if (active && active.runToken === m.runToken) {
      active.controller.abort(new JobStopped(m.mode));
    }
  } else if (m?.type === 'changed') {
    notifyLocal(m.event ?? { projectId: null, kind: 'change' });
  }
});

export function registerEngine(type: JobType, engine: JobEngine): void {
  engines.set(type, engine);
}

/** ジョブ状態変化の購読(UI更新用)。他タブでの変化も通知される */
export function onJobsChanged(fn: (ev: JobsChangedEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyLocal(ev: JobsChangedEvent): void {
  for (const fn of listeners) fn(ev);
}

function emit(ev: JobsChangedEvent): void {
  notifyLocal(ev);
  channel?.postMessage({ type: 'changed', event: ev } satisfies ChannelMessage);
}

export async function startJob(
  type: JobType,
  projectId: string,
  titleText: JobText,
  params: Record<string, unknown>,
): Promise<string> {
  const runToken = uid();
  const job = await createJobRecord(type, projectId, titleText, params, runToken);
  void run(job.id, runToken);
  return job.id;
}

export async function resumeJob(jobId: string): Promise<void> {
  if (controllers.has(jobId)) return; // このタブで実行中
  // paused のときだけ running + 新しいrunToken へ条件付きで遷移(claim)する。
  // 二重resume(連打・別タブ)では先勝ちで、負けた呼び出しはnullを受け取り
  // 実行に進まないため、terminalジョブの再実行やstatusの巻き戻しが起きない
  const claimed = await claimJobRun(jobId, uid(), ['paused'], jobText('message.resumed'));
  if (!claimed) return;
  emit({ projectId: claimed.projectId, kind: 'change' });
  void run(jobId, claimed.runToken!);
}

export async function stopJob(
  jobId: string,
  mode: JobStopMode,
  runToken?: string,
): Promise<void> {
  // Controller登録前・terminal書込み中でも失わないようDB永続化を開始しつつ、
  // 実行タブにはAbortSignalで即時通知する。runTokenで古い要求を隔離する。
  const persisted = requestJobStop(jobId, runToken, mode);
  const active = controllers.get(jobId);
  if (active && active.runToken === runToken) {
    active.controller.abort(new JobStopped(mode));
  }
  channel?.postMessage({ type: 'stop', jobId, runToken, mode } satisfies ChannelMessage);
  const requested = await persisted;
  if (requested) {
    // 永続化待ちの間にControllerが登録された場合も取りこぼさない。同様に、
    // 受信タブが最初のBroadcast後にControllerを登録した場合へ再送する。
    const effectiveMode = requested.stopRequested ?? mode;
    const activeAfterPersist = controllers.get(jobId);
    if (activeAfterPersist && activeAfterPersist.runToken === runToken) {
      activeAfterPersist.controller.abort(new JobStopped(effectiveMode));
    }
    channel?.postMessage({
      type: 'stop',
      jobId,
      runToken,
      mode: effectiveMode,
    } satisfies ChannelMessage);
    emit({ projectId: requested.projectId, kind: 'change' });
  }
}

/**
 * プロジェクトの実行中ジョブを全タブで中止し、エンジン停止(=ロック解放)を待つ。
 * プロジェクト削除の前に必ず呼ぶこと(削除後の書き込みで孤児データが残るのを防ぐ)。
 */
export async function stopProjectJobs(projectId: string): Promise<void> {
  const jobs = await listJobs(projectId);
  const active = jobs.filter((j) => j.status === 'running');
  await Promise.all(active.map((j) => stopJob(j.id, 'cancel', j.runToken)));
  await Promise.all(active.map((j) => waitJobLockReleased(j.id, 5000)));
}

/** このタブで現在実行中か(操作ボタンの出し分けに使用) */
export function isJobLive(jobId: string): boolean {
  return controllers.has(jobId);
}

/**
 * 整合処理: どのタブも実行していない `running` ジョブを「一時停止」へ落とす。
 * checkpointが残っているため、ユーザーはそこから再開できる(作業計画 1A-4)。
 *
 * 判定はジョブごとの実行ロックを実際に取得した上で行う:
 * - ロックが取れない → いずれかのタブが実行中。触らない
 * - ロックが取れた → 保持したまま現在のstatusを読み直し、まだ `running` の
 *   場合のみ落とす。実行タブが直前に done/failed へ確定していれば何もしない
 *   (running一覧とロック一覧を別々に見るとその間の遷移で最新状態を
 *   巻き戻したり、逆に孤立ジョブを取りこぼしたりするため)
 * 起動時に加え、タブのfocus/表示復帰時にも呼ぶことで、実行タブが
 * クラッシュ・クローズした後にrunningのまま孤立したジョブも回復する。
 */
let reconciling = false;
let lastReconcileAt = 0;
let pendingReconcileDueAt: number | null = null;
let trailingTimer: ReturnType<typeof setTimeout> | null = null;

/** 間引き/実行中に来た要求を捨てず、指定時刻以降に1回へ集約する。 */
function scheduleReconcileAt(dueAt: number): void {
  pendingReconcileDueAt = Math.max(pendingReconcileDueAt ?? 0, dueAt);
  if (reconciling) return;
  if (trailingTimer) clearTimeout(trailingTimer);
  const wait = Math.max(0, pendingReconcileDueAt - Date.now());
  trailingTimer = setTimeout(() => {
    trailingTimer = null;
    pendingReconcileDueAt = null;
    void reconcileJobs(0);
  }, wait);
}

export async function reconcileJobs(minIntervalMs = 0): Promise<void> {
  const requestedAt = Date.now();
  // 実行中に来たwake要求は、そのイベント時点からminIntervalを保つ。
  // 長いreconcileの終了直後に即再実行してlock解放直前を再び外すのを防ぐ。
  const dueAt = reconciling
    ? requestedAt + minIntervalMs
    : Math.max(requestedAt, lastReconcileAt + minIntervalMs);
  // 実行中: 唯一のfocus/visibilityイベントを捨てず、終了後に必ず1回再実行する
  // (実行タブが閉じた直後にこのタブへ戻ってきた要求を取りこぼすと、孤立した
  //  runningジョブが再開もエクスポートもできないまま残るため)
  if (reconciling) {
    scheduleReconcileAt(dueAt);
    return;
  }
  // 間引き中: 残り時間の経過後に1回だけ再実行を予約する(同上の取りこぼし防止)
  if (dueAt > Date.now()) {
    scheduleReconcileAt(dueAt);
    return;
  }
  reconciling = true;
  try {
    lastReconcileAt = Date.now();
    for (const j of await listRunningJobs()) {
      if (controllers.has(j.id)) continue; // このタブで実行中
      await tryRunWithJobLock(j.id, async () => {
        const reconciled = await reconcileOrphanedJob(j.id);
        if (!reconciled) return;
        if (reconciled.status === 'canceled') {
          await failBoundStages(j.id, 'ジョブ中止により未完了');
        }
        emit({ projectId: reconciled.projectId, kind: 'change' });
      });
    }
  } finally {
    reconciling = false;
    // 実行中に来た要求は、元のminIntervalの期限を保ったままtrailing実行する。
    // focus時点で旧タブのlock解放が未完でも、期限後に再確認できる。
    if (pendingReconcileDueAt !== null) scheduleReconcileAt(pendingReconcileDueAt);
  }
}

/** エンジンのループ内で停止要求を検出するためのヘルパ */
export function throwIfStopped(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}

async function run(jobId: string, runToken: string): Promise<void> {
  if (controllers.has(jobId)) return;
  // 整合処理(reconcileJobs)が判定のため同じロックを瞬間的に保持している
  // ことがあるため、取得に失敗したら解放を短時間だけ待って1回再試行する
  for (let attempt = 0; ; attempt++) {
    const acquired = await tryRunWithJobLock(jobId, () => execute(jobId, runToken));
    if (acquired) return;
    if (attempt >= 1 || !(await waitJobLockReleased(jobId, 300))) break;
  }
  // 他タブがロック保持中 = 実行中。二重実行はしない
  const j = await getJob(jobId);
  const messageText = jobText('message.runningInAnotherTab');
  const changed = await updateJobForRun(jobId, runToken, {
    message: formatJobText(messageText, 'ja'),
    messageText,
  });
  if (changed) emit({ projectId: j?.projectId ?? null, kind: 'change' });
}

async function execute(jobId: string, runToken: string): Promise<void> {
  // ロックを取得した状態で、この実行要求(runToken)がまだ有効かを最終確認する。
  // 別タブが先に完了/失敗/中止させていたり、別のstart/resumeが新しいrunToken
  // でclaimし直していれば confirmJobRun は null を返す。Web Lockは同時実行を
  // 防ぐが、ロック解放後の再試行による逐次の再実行はこの照合で止める
  // (完了・中止済みジョブを取り直して無条件にrunningへ戻すのを防ぐ)。
  const confirmation = await confirmJobRun(jobId, runToken);
  if (!confirmation) return;
  if (confirmation.outcome === 'stopped') {
    if (confirmation.mode === 'cancel') {
      await failBoundStages(jobId, 'ジョブ中止により未完了');
    }
    emit({ projectId: confirmation.job.projectId, kind: 'change' });
    return;
  }
  const job = confirmation.job;
  const engine = engines.get(job.type);
  if (!engine) {
    await finalizeJobRun(jobId, runToken, {
      kind: 'failed',
      error: jobText('error.engineNotRegistered', { type: job.type }),
    });
    emit({ projectId: job.projectId, kind: 'change' });
    return;
  }
  const ac = new AbortController();
  controllers.set(jobId, { controller: ac, runToken });
  let lastPersist = 0;
  const ctx: JobContext = {
    job,
    params: job.params,
    checkpoint: job.checkpoint,
    signal: ac.signal,
    report: (progress, messageText) => {
      const t = Date.now();
      // 書き込み頻度を抑えつつ進捗を永続化する
      if (t - lastPersist > 300) {
        lastPersist = t;
        void updateJobForRun(jobId, runToken, {
          progress,
          ...(messageText
            ? { message: formatJobText(messageText, 'ja'), messageText }
            : null),
        }).then((changed) => {
          if (changed) emit({ projectId: job.projectId, kind: 'progress' });
        });
      }
    },
    saveCheckpoint: async (cp) => {
      await updateJobForRun(jobId, runToken, { checkpoint: cp });
    },
    bindStage: (stageId) => appendJobStage(jobId, stageId),
    notifyDataChanged: () => emit({ projectId: job.projectId, kind: 'change' }),
  };
  emit({ projectId: job.projectId, kind: 'change' });
  try {
    await engine(ctx);
    // エンジンが正常returnしても、最後のawait(stage確定・アセット更新など)中に
    // 停止要求が来ていれば done 化しない。停止要求を完了より優先することで、
    // 各エンジンが末尾で個別に停止確認をしなくても取りこぼさない(runner側で仲裁)
    throwIfStopped(ac.signal);
    const finalized = await finalizeJobRun(jobId, runToken, { kind: 'done' });
    if (finalized?.outcome === 'canceled') {
      await failBoundStages(jobId, 'ジョブ中止により未完了');
    }
  } catch (e) {
    if (e instanceof JobStopped) {
      const finalized = await finalizeJobRun(jobId, runToken, {
        kind: 'stopped',
        mode: e.mode,
      });
      if (finalized?.outcome === 'canceled') {
        await failBoundStages(jobId, 'ジョブ中止により未完了');
      }
    } else {
      const finalized = await finalizeJobRun(jobId, runToken, {
        kind: 'failed',
        error: errorToJobText(e),
      });
      if (finalized?.outcome === 'canceled') {
        await failBoundStages(jobId, 'ジョブ中止により未完了');
      } else if (finalized?.outcome === 'failed') {
        await failBoundStages(jobId, 'ジョブ失敗により未完了');
      }
    }
  } finally {
    if (controllers.get(jobId)?.runToken === runToken) controllers.delete(jobId);
    emit({ projectId: job.projectId, kind: 'change' });
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
