# Scan2FEM — 小型対象物3Dスキャン・FEMモデル作成Webアプリ

小型対象物(10cm〜1m程度)をスマホ・USBカメラ・ノートPC内蔵カメラで撮影し、
画像から3D形状を再構成してFEM解析用のメッシュデータを作成する**静的Webアプリ**です。

- **サーバ不要**: すべての処理はブラウザ内(WebAssembly + Web Worker)で完結し、画像が外部へ送信されることはありません
- **対応端末**: Android(Chrome)/ Windows・Mac(Chrome / Edge / Safari)
- **FEM解析は行いません**: 本ツールの成果物はメッシュ・形状データまで。解析はCalculiX等の外部ソルバで実施してください

関連ドキュメント:

- [使用書案](小型対象物_3Dスキャン_FEMモデル作成Webアプリ_使用書案.md) — 完成形の仕様(一部は本構成へ改訂予定)
- [作業計画](Webアプリ構築_作業計画.md) — フェーズ分割・技術選定・リスク
- [進捗記録](PROGRESS.md) — **開発を再開するときはまずここを読む**

## 開発環境

```bash
cd app
npm install
npm run dev        # http://localhost:5173(既定でlocalhostのみ待受)
npm run build      # 型チェック + 本番ビルド(dist/)
npm run typecheck  # 型チェックのみ
```

開発サーバはセキュリティ上の理由からLANへ公開しません。同一LANの実機から
確認したい場合のみ、信頼できるネットワークで `npm run dev -- --host` を使ってください。

### Android実機での確認

カメラAPI(getUserMedia)はHTTPSまたはlocalhostでのみ動作します。
開発中は USB接続 + adb で localhost をフォワードするのが簡単です:

```bash
adb reverse tcp:5173 tcp:5173
# Android Chrome で http://localhost:5173 を開く
```

### 本番配置(静的ホスティング)

`app/dist/` を任意の静的ホスティングに配置します。将来のWASMスレッド並列化
(SharedArrayBuffer)に備え、次のレスポンスヘッダを設定してください:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

ヘッダを設定できないホスティング(GitHub Pages等)では coi-serviceworker の導入を検討してください。

## 現在の実装状況(フェーズ1)

| 機能 | 状態 |
|---|---|
| プロジェクト管理(IndexedDB、履歴保持) | ✅ |
| カメラ撮影(スマホ/USB/内蔵、静止画・録画) | ✅ |
| ファイル取込+ブレ自動判定 | ✅ |
| 動画キーフレーム抽出(中断・再開可能) | ✅ |
| ジョブ基盤(一時停止/中止/**リロード後の再開**) | ✅ |
| 3Dビューア(点群/サーフェス、タッチ対応) | ✅ |
| 出力(プロジェクトZIP / PLY / STL) | ✅ |
| カメラ位置推定(SfM)・密点群・サーフェス再構成 | 🔲 フェーズ0検証後(現在はデモ生成で代替) |
| 四面体メッシュ生成・MSH/VTU/INP出力 | 🔲 同上 |

長時間ジョブはチェックポイントをIndexedDBへ保存しながら実行されるため、
タブを閉じても・ブラウザが落ちても「続きから再開」できます。

## ディレクトリ構成

```
app/
  src/
    db/        IndexedDB層(projects/stages/assets/jobs)
    jobs/      ジョブ実行基盤(チェックポイント再開)・エンジン登録
    workers/   Web Worker(ブレ判定・デモ点群生成)
    capture/   カメラ撮影・ファイル取込・フレーム抽出・画像一覧
    pipeline/  パイプライン画面・デモ再構成・実再構成IF(スタブ)
    viewer/    Three.jsビューア
    export/    PLY/STL/内部メッシュ形式・プロジェクトZIP
    ui/        画面(一覧/プロジェクト/出力)・共通部品
```
