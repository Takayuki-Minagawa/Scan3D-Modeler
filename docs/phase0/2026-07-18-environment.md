# 2026-07-18 開発環境・ブラウザ基盤確認

## 結果

| 確認項目 | 結果 |
|---|---|
| Node.js | PASS: v22.18.0 |
| npm | PASS: 10.9.3 |
| CMake | 未導入 |
| Emscripten (`emcc` / `emcmake`) | 未導入 |
| GitHub PagesのCOOP/COEP代替 | `coi-serviceworker.js` とPWAランタイムキャッシュを統合して実装。初回制御後のnavigationを分離実行応答にする |
| 開発サーバのCOOP/COEP | Viteの `server.headers` / `preview.headers` を継続利用 |
| 2点スケールの実装経路 | Three.jsレイキャスト → 2点の生座標 → 実測距離/モデル距離 → Projectへ倍率保存 → 表示/PLY/STL出力へ適用 |

## 判定

ブラウザ側の分離実行、オフラインキャッシュ、スケール校正の検証入口は実装できた。一方、C++ライブラリのWASMビルドに必要なCMakeとEmscriptenがこの作業環境にないため、0-3〜0-5のソースビルドは未実施である。ツールチェーンを暗黙にインストールせず、`scripts/check-phase0-toolchain.sh` が不足を明示して終了する状態にした。

次回の0-3着手時はEmscripten SDKを固定リビジョンで用意し、まずOpenMVGのCLI全体ではなく、画像特徴抽出・マッチング・幾何推定に必要な最小ターゲットとファイルI/O境界を洗い出す。ビルド成功だけを完了扱いにせず、Worker実行、中断境界、メモリ上限、成果物永続化までを同じ記録へ残す。
