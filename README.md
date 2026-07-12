# Scan2FEM

日本語 | [English](#english)

小型対象物を撮影した画像・動画を整理し、3D形状とFEM向けデータ作成の流れを試すための、ブラウザ内で動作する実験的な静的Webアプリです。Vite、React、TypeScriptで実装しています。

> [!WARNING]
> 現在の再構成結果は**合成データによるデモ**です。実撮影画像からのSfM/MVS/サーフェス再構成、四面体メッシュ生成、解析ソルバ向け形式の検証は未実装または未検証です。本ソフトウェアを設計判断、製造判断、安全判断、または検証済みFEMモデルの作成に使用しないでください。

## できること / 現在の範囲

| 機能 | 状況 |
| --- | --- |
| プロジェクト管理・履歴保持 | ブラウザのIndexedDBに保存 |
| 画像・動画の取込、ブレ判定、動画フレーム抽出 | 実装済み。抽出ジョブは一時停止・再開に対応 |
| カメラ撮影UI（静止画・録画） | 実装済み。ただし実機カメラでの動作確認は未完了 |
| 3Dビューア | 合成デモの点群・サーフェスを表示。タッチ操作に対応 |
| 出力 | プロジェクトZIP、デモ形状由来のPLY/STLを出力 |
| 表示言語・外観 | 日本語を標準とし、英語／ライト・ダークテーマへ切替可能 |
| 簡易マニュアル | アプリ内で日本語・英語の手順を表示 |
| 実撮影画像の3D再構成（SfM/MVS/Poisson等） | 未実装。現在はデモ生成で代替 |
| スケール設定、四面体メッシュ、MSH/VTU/INP出力 | 未実装 |
| FEM解析 | 対象外。外部ソルバで行ってください |

画面上で「デモ」と表示される形状・データは、実際に取り込んだ撮影データから生成されたものではありません。

## ローカルデータとプライバシー

このリポジトリのアプリには、画像・動画・プロジェクトデータを受け取るバックエンドやアップロード機能は含まれていません。通常の利用では、これらのデータとジョブのチェックポイントは利用しているブラウザのIndexedDBに保存されます。プロジェクトZIPには撮影データと完了済み段階データを含められますが、実行中・一時停止中ジョブの再開状態は含まれません。

ただし、静的ホスティング事業者はアクセスログ等を取得し得ます。また、ブラウザ拡張機能、共有端末、ブラウザの同期・消去設定、端末のセキュリティ状態は本アプリの管理対象外です。機密情報、個人情報、規制対象データを扱う前に、利用環境と組織のポリシーを確認してください。必要なデータはプロジェクトZIPとして自分でバックアップしてください。

## はじめかた

必要環境: Node.js **20.19以降** または **22.12以降**。

```bash
cd app
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開きます。本番ビルドと型検査は次のとおりです。

```bash
npm run build
npm run typecheck
```

カメラAPIは安全なコンテキスト（HTTPSまたは`localhost`）でのみ利用できます。実機カメラや実撮影動画での互換性は、特にiOS Safariを含め、まだ十分に検証されていません。

## 使い方の概要

1. プロジェクトを作成します。
2. 「取込」画面から画像・動画を追加するか、同じ画面の「カメラ撮影」でカメラを許可して素材を追加します。
3. 「パイプライン」で**デモ生成**を実行すると、後段のビューアと出力の流れを確認できます。
4. 「ビューア」で点群・サーフェスを確認します。ここで表示されるデモ結果は実データの再構成結果ではありません。
5. 「出力」からプロジェクトZIPまたは対応するデータ形式を保存します。

アプリ内の「簡易マニュアル」では、同じ基本手順と制約を日本語・英語で確認できます。表示言語とライト／ダークテーマは画面上の切替ボタンから変更できます。

## 技術的な注意

- アプリはサーバを必要としない静的構成です。長時間ジョブはブラウザ内のWeb WorkerとIndexedDBを利用します。
- 実再構成用のWASMコンポーネントはまだ同梱していません。将来、SharedArrayBufferを使う並列WASMを追加する場合は、ホスティングでCOOP/COEPヘッダの設定が必要になる可能性があります。
- ブラウザのストレージ削除、シークレットモードの終了、容量制限などにより、ローカルデータが失われる場合があります。
- 既知の制約や開発中の項目は、公開利用の前にコードとリリースノートで確認してください。

## ライセンス

現時点で、このリポジトリにはライセンスファイルが含まれていません。利用、複製、改変、再配布に関する条件は、ライセンスが追加されるまで明示されていません。

---

## English

Scan2FEM is an experimental, static web application for organizing photos and videos of small objects and exploring a 3D-shape-to-FEM-data workflow. It runs in the browser and is built with Vite, React, and TypeScript.

> [!WARNING]
> The current reconstruction output is **synthetic demo data**. SfM/MVS/surface reconstruction from real captures, tetrahedral meshing, and validation of solver-oriented output formats are not implemented or not validated yet. Do not use this software for engineering, manufacturing, safety, or other decisions that require a validated FEM model.

## Scope and status

| Capability | Current status |
| --- | --- |
| Project management and history | Stored in browser IndexedDB |
| Image/video import, blur scoring, and video frame extraction | Implemented; extraction jobs can pause and resume |
| Camera capture UI (photos and recordings) | Implemented, but not yet validated with physical cameras |
| 3D viewer | Displays synthetic demo point clouds and surfaces; touch-friendly |
| Export | Project ZIP and PLY/STL derived from demo geometry |
| Language and appearance | Japanese by default; English and light/dark themes can be selected |
| Quick guide | Available in the app in Japanese and English |
| 3D reconstruction from real captures (SfM/MVS/Poisson, etc.) | Not implemented; demo generation is used instead |
| Scale setting, tetrahedral meshing, MSH/VTU/INP export | Not implemented |
| FEM analysis | Out of scope; use an external solver |

Anything labeled “Demo” in the application is not generated from imported capture data.

## Local data and privacy

The application in this repository has no backend or upload feature for images, videos, or project data. In normal use, those data and job checkpoints are stored in the IndexedDB of the browser being used. A project ZIP can include captures and completed stage data, but it does not include resume state for in-progress or paused jobs.

Static hosting providers may still collect access logs. Browser extensions, shared devices, browser sync/clearing settings, and endpoint security are outside this app’s control. Review your environment and organizational policy before handling confidential, personal, or regulated data. Back up data you need by exporting a project ZIP yourself.

## Getting started

Requirements: Node.js **20.19+** or **22.12+**.

```bash
cd app
npm install
npm run dev
```

Open `http://localhost:5173` in a browser. Build and type-check with:

```bash
npm run build
npm run typecheck
```

Camera APIs require a secure context (HTTPS or `localhost`). Compatibility with physical cameras and real captured videos has not been sufficiently validated, including on iOS Safari.

## Basic workflow

1. Create a project.
2. Add images or videos from **Import**, or allow camera access in the **Camera capture** section on the same screen.
3. Run **Generate demo** in **Pipeline** to inspect the downstream viewer and export flow.
4. Inspect the point cloud and surface in **Viewer**. Demo results are not reconstructions of your input data.
5. Save a project ZIP or an available data format from **Export**.

The in-app quick guide presents the same workflow and limitations in Japanese and English. Use the on-screen controls to change the language and light/dark theme.

## Technical notes

- This is a serverless static application. Long-running jobs use browser Web Workers and IndexedDB.
- No WASM reconstruction component is bundled yet. If future work adds threaded WASM using SharedArrayBuffer, the host may need COOP/COEP response headers.
- Browser storage can be lost through data clearing, private-browsing expiration, or storage limits.
- Review the source code and release notes before relying on an unfinished feature in a public deployment.

## License

No license file is currently included in this repository. Terms for use, copying, modification, and redistribution are not stated until a license is added.
