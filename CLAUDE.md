# CLAUDE.md

## このリポジトリについて

小型対象物の撮影画像からFEM用メッシュを作る**静的Webアプリ**(app/ 配下、Vite+React+TS)。
サーバ・GPUなし、全処理をブラウザ内で実行。FEM解析自体は対象外(外部ソルバへ出力するまで)。

## 作業を再開するとき(重要)

1. **必ず [PROGRESS.md](PROGRESS.md) を先に読む** — 現在地・対応表・次にやることが書いてある
2. [Webアプリ構築_作業計画.md](Webアプリ構築_作業計画.md) がフェーズ計画の正本
3. 作業後は PROGRESS.md を更新し、計画項目単位(例: `feat(app): 1C-4 スケール設定`)でコミットする

## コマンド

```bash
cd app && npm install
npm run dev        # 開発サーバ(localhost:5173)
npm run build      # tsc + vite build(コミット前に必ず通すこと)
```

## 設計上の約束

- 段階データ(stages)は**上書きせず追記**(seqを増やす)。使用書§25の履歴要件
- 長時間処理は必ずジョブエンジン(`app/src/jobs/runner.ts`)に載せ、
  ループ内で `saveCheckpoint()` + `throwIfStopped()` を呼び、中断再開可能にする
- 重い計算はWeb Workerへ。DOM依存処理(video等)のみメインスレッドのエンジンで行う
- 実再構成(SfM/MVS/Poisson/TetGen)は `pipeline/reconstructStub.ts` のIFに合わせて実装する。
  フェーズ0のWASM検証が先行タスク
- UI文言は日本語。合成デモデータには必ず「デモ」表示を付ける
