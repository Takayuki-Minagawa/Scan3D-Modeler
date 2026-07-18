# 開発進捗記録(PROGRESS)

**このファイルは開発の中断・再開のための引き継ぎ台帳です。**
作業を再開するときは、①このファイル ②[Webアプリ構築_作業計画.md](Webアプリ構築_作業計画.md) ③`git log` の3つを読めば状況を把握できます。作業を進めたら必ずこのファイルを更新してください。

最終更新: 2026-07-18(追加機能・ライセンス対応)

---

## 現在地

**フェーズ1(基盤+パイプライン貫通)を実装中。追加計画のA-1〜A-6、B-1〜B-4、C-1〜C-8を実装し、フェーズ0の再現可能な環境診断まで着手済み。**
MITライセンス・依存ライセンス検査、容量保全、保存サムネイル/EXIF、2点スケール、COI対応PWA、ビューアのコード分割が入った。
実再構成(OpenMVG/自前MVS/PoissonRecon/Manifold/fTetWild のWASM化)は**CMake/Emscripten未導入のためソースビルド未実施**で、引き続きスタブ+合成デモで代替中。

```
cd app && npm install && npm run dev   # http://localhost:5173
npm run build                          # ライセンス検査+型チェック+本番ビルド+PWA precache生成
```

## 作業計画との対応表

| 計画項目 | 状態 | 実装場所/備考 |
|---|---|---|
| 1A-1 雛形+COOP/COEP+CI | ✅ | `app/vite.config.ts`, `.github/workflows/ci.yml` |
| 1A-2 プロジェクト管理 | ✅ | `app/src/db/projects.ts`, `app/src/ui/ProjectList.tsx`(使用書§7の項目。材料/解析目的は前提P5により除外) |
| 1A-3 ZIPエクスポート/インポート | ✅ | `app/src/export/zip.ts`(インポート時に全ID/校正由来を振り直し、runtime schemaを検証) |
| 1A-4 ジョブ基盤(進捗/中断/再開) | ✅ | `app/src/jobs/runner.ts`。checkpointをIndexedDB永続化。リロード後も「続きから再開」動作を実機確認済み |
| 1A-5 段階データ履歴モデル | ✅ | `app/src/db/stages.ts`(追記のみ、seq連番。使用書§25) |
| 1B-1 カメラ撮影UI | ✅(コード) | `app/src/capture/CapturePanel.tsx`。デバイス選択(スマホ/USB/内蔵)・静止画・録画。**実カメラでの動作確認は未実施**(検証環境にカメラなし) |
| 1B-2 ファイル取込 | ✅ | `app/src/capture/ImportPanel.tsx`。原画+256pxサムネイル+EXIFを保存し、未知形式は原画を保持して個別スキップ |
| 1B-3 キーフレーム抽出+ブレ判定 | ✅(コード) | `app/src/capture/frameExtract.ts` + `workers/blur.worker.ts`。1フレーム毎checkpoint。**実動画での動作確認は未実施** |
| 1B-4 画像一覧・除外UI | ✅ | `app/src/capture/Gallery.tsx`。一覧はサムネイルのみ、詳細で原画/EXIFを遅延表示 |
| 1C-1〜3 SfM/MVS/サーフェス | 🔲 スタブのみ | `app/src/pipeline/reconstructStub.ts` にIF定義。**フェーズ0(WASM移植検証)が先** |
| 1C-4 スケール設定(2点間) | ✅ | `viewer/ViewerPanel.tsx`, `viewer/scale.ts`。レイキャスト/座標入力→実測距離→由来付き倍率保存。別再構成系列へ誤適用しない |
| 1D 3Dビューア | ✅ | `app/src/viewer/threeView.ts`。点群/メッシュ/タッチ/フィット/計測、遅延読込 |
| 1E 形状クリーニング | 🔲 未着手 | フェーズ0の後 |
| 1F-1〜2 四面体メッシュ | 🔲 スタブのみ | PoissonRecon→Manifold→fTetWildのWASM検証待ち |
| 1F-3 出力 | 🔶 部分 | PLY/STL/ZIP実装済み。座標系列一致時のみ校正倍率をPLY/STLへ適用。MSH/VTU/INPは実メッシュ実装後 |

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

## PR #1 再レビュー対応(2026-07-12, 3巡目: P1×1, P2×8, P3×1)

| 指摘 | 対応 |
|---|---|
| 旧v1 ZIPの重複seqをv2へ復元できない(P1) | import時にもkindごとにseqを再採番。payload/BlobはDB transaction前に準備 |
| Web Lock解放後にterminalジョブを逐次再実行(P2) | runTokenを開始/再開ごとにclaimし、lock取得後も同token・非terminalを単一txnで確認 |
| Controller登録前/完了確定中の停止要求が消失(P2) | stopRequestedをrunToken付きでDBへ永続化。done/failed/paused/canceledを単一txnで仲裁しcancelを優先 |
| focus/visibilityのreconcile間引きで孤立runningを取りこぼす(P2) | wakeイベント時点からの期限を保持し、実行中/間引き中の要求をtrailing実行 |
| 旧Viewer effectが後着して新geometry/非表示状態を上書き(P2) | 全I/O/decodeをlocalへ準備し、最終alive確認後にgeometry+visibility+stateを同期反映。欠損時はclear+明示エラー |
| ZIP準備中の同期例外で部分import(P2) | 全ArrayBuffer/Blobをtransaction開始前に生成し、全requestとtx.doneを同時監視 |
| MediaRecorder.start失敗後に録画不能(P2) | constructor/startを同じtryで保護し、handler/ref/状態を確実に解放してエラー表示 |
| カメラ切替後に偽のREC表示(P2) | track停止前にrecording→savingへ同期遷移。inactiveな残留Recorderも解放 |
| 同一動画の抽出ジョブを重複起動(P2) | createJobRecordのprojects/jobs単一txnでrunning/pausedを拒否。UIも別タブ通知と開始中状態で無効化 |
| db.tsの実NULでGitがbinary判定(P3) | ソース表記を`\u0000`へ変更(NUL byte 0件) |

### 3巡目対応後の動作確認(Chrome/localhost, 2タブ)

- **一時停止→2タブ同時再開**: claim成功は1タブだけ。両タブで同一進捗を表示し、成果物はdense/surface各1組のみ追加
- **別タブから一時停止**: stopRequested永続化+BroadcastChannelで両タブともpausedへ確定
- **ビューア表示OFFの維持**: 点群/サーフェスをOFFのまま別タブで再開・成果物更新後もcheckbox OFF、読込エラーなし
- **旧v1 ZIP seq正規化の純粋関数テスト**: dense 1,1,2→1,2,3 / surface 3,3→3,4 / gap 1,3は維持
- ZIP出力3.3MB成功、ブラウザ2タブのconsole warning/error 0件
- `npm run build`成功、`npm audit` 0件、`git diff --check`成功、NUL byte 0件
- 実カメラがないためMediaRecorder失敗/カメラ切替は型検査+ロジックレビューのみ(実機確認は継続課題)

## 公開UI・多言語対応(2026-07-12, セッション4)

- SVGファビコンを `app/public/favicon.svg` に追加し、`app/index.html` から参照するよう設定。スキャン枠と三角形メッシュをモチーフに、OSの明暗設定にも追従する配色とした
- `ui/theme.tsx` / `ThemeToggle.tsx` に端末設定・ライト・ダークのテーマ選択を追加。選択は `localStorage` に保存し、端末設定選択時はOSの変更にも追従。Three.jsビューアも `data-theme` を監視して背景・照明・点群・メッシュ・グリッドの配色を切り替える
- `i18n.tsx` に言語状態を追加。初期値はブラウザ言語に関わらず日本語で、画面上のボタンから英語へ切替可能。選択は `localStorage` に保存し、`html lang`、タイトル、descriptionも連動して更新する
- プロジェクト、取込、撮影、画像一覧、パイプライン、ビューア、出力の表示文言を日英化。作成済みジョブは言語非依存のtitle/message/errorキーで保存・表示時に翻訳し、旧IndexedDBレコードも安全にフォールバックする。動的な進捗・状態・エラーも言語切替に追従する
- アプリ内の「簡易マニュアル」を日英で追加。基本手順、デモの制約、FEM用途の注意、ブラウザ保存とカメラ要件、ZIPの再開状態に関する制約を明記。Escape、Tab循環、フォーカス復帰に対応
- プロジェクト行と画像の採用/除外操作を実ボタン化し、キーボードで操作可能にした。ライトテーマでは主要ボタン、タブ、進捗表示の文字コントラストを確保
- READMEを公開前提へ見直し。合成デモ・未実装範囲・非保証用途・ローカルデータ/プライバシー・ZIPの制約・ライセンス未設定を日英で明示

### 公開UI対応後の確認

- Chrome/localhostで日本語初期表示、英語切替、ライトテーマ切替、日英簡易マニュアルの表示を確認
- `npm run typecheck`、`npm run build` 成功。`npm audit` は脆弱性0件、`git diff --check` 成功
- 本番ビルドに `dist/favicon.svg` が含まれることを確認

## 追加機能・ライセンス対応(2026-07-18)

- **A-1〜A-6**: MIT `LICENSE` を追加し、README/package.json/配布物を統一。production npm依存とvendored/WASM由来コードの許可ライセンスをビルド/CIで検査し、`third-party-licenses.txt` とリポジトリLICENSEをdistへ同梱
- **B-1〜B-4**: MIT配布方針と両立しない同梱候補を計画から除外。OpenMVG(MPL-2.0)→自前MVS(MIT)→PoissonRecon(MIT)→Manifold(Apache-2.0)→fTetWild(MPL-2.0)へ検証経路を更新。libiglはMPLコアだけを候補とする
- **C-1/C-8**: `navigator.storage.estimate()/persist()` の容量・永続保存UI、80%警告、プロジェクト別概算、ZIP退避/個別削除導線を追加。撮影/取込/ジョブ中もプロジェクト画面で確認可能
- **C-2/C-6**: 原画と256px JPEGサムネイルをatomic保存。ギャラリーはサムネイルだけを常時読み、原画は詳細時に遅延読込。JPEG EXIFの寸法・日時・カメラ・焦点・撮像素子推定とSfM用`focalPx`候補を保存/表示
- **C-3**: 点群/サーフェスの2点選択または座標入力と実測距離からスケールを保存。元段階は不変。校正元stage/assetを記録し、別系列の表示/PLY/STLへ古い倍率を適用しない
- **C-4/C-5**: COI用Service WorkerとPWAを統合。build時に全配布アセットをhash付きprecacheへ注入し、初回準備後はオフライン起動可能。更新は作業中に強制reloadせず、明示操作で切替
- **C-7**: Three.jsビューアを`React.lazy`で分離。初期chunkを約748KBから約283KBへ縮小（viewer chunkは別読込）
- **フェーズ0着手**: `scripts/check-phase0-toolchain.sh` と `docs/phase0/` を追加。Node/npm/Gitは確認済み、CMake/Emscripten不足を記録。0-3〜0-5の実WASMビルドは固定ツールチェーン導入後に継続

### 追加対応の検証

- `npm run licenses:check` / `npm run licenses:verify` / `npm run typecheck` / `npm run build`
- PWA precacheへ13配布資源が注入されることを確認。新規originで初回導入→明示再読込→`WASM並列: 有効`、オンラインでプロジェクト作成/デモ生成、サーバ停止後のオフライン再読込と遅延viewer表示をブラウザ確認。console error/warning 0件
- ブラウザで座標A=(0,0,0)、B=(10,0,0)、実測25mmを入力し、倍率2.5の保存、表示距離25mm、校正由来付きZIP(846.9KB)出力まで確認
- ZIP importはProject/Stage/Asset/scaleCalibrationをruntime検証し、壊れた列挙値・非有限数・参照切れ・thumbnail関係をDB transaction前に拒否
- `npm audit`、`git diff --check`、依存ライセンスnoticeの再生成差分なしを確認

## 未確認・既知の課題

- [ ] 実カメラ(スマホ/USB/内蔵)での撮影動作 — HTTPSまたはlocalhostが必要。Android実機は `adb reverse tcp:5173 tcp:5173` で localhost 接続可(レビュー対応のstream世代管理・録画チャンク分離も実機未確認)
- [x] 実動画でのフレーム抽出 — 合成webm(canvas+MediaRecorder)でduration=Infinity経路含め確認済み。実カメラ撮影動画では未確認
- [ ] Web Locks非対応ブラウザ(Safari 15.3以前等)では単一実行保証がないため従来動作(単一タブ想定)にフォールバック
- [ ] iOS Safari(MediaRecorder/ImageCapture差異)
- [ ] PWA更新時の複数タブ長時間併用 — 旧cache保持/sole-client cleanupはコードレビュー済み。実端末で更新を跨ぐ長時間試験は継続QA
- [x] バンドル748KB(Three.js) — ビューアを遅延読込し初期chunk約283KBへ分割
- [x] Galleryの全原画Blob URL — 256pxサムネイルを別アセットとして保存し一覧で利用
- [ ] 大容量ZIPのメモリ使用(fflateを全メモリで使用) → ストリーミング化の検討
- [x] IndexedDBの容量制限に対する警告UI(navigator.storage.estimate/persist)

## 次にやること(優先順)

1. **フェーズ0の技術検証を継続**: 固定Emscripten/CMake環境でOpenMVG最小ターゲットのWASMビルド、Worker実行、メモリ、IndexedDB保存を検証
2. 自前MVSの最小品質試験とPoissonRecon→Manifold→fTetWildの貫通試験。記録は`docs/phase0/`へ追記
3. 検証用の実撮影データ(使用書§30の対象物)とAndroid/実カメラで1B・0-7・0-8を確認
4. C-9以降（大容量ZIPストリーミング、OPFS、複製、スクリーンショット）はフェーズ0の成果物サイズを踏まえて再優先付け

## 再開手順(使用制限などで中断した場合)

1. このファイルと `git log --oneline` で現在地を確認
2. `cd app && npm install && npm run dev` で起動確認
3. 上記「次にやること」から着手。コミットは計画項目単位で細かく
4. アプリ内の実行中ジョブはIndexedDBのcheckpointから「続きから再開」できる(ユーザーデータは失われない)
