# Scan2FEM

日本語 | [English](#english)

小型対象物を撮影した画像・動画を整理し、3D形状とFEM向けデータ作成の流れを試すための、ブラウザ内で動作する実験的な静的Webアプリです。Vite、React、TypeScriptで実装しています。

> [!WARNING]
> 現在の再構成結果は**合成データによるデモ**です。実撮影画像からのSfM/MVS/サーフェス再構成、四面体メッシュ生成、解析ソルバ向け形式の検証は未実装または未検証です。本ソフトウェアを設計判断、製造判断、安全判断、または検証済みFEMモデルの作成に使用しないでください。

## できること / 現在の範囲

| 機能 | 状況 |
| --- | --- |
| プロジェクト管理・履歴保持 | ブラウザのIndexedDBに保存。端末容量・プロジェクト別内訳・永続保存状態を表示 |
| 画像・動画の取込、ブレ判定、動画フレーム抽出 | 実装済み。保存サムネイル、EXIF表示、抽出ジョブの一時停止・再開に対応 |
| 再構成前の画像診断 | 採用・除外、解像度、ブレ、焦点距離候補、機種混在を表示。サムネイルから露出・近似重複の候補を示し、焦点距離候補と根拠を記録可能。復元可能性の判定ではありません |
| カメラ撮影UI（静止画・録画） | 実装済み。ただし実機カメラでの動作確認は未完了 |
| 外部3D形状の取込・ビューア | PLY点群・PLY三角面・ASCII/binary STLを入力単位指定で取り込み、別履歴として表示。合成デモも表示。タッチ操作と2点間スケール校正に対応 |
| 出力 | プロジェクトZIP、デモまたは外部取込形状由来のPLY/STLを出力。PLY/STLへ保存済みスケールを適用。ZIPは逐次生成・制限付き読込に対応 |
| オフライン利用 | PWAとしてインストール可能。初回準備後はアプリ本体をオフラインで起動可能 |
| 表示言語・外観 | 日本語を標準とし、英語／ライト・ダークテーマへ切替可能 |
| 簡易マニュアル | アプリ内で日本語・英語の手順を表示 |
| 実撮影画像の3D再構成（SfM/MVS/Poisson等） | 未実装。現在はデモ生成で代替 |
| 四面体メッシュ、MSH/VTU/INP出力 | 未実装 |
| FEM解析 | 対象外。外部ソルバで行ってください |

画面上で「デモ」と表示される形状・データは、実際に取り込んだ撮影データから生成されたものではありません。「外部取込」は読み込んだファイル由来であり、本アプリが撮影画像から再構成したものではありません。

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
3. 「パイプライン」で画像セット診断を確認します。必要なら「画像」で候補画像を確認し、焦点距離の候補と根拠を記録します。**デモ生成**で後段の流れを確認するか、「取込」でPLY/STLの入力単位を選択して実形状を追加できます。
4. 「ビューア」で点群・サーフェスを確認します。形状上の2点（またはX/Y/Z座標）と実測距離を指定すると、現在の再構成系列のスケールを設定できます。ここで表示されるデモ結果は実データの再構成結果ではありません。
5. 「出力」からプロジェクトZIPまたは対応するデータ形式を保存します。校正済みPLY/STLには倍率を適用しますが、IndexedDBとZIP内の元段階データは上書きしません。128MiBを超えるZIPは対応ブラウザの直接保存を利用します。

再構成をやり直して座標系列が変わると、以前の校正は自動適用されません。ビューアで2点を選び直してください。ストレージ使用率が高い場合は、プロジェクトZIPを退避してから不要なプロジェクトを削除できます。

アプリ内の「簡易マニュアル」では、同じ基本手順と制約を日本語・英語で確認できます。表示言語とライト／ダークテーマは画面上の切替ボタンから変更できます。

## 技術的な注意

- アプリはサーバを必要としない静的構成です。長時間ジョブはブラウザ内のWeb WorkerとIndexedDBを利用します。
- 実再構成用のWASMコンポーネントはまだ同梱していません。配布版はCOOP/COEP相当の応答を行うService Workerを備え、`crossOriginIsolated` の状態を画面に表示します。
- PWAは起動に必須のHTML/JavaScript/CSSだけを原子的にキャッシュし、遅延読込chunk・アイコン・ライセンス文書はアプリ起動後のアイドル時に個別失敗を許容して追加保存します。データ節約設定または低速回線では追加保存を行わず、利用時に保存します。更新版は作業中に強制再読込せず、画面の更新操作を選んだ時に切り替えます。オフライン利用は最初のオンライン読込と準備完了後に有効です。
- 3Dビューアと外部形状パーサは必要時に読み込まれます。外部形状の解析はWorkerで行います。現ビルドの初期chunkは約294KBです。
- 64MiB超のZIP展開データはOPFSを一時置場に使用します。OPFSまたはWeb Locks非対応ブラウザでは、そのサイズのZIP取込を拒否します。
- 開発中のGitHub Actionsと自動公開ワークフローは停止しています。検証はローカルの `npm run build` で行います。GitHub Pages公開時のみPages内部の実行を許可します。
- ブラウザのストレージ削除、シークレットモードの終了、容量制限などにより、ローカルデータが失われる場合があります。
- 既知の制約や開発中の項目は、公開利用の前にコードとリリースノートで確認してください。

## ライセンス

本リポジトリの独自コードは [MIT License](LICENSE) で提供します。Copyright (c) 2026 Takayuki Minagawa.

ブラウザ向け配布物には、それぞれのライセンスに従う第三者ソフトウェアが含まれます。著作権表示とライセンス本文は [第三者ソフトウェアライセンス一覧](app/public/third-party-licenses.txt) を参照してください。

本番依存を追加した場合は `npm run licenses:generate` でnoticeを再生成してください。依存パッケージにライセンス本文ファイルが同梱されていない場合、またはnoticeが依存関係と一致しない場合は、配布条件を確認できるまで `npm run build` が意図的に失敗します。

---

## English

Scan2FEM is an experimental, static web application for organizing photos and videos of small objects and exploring a 3D-shape-to-FEM-data workflow. It runs in the browser and is built with Vite, React, and TypeScript.

> [!WARNING]
> The current reconstruction output is **synthetic demo data**. SfM/MVS/surface reconstruction from real captures, tetrahedral meshing, and validation of solver-oriented output formats are not implemented or not validated yet. Do not use this software for engineering, manufacturing, safety, or other decisions that require a validated FEM model.

## Scope and status

| Capability | Current status |
| --- | --- |
| Project management and history | Stored in browser IndexedDB, with device usage, per-project breakdown, and persistence status |
| Image/video import, blur scoring, and video frame extraction | Implemented with saved thumbnails and EXIF display; extraction jobs can pause and resume |
| Pre-reconstruction image checks | Shows inclusion, resolution, blur, focal hints, and camera mix. Thumbnail-based exposure and similarity flags are candidates only; users can record a focal hint with its source |
| Camera capture UI (photos and recordings) | Implemented, but not yet validated with physical cameras |
| External geometry import and viewer | Imports PLY points/triangles and ASCII/binary STL with a selected input unit, preserving separate history. Also displays synthetic demo geometry and supports touch and two-point scale calibration |
| Export | Project ZIP and PLY/STL from demo or external geometry; saved scale is applied to PLY/STL. ZIP uses streaming output and bounded input |
| Offline use | Installable as a PWA; after initial preparation, the app shell can start offline |
| Language and appearance | Japanese by default; English and light/dark themes can be selected |
| Quick guide | Available in the app in Japanese and English |
| 3D reconstruction from real captures (SfM/MVS/Poisson, etc.) | Not implemented; demo generation is used instead |
| Tetrahedral meshing and MSH/VTU/INP export | Not implemented |
| FEM analysis | Out of scope; use an external solver |

Anything labeled “Demo” is not generated from imported capture data. “External import” comes from a file and is not a reconstruction of captured images by this app.

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
3. Check the image-set diagnostics in **Pipeline** and review flagged images in **Images**. Record a focal hint and its source if needed. Run **Generate demo** to inspect the downstream workflow, or add PLY/STL geometry with an explicit input unit in **Import**.
4. Inspect the point cloud and surface in **Viewer**. Pick two geometry points (or enter X/Y/Z coordinates) and their measured distance to calibrate the current reconstruction series. Demo results are not reconstructions of your input data.
5. Save a project ZIP or an available data format from **Export**. Calibrated PLY/STL receives the scale factor, while original stage data in IndexedDB and ZIP stays unchanged. ZIPs over 128 MiB require direct saving in a supported browser.

After reconstruction is rerun into a different coordinate series, an older calibration is not applied automatically; pick two points again. When storage usage is high, export a project ZIP before deleting unneeded projects.

The in-app quick guide presents the same workflow and limitations in Japanese and English. Use the on-screen controls to change the language and light/dark theme.

## Technical notes

- This is a serverless static application. Long-running jobs use browser Web Workers and IndexedDB.
- No WASM reconstruction component is bundled yet. The production app includes a Service Worker that supplies COOP/COEP-equivalent responses and reports `crossOriginIsolated` status in the UI.
- The PWA atomically precaches only the HTML/JavaScript/CSS required to boot. Lazy chunks, icons, and license documents are cached independently while the app is idle, so an optional download failure does not block installation. That warmup is skipped on data-saving or slow connections and those resources are cached when used instead. An update does not force-reload active work; it switches only after the on-screen update action is selected. Offline use becomes available after the first online load and preparation.
- The 3D viewer and external geometry parsers load on demand. External geometry is parsed in a Worker. The current initial JavaScript chunk is about 294 KB.
- ZIPs with over 64 MiB of expanded data use OPFS for temporary staging; importing them requires OPFS and Web Locks support.
- GitHub Actions and automatic deployment workflows are disabled during development. Validation uses the local `npm run build`; only the final GitHub Pages publication may run GitHub's internal Pages workflow.
- Browser storage can be lost through data clearing, private-browsing expiration, or storage limits.
- Review the source code and release notes before relying on an unfinished feature in a public deployment.

## License

Original code in this repository is available under the [MIT License](LICENSE). Copyright (c) 2026 Takayuki Minagawa.

The browser distribution includes third-party software under its respective licenses. See the [third-party software notices](app/public/third-party-licenses.txt) for copyright notices and license texts.

After adding a production dependency, regenerate the notices with `npm run licenses:generate`. `npm run build` intentionally fails until distribution terms can be verified when a package does not include its license text or when the generated notices no longer match the dependency tree.
