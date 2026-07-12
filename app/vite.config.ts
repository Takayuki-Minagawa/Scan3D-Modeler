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
  server: { headers: crossOriginIsolation, host: true },
  preview: { headers: crossOriginIsolation, host: true },
});
