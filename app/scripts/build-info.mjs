import { execSync } from 'node:child_process';

/**
 * 公開版とソースの対応を利用者が確認できるよう、コミット短縮ハッシュとビルド日時を返す。
 * vite.config.ts の define から呼ばれる。git が使えない環境では 'unknown' を返す。
 */
export function buildInfo() {
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    if (dirty) commit += '+';
  } catch {
    // git未導入やZIP展開ソースからのビルド
  }
  return { commit, builtAt: new Date().toISOString() };
}
