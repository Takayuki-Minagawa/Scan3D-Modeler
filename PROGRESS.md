# 開発進捗記録(PROGRESS)

**このファイルは開発の中断・再開のための引き継ぎ台帳です。**
作業を再開するときは、①このファイル ②[Webアプリ構築_作業計画.md](Webアプリ構築_作業計画.md) ③`git log` の3つを読めば状況を把握できます。作業を進めたら必ずこのファイルを更新してください。

最終更新: 2026-07-12(セッション1)

---

## 現在地

**フェーズ1(基盤+パイプライン貫通)を実装中。**
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

## 未確認・既知の課題

- [ ] 実カメラ(スマホ/USB/内蔵)での撮影動作 — HTTPSまたはlocalhostが必要。Android実機は `adb reverse tcp:5173 tcp:5173` で localhost 接続可
- [ ] 実動画でのフレーム抽出(webm duration=Infinity対策コードは実装済みだが実機未確認)
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
