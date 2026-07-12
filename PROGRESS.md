# 開発進捗記録(PROGRESS)

**このファイルは開発の中断・再開のための引き継ぎ台帳です。**
作業を再開するときは、①このファイル ②[Webアプリ構築_作業計画.md](Webアプリ構築_作業計画.md) ③`git log` の3つを読めば状況を把握できます。作業を進めたら必ずこのファイルを更新してください。

最終更新: 2026-07-12(セッション2: PR #1 レビュー対応・再レビュー対応)

---

## 現在地

**フェーズ1(基盤+パイプライン貫通)を実装中。PR #1 のレビュー指摘は2巡目(P1×3, P2×9+残課題3)まで対応済み。**
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

## PR #1 再レビュー対応(2026-07-12, 2巡目: P1×3, P2×9+残課題3)

| 指摘 | 対応 |
|---|---|
| v1の重複seqでunique index構築が失敗しDBが開けない(P1) | v2移行でindex作成前に重複(projectId,kind,seq)を再採番するmigrationを追加 |
| 旧v1タブがあるとupgradeが無期限blockedで空画面(P1) | openDBの`blocked`で「他のタブを閉じてください」バナーを表示、接続成功時に自動除去 |
| reconcileのTOCTOU(done巻き戻し/孤立running取りこぼし)(P1) | 各ジョブのロックを実際に取得した状態でstatusを再読して判断。focus/visibility復帰時にも再整合(間引きあり)。run()はreconcileとの瞬間競合に1回だけ再試行 |
| createJobRecordがproject存在を見ない(P2) | projects/jobs同一txnで検証。UI側(パイプライン/取込/撮影)にもエラー表示を追加 |
| updateAssetのget/putが別txn(P2) | 単一readwrite txn化+project存在も同scopeで確認(削除済みメタの復活防止) |
| ZIPインポートが本体欠落を黙って飛ばす(P2) | 書込み前に全アセットの存在+サイズ一致を検証し、欠落は明示エラーで中止 |
| デモ再構成のsurface保存中に停止要求が観測されない(P2) | return前に`throwIfStopped`追加(frameExtractのready確定前にも)。成果物は冪等のため再開は即完了 |
| ビューア再読込で非表示設定が勝手に解除(P2) | geometry再作成直後に現在の表示ON/OFFを再適用 |
| 全通知でビューア/ギャラリーがBlob全再読込(P2) | 通知に`projectId`+種別(progress/change)を付与し、ProjectPageは自プロジェクトのchangeのみ反応(実測: デモ1回で再読込28回→4回) |
| カメラ起動失敗のcatchでstreamが解放されない(P2) | catch経路でtrack停止+ref/srcObject解除 |
| 全編ブレ動画で毎コマ全解像度JPEGを保存(P2) | ブレ画像同士の重複基準(lastBlurThumb)を追加。採用側の基準とは分離 |
| 静止画の採点が保存画像と別フレーム(P2) | 採点を保存canvasから算出 |
| blur workerエラーで永久待機(残課題) | error/messageerrorで保留中の全要求をreject、workerは作り直し |
| 保存動画を後から抽出する導線がない(残課題) | 取込画面に保存済み動画一覧+「フレーム抽出」ボタンを追加 |
| Vite 8のNode最低要件が未記載(残課題) | package.json `engines`とREADMEに20.19+/22.12+を明記 |

### 再レビュー対応後の動作確認(Chrome/localhost, 2タブ)

- **v1 DB(重複seq入り)→v2移行**: dense 1,1,2→1,2,3 / surface 3,3→3,4 に再採番、unique index作成、データ保持のまま起動
- **旧v1接続を別タブで保持**→アプリタブに案内バナー表示→接続を閉じると自動続行しバナー除去
- **孤立running(ロック保持者なし)**: リロードなしでfocusイベントのみで一時停止へ回復
- **実行中ジョブ(別タブ)**: focus reconcileが触らない(runningのまま完走)。done後のreconcileでも巻き戻しなし
- **通知イベント**: デモ1回でprogress24/change4(タブ間転送含む)。点群OFFのままジョブ完了→再読込後もOFF維持(スクリーンショット確認)
- **surface保存中のpause**: stagesストアをreadwriteホールドして保存中を再現→停止要求→解放後、done化せず一時停止(最終`throwIfStopped`で観測)。再開は新規stageゼロで即完了
- **削除済みプロジェクトでジョブ開始**→明示エラー・ジョブレコード0件
- **欠損ZIP**(アセット本体1件除去)→欠落アセット名入りエラーで拒否・部分取込なし。正常ZIPは取込成功(回帰なし)
- **合成webm実動画**(canvas+MediaRecorder、duration=Infinity経路): 全編ブレ3.2秒→保存1枚のみ(検査12コマ・採用0)。ノイズ+グレー混合→採用3枚・保存3枚で洪水なし。取込画面の「フレーム抽出」ボタン経由でも実行確認
- **updateAsset並行更新**(除外×画質を同時書込)→両方生存(lost updateなし)
- コンソールエラーなし(2タブとも)、`npm run build` 成功

## 未確認・既知の課題

- [ ] 実カメラ(スマホ/USB/内蔵)での撮影動作 — HTTPSまたはlocalhostが必要。Android実機は `adb reverse tcp:5173 tcp:5173` で localhost 接続可(レビュー対応のstream世代管理・録画チャンク分離も実機未確認)
- [x] 実動画でのフレーム抽出 — 合成webm(canvas+MediaRecorder)でduration=Infinity経路含め確認済み。実カメラ撮影動画では未確認
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
