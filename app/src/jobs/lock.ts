/**
 * ジョブの単一実行保証(Web Locks API)。
 *
 * 同一ブラウザの複数タブは同じIndexedDBを共有するため、ロックなしでは
 * 「タブAで実行中のジョブをタブBが再開して同じcheckpointを二重実行」できてしまう。
 * 実行中のタブはジョブごとの排他ロック `scan2fem-job-<id>` を保持し、
 * - 実行開始/再開はロックが取れた場合のみ行う
 * - 起動時整合(reconcile)はロック保持中のジョブを「生きている」とみなして触らない
 * - プロジェクト削除はロック解放待ちで他タブのエンジン停止を確認する
 * Web Locks非対応の古いブラウザでは従来動作(単一タブ想定)にフォールバックする。
 */
const PREFIX = 'scan2fem-job-';

export const webLocksSupported: boolean =
  typeof navigator !== 'undefined' && 'locks' in navigator;

export function jobLockName(jobId: string): string {
  return PREFIX + jobId;
}

/** いずれかのタブが実行ロックを保持しているジョブIDの集合 */
export async function heldJobLockIds(): Promise<Set<string>> {
  if (!webLocksSupported) return new Set();
  const state = await navigator.locks.query();
  return new Set(
    (state.held ?? [])
      .map((l) => l.name ?? '')
      .filter((n) => n.startsWith(PREFIX))
      .map((n) => n.slice(PREFIX.length)),
  );
}

/** ロックが取れた場合のみfnを実行する。他タブが保持中なら実行せずfalseを返す */
export async function tryRunWithJobLock(
  jobId: string,
  fn: () => Promise<void>,
): Promise<boolean> {
  if (!webLocksSupported) {
    await fn();
    return true;
  }
  let acquired = false;
  await navigator.locks.request(jobLockName(jobId), { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    acquired = true;
    await fn();
  });
  return acquired;
}

/** ジョブの実行ロック解放(=実行タブのエンジン停止完了)を待つ */
export async function waitJobLockReleased(jobId: string, timeoutMs: number): Promise<boolean> {
  if (!webLocksSupported) return true;
  try {
    await navigator.locks.request(
      jobLockName(jobId),
      { signal: AbortSignal.timeout(timeoutMs) },
      async () => {},
    );
    return true;
  } catch {
    // タイムアウト(実行タブがフリーズ等)。呼び出し側は書込み側の
    // project存在検証を安全網として処理を進める
    return false;
  }
}
