import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SharedArrayBuffer(将来のWASMスレッド並列化)に必要なヘッダ。
// 本番ホスティング側でも同じヘッダ設定が必要(作業計画 §2.2 R6 参照)。
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  // 静的ホスティングのサブパス配信でも動くよう相対パスにする
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  // 開発サーバは既定でlocalhostのみ待受(LANへは公開しない)。
  // Android実機確認は adb reverse を推奨(README参照)。LAN経由で確認したい
  // 場合のみ `npm run dev -- --host` を明示的に指定すること
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
});
