# 開発進捗記録(PROGRESS)

**このファイルは開発の中断・再開のための引き継ぎ台帳です。**
作業を再開するときは、①このファイル ②[Webアプリ構築_作業計画.md](Webアプリ構築_作業計画.md) ③`git log` の3つを読めば状況を把握できます。作業を進めたら必ずこのファイルを更新してください。

最終更新: 2026-07-12(セッション2: PR #1 レビュー対応)

---

## 現在地

**フェーズ1(基盤+パイプライン貫通)を実装中。PR #1 のレビュー指摘(P1×4, P2×7)対応済み。**
アプリ骨格・ジョブ再開基盤・画像取込・デモパイプライン・ビューア・出力までが動作確認済み。
実再構成(SfM/MVS/Poisson/TetGen のWASM化)は**フェーズ0検証が未着手**のため、スタブ+合成デモで代替中。

```
cd app && npm install && npm run dev   # http://localhost:5173
npm run build                          # 型チェック+本番ビルド
```

## 作業計画との対応表

| 計画項目 | 状態 | 実装場所/備考 |
|---|---|---|
| 1A-1 雛形+COOP/COEP+CI | ✅ | `app/vite.config.ts`, `.github/workflows/ci.yml` |
| 1A-2 プロジェクト管理 | ✅ | `app/src/db/projects.ts`, `app/src/ui/ProjectList.tsx`(使用書§7の項目。材料/解析目的は前提P5により除外) |
| 1A-3 ZIPエクスポート/インポート | ✅ | `app/src/export/zip.ts`(インポート時に全ID振り直し) |
| 1A-4 ジョブ基盤(進捗/中断/再開) | ✅ | `app/src/jobs/runner.ts`。checkpointをIndexedDB永続化。リロード後も「続きから再開」動作を実機確認済み |
| 1A-5 段階データ履歴モデル | ✅ | `app/src/db/stages.ts`(追記のみ、seq連番。使用書§25) |
| 1B-1 カメラ撮影UI | ✅(コード) | `app/src/capture/CapturePanel.tsx`。デバイス選択(スマホ/USB/内蔵)・静止画・録画。**実カメラでの動作確認は未実施**(検証環境にカメラなし) |
| 1B-2 ファイル取込 | ✅ | `app/src/capture/ImportPanel.tsx` |
| 1B-3 キーフレーム抽出+ブレ判定 | ✅(コード) | `app/src/capture/frameExtract.ts` + `workers/blur.worker.ts`。1フレーム毎checkpoint。**実動画での動作確認は未実施** |
| 1B-4 画像一覧・除外UI | ✅ | `app/src/capture/Gallery.tsx` |
| 1C-1〜3 SfM/MVS/サーフェス | 🔲 スタブのみ | `app/src/pipeline/reconstructStub.ts` にIF定義。**フェーズ0(WASM移植検証)が先** |
| 1C-4 スケール設定(2点間) | 🔲 未着手 | ビューアでの2点選択UIが必要。プロジェクト設定に方式のみ記録済み |
| 1D 3Dビューア | ✅ | `app/src/viewer/threeView.ts`。点群/メッシュ/タッチ対応/フィット |
| 1E 形状クリーニング | 🔲 未着手 | フェーズ0の後 |
| 1F-1〜2 四面体メッシュ | 🔲 スタブのみ | TetGen WASM移植待ち |
| 1F-3 出力 | 🔶 部分 | PLY/STL/ZIP実装済み(`app/src/export/formats.ts`)。MSH/VTU/INPは実メッシュ実装後 |

凡例: ✅完了 / 🔶部分完了 / 🔲未着手

## 動作確認済み(2026-07-12, Chrome/localhost)

- プロジェクト作成 → 一覧 → 削除
- デモ再構成ジョブ: 進捗表示 → **一時停止 → ページリロード → 「続きから再開」→ 完了**(チェックポイント再開の実証)
- 段階履歴: dense#1/#2, surface#1/#2 が追記保持されること
- ビューア: 72,000点の点群+サーフェス表示、穴の確認、フィット
- 出力: ZIP(1.7MB)/PLY/STLのエクスポート実行
- `npm run build`(tsc+vite)成功

## PR #1 レビュー対応(2026-07-12, セッション2)

レビュー指摘(P1×4, P2×7)+依存脆弱性に対応。主な変更:

| 指摘 | 対応 |
|---|---|
| 別タブからのジョブ二重実行(P1) | Web Locksでジョブ単位の排他ロック(`jobs/lock.ts`)。reconcileはロック保持中ジョブを触らない。停止要求・状態変化はBroadcastChannelでタブ間転送。`updateJob`は単一txnの読み書きで巻き戻し防止 |
| 実行中ZIPの再開不能/参照切れ(P1) | 実行中ジョブありは拒否。単一readonly txnでスナップショット取得+blob欠落は明示エラー。running stageは除外(インポート側も旧ZIPのrunningをfailedへ変換) |
| カメラstream競合(P1) | getUserMedia要求に世代番号。古い要求の解決時はtrack即停止 |
| ブレ除外フレームが重複基準を汚染(P1) | lastThumbの更新を採用(鮮明)フレームに限定 |
| 録画チャンク混在(P2) | チャンクをMediaRecorderごとのクロージャへ。保存完了まで次録画を禁止 |
| 実行中プロジェクト削除で孤児(P2) | 削除前に`stopProjectJobs`(全タブcancel+ロック解放待ち)。`createStage`/`addAsset`はproject存在をtxn内検証。削除も単一txn |
| stage採番競合(P2) | 採番と書き込みを単一readwrite txn化+DB v2で`(projectId,kind,seq)`のunique index |
| 失敗/中止ジョブのstageがrunning残留(P2) | `ctx.bindStage`でジョブとstageを関連付け、終了時にfailedへ確定 |
| デモ再構成の再開で成果物重複(P2) | stage IDを先にcheckpointへ確定→作りかけを掃除→同IDで再作成。ready済みはスキップ |
| ジョブ購読がパイプライン画面限定(P2) | 購読を常時マウントのProjectPageへ移動 |
| ビューアfitが縦画面で見切れ(P2) | 外接球半径と水平/垂直FOVの狭い方から距離を計算 |
| npm audit(esbuild/vite) | vite 8.1.4 / plugin-react 6.0.3 へ更新(0 vulnerabilities)。devサーバは`host: true`を廃止しlocalhost限定 |

### レビュー対応後の動作確認(Chrome/localhost, 2タブ)

- DB v1→v2 移行: 既存データ保持のままunique index作成
- **両タブ同時「続きから再開」→ 実行は片方のみ**(Web Lock、`isJobLive`で確認)
- 実行中に別タブをリロード → reconcileがジョブを一時停止に落とさない(status=runningのまま進行)
- **別タブから一時停止**(BroadcastChannel)→ checkpoint保存・ロック解放
- 2回の中断・タブをまたぐ再開後も dense/surface 各1件のみ生成(冪等)、running残留ゼロ
- 実行中のZIPエクスポート → 明示エラーで拒否
- **実行中プロジェクトの削除 → 孤児データゼロ**(stage/asset/job/blob、ジョブレコード復活なし)
- スマホ縦(375×812)でビューアfit → L字全体が見切れなく表示
- `npm run build` 成功、コンソールエラーなし

⚠️ カメラ・録画まわりの修正(stream世代管理・チャンク分離)はコードレビューと型検査のみで、実カメラでの動作確認は未実施(検証環境にカメラなし)。

## 未確認・既知の課題

- [ ] 実カメラ(スマホ/USB/内蔵)での撮影動作 — HTTPSまたはlocalhostが必要。Android実機は `adb reverse tcp:5173 tcp:5173` で localhost 接続可(レビュー対応のstream世代管理・録画チャンク分離も実機未確認)
- [ ] 実動画でのフレーム抽出(webm duration=Infinity対策コードは実装済みだが実機未確認)
- [ ] Web Locks非対応ブラウザ(Safari 15.3以前等)では単一実行保証がないため従来動作(単一タブ想定)にフォールバック
- [ ] iOS Safari(MediaRecorder/ImageCapture差異)
- [ ] バンドル692KB(Three.js) — コード分割は後回しで可
- [ ] Gallery: 画像を全件Blob URL化するためフレーム数百枚時に重い可能性 → サムネイル保存の検討
- [ ] 大容量ZIPのメモリ使用(fflateを全メモリで使用) → ストリーミング化の検討
- [ ] IndexedDBの容量制限に対する警告UI(navigator.storage.estimate)

## 次にやること(優先順)

1. **フェーズ0の技術検証**(作業計画§3): OpenMVG(または代替)のWASMビルド試行が最重要。
   成否によって 1C の実装方式が決まる。検証結果は `docs/phase0/` に記録すること
2. 1C-4 スケール設定UI(ビューアで2点選択 → 実測距離入力 → 点群スケーリング)
3. 検証用の実撮影データ(使用書§30の対象物)での 1B 実機確認
4. GitHub Pages等への配置(COOP/COEPヘッダ: Netlify推奨 or coi-serviceworker導入)

## 再開手順(使用制限などで中断した場合)

1. このファイルと `git log --oneline` で現在地を確認
2. `cd app && npm install && npm run dev` で起動確認
3. 上記「次にやること」から着手。コミットは計画項目単位で細かく
4. アプリ内の実行中ジョブはIndexedDBのcheckpointから「続きから再開」できる(ユーザーデータは失われない)
