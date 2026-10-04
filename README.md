# Scan2FEM

日本語 | [English](#english)

小型対象物を撮影した画像・動画を整理し、3D形状とFEM向けデータ作成の流れを試すための、ブラウザ内で動作する実験的な静的Webアプリです。Vite、React、TypeScriptで実装しています。

[公開版を開く](https://takayuki-minagawa.github.io/Scan3D-Modeler/)

> [!WARNING]
> 現在の再構成結果は**合成データによるデモ**です。実撮影画像からのSfM/MVS/サーフェス再構成、四面体メッシュ生成、解析ソルバ向け形式の検証は未実装または未検証です。本ソフトウェアを設計判断、製造判断、安全判断、または検証済みFEMモデルの作成に使用しないでください。

## できること / 現在の範囲

| 機能 | 状況 |
| --- | --- |
| プロジェクト管理・履歴保持 | ブラウザのIndexedDBに保存。端末容量・プロジェクト別内訳・永続保存状態を表示 |
| 画像・動画の取込、ブレ判定、動画フレーム抽出 | 実装済み。保存サムネイル、EXIF表示、抽出ジョブの一時停止・再開に対応 |
| 再構成前の画像診断 | 採用・除外、解像度、ブレ、焦点距離候補、機種混在を表示。サムネイルから露出・近似重複の候補を示し、焦点距離候補と根拠を記録可能。復元可能性の判定ではありません |
| カメラ撮影UI（静止画・録画） | 実装済み。ただし実機カメラでの動作確認は未完了 |
| 外部3D形状の取込・ビューア | PLY点群・三角形／四角形面、ASCII/binary STLを入力単位指定で取り込み、別履歴として表示。合成デモも表示。タッチ操作と2点間スケール校正に対応 |
| 形状診断 | 保存履歴から対象を選び、寸法・三角形面積合計・退化面・境界辺・非多様体辺・向き不整合・重複面を非破壊で検査。条件と由来を含むJSONを保存可能 |
| 出力 | プロジェクトZIP、保存履歴を選んで点群PLY／サーフェスPLY・STLを出力。由来が一致する保存済みスケールを適用。ZIPは保存前に復元上限を検査 |
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

ブラウザで `http://localhost:5173` を開きます。ローカルの回帰テスト、本番ビルド、型検査は次のとおりです。

```bash
npm test
npm run build
npm run typecheck
```

カメラAPIは安全なコンテキスト（HTTPSまたは`localhost`）でのみ利用できます。実機カメラや実撮影動画での互換性は、特にiOS Safariを含め、まだ十分に検証されていません。

## 使い方の概要

1. プロジェクトを作成します。
2. 「取込」画面から画像・動画を追加するか、同じ画面の「カメラ撮影」でカメラを許可して素材を追加します。
3. 「パイプライン」で画像セット診断を確認します。必要なら「画像」で候補画像を確認し、焦点距離の候補と根拠を記録します。**デモ生成**で後段の流れを確認するか、「取込」でPLY/STLの入力単位を選択して実形状を追加できます。
4. 「ビューア」で点群・サーフェスを確認します。形状上の2点（またはX/Y/Z座標）と実測距離を指定すると、現在の再構成系列のスケールを設定できます。ここで表示されるデモ結果は実データの再構成結果ではありません。
5. 「形状診断」で保存履歴から点群またはサーフェスを選び、「形状を診断」を実行します。結果と検査条件を確認し、必要なら「診断JSONを保存」で記録します。
6. 「出力」からプロジェクトZIPを保存します。形状は保存履歴を選び、点群をPLY、サーフェスをPLYまたはSTLで保存できます。校正済みPLY/STLには倍率を適用しますが、IndexedDBとZIP内の元段階データは上書きしません。128MiBを超えるZIPは対応ブラウザの直接保存を利用します。形状出力はWorkerで処理し、中止できます。読込先では同じプロジェクト単位を指定してください。

再構成をやり直して座標系列が変わると、以前の校正は自動適用されません。ビューアで2点を選び直してください。ストレージ使用率が高い場合は、プロジェクトZIPを退避し、復元できることを確認してから不要なプロジェクトを削除できます。

ZIPの保存・復元上限は、1ファイル256MiB、展開データとZIP本体は各1GiB、最大9,999アセット（管理情報を含め10,000項目）、管理情報8MiBです。出力前にヘッダ等を含むZIPサイズと本体データのサイズ整合性を検査し、上限超過・不整合を拒否します。上限を超えるプロジェクトは元データを保持してください。直接保存でもこの復元上限は変わりません。

アプリ内の「簡易マニュアル」では、同じ基本手順と制約を日本語・英語で確認できます。表示言語とライト／ダークテーマは画面上の切替ボタンから変更できます。

## 形状の入力と診断の範囲

PLY 1.0はASCII、binary little-endian、binary big-endianに対応します。点群または三角形／四角形面を受け付け、四角形は2枚の三角形に分割します。5頂点以上の多角形、欠けたデータ、宣言と一致しないデータ長、不正な座標や面索引は拒否します。XYZ座標と面索引を保存し、色・UV・法線などの付加属性は検査して読み飛ばします。外部形状の取込上限は32MiB、保存する頂点と三角形はそれぞれ100万個です。STLは三角形ごとに頂点を持つため、頂点数の上限も適用されます。binary STLは宣言面数とファイル長の完全一致、ASCII STLは全体の構文と各面の3頂点を検査し、欠損面や余剰データを部分取込せず拒否します。サーフェスPLY出力は保存頂点と三角面索引を保持します。

診断は選択した履歴だけを対象にし、元の形状を変更しません。その形状と由来が一致するスケール校正だけを適用し、PLY/STL出力と同じFloat32座標で計算します。寸法はプロジェクト単位、面積はその2乗の単位です。別系列の校正や未校正の状態を表示し、JSONには対象のasset／stage、デモ・外部取込などの由来、単位、適用倍率、作成日時、検査条件、未検査項目を含めます。

寸法は全保存頂点の軸に平行な外接箱です。三角形面積の合計は重複面や重なりも含みます。面積が厳密に0の面を退化面として数え、辺の検査から除外します。辺の検査時だけ完全一致するXYZ座標を同一頂点として扱い、1面の境界辺、3面以上の非多様体辺、ちょうど2面が共有する辺の向き不整合を数えます。重複面は向きを区別せずに数えます。

辺と重複面の検査は頂点・三角形がそれぞれ20万個以下の場合に実施し、どちらかが超えると寸法・面積・退化面だけを計算して、残りは「未実施」と表示します。点群の面積と辺は対象外です。処理はWorkerで実行し、中止・画面離脱・30秒の時間切れで終了します。自己交差、頂点多様体性、外向き法線、近接点の統合、細長い三角形の品質、実形状との精度は検査しません。検出が0件でも、水密性・体積の妥当性・FEM適合性を保証しません。

## 技術的な注意

- アプリはサーバを必要としない静的構成です。長時間ジョブはブラウザ内のWeb WorkerとIndexedDBを利用します。
- 実再構成用のWASMコンポーネントはまだ同梱していません。配布版はCOOP/COEP相当の応答を行うService Workerを備え、`crossOriginIsolated` の状態を画面に表示します。
- PWAは起動に必須のHTML/JavaScript/CSSだけを原子的にキャッシュし、遅延読込chunk・アイコン・ライセンス文書はアプリ起動後のアイドル時に個別失敗を許容して追加保存します。データ節約設定または低速回線では追加保存を行わず、利用時に保存します。更新版は作業中に強制再読込せず、画面の更新操作を選んだ時に切り替えます。オフライン利用は最初のオンライン読込と準備完了後に有効です。
- 3Dビューアと外部形状パーサは必要時に読み込まれます。外部形状の解析と形状診断はWorkerで行います。現ビルドの初期chunkは約318KBです。
- 保存形状の読込・検証をビューア、出力、診断で共通化しています。ZIP復元時も形状本体をDBへの最初の書込み前に検査し、破損した座標や面索引を含むZIPを部分保存せず拒否します。
- 64MiB超のZIP展開データはOPFSを一時置場に使用します。OPFSまたはWeb Locks非対応ブラウザでは、そのサイズのZIP取込を拒否します。
- 開発中のGitHub Actionsと自動公開ワークフローは停止しています。検証はローカルの `npm test` と `npm run build` で行います。GitHub Pages公開時のみPages内部の実行を許可します。
- ブラウザのストレージ削除、シークレットモードの終了、容量制限などにより、ローカルデータが失われる場合があります。
- 既知の制約や開発中の項目は、公開利用の前にコードとリリースノートで確認してください。

## ライセンス

本リポジトリの独自コードは [MIT License](LICENSE) で提供します。Copyright (c) 2026 Takayuki Minagawa.

ブラウザ向け配布物には、それぞれのライセンスに従う第三者ソフトウェアが含まれます。著作権表示とライセンス本文は [第三者ソフトウェアライセンス一覧](app/public/third-party-licenses.txt) を参照してください。

本番依存を追加した場合は `npm run licenses:generate` でnoticeを再生成してください。依存パッケージにライセンス本文ファイルが同梱されていない場合、またはnoticeが依存関係と一致しない場合は、配布条件を確認できるまで `npm run build` が意図的に失敗します。

---

## English

Scan2FEM is an experimental, static web application for organizing photos and videos of small objects and exploring a 3D-shape-to-FEM-data workflow. It runs in the browser and is built with Vite, React, and TypeScript.

[Open the live app](https://takayuki-minagawa.github.io/Scan3D-Modeler/)

> [!WARNING]
> The current reconstruction output is **synthetic demo data**. SfM/MVS/surface reconstruction from real captures, tetrahedral meshing, and validation of solver-oriented output formats are not implemented or not validated yet. Do not use this software for engineering, manufacturing, safety, or other decisions that require a validated FEM model.

## Scope and status

| Capability | Current status |
| --- | --- |
| Project management and history | Stored in browser IndexedDB, with device usage, per-project breakdown, and persistence status |
| Image/video import, blur scoring, and video frame extraction | Implemented with saved thumbnails and EXIF display; extraction jobs can pause and resume |
| Pre-reconstruction image checks | Shows inclusion, resolution, blur, focal hints, and camera mix. Thumbnail-based exposure and similarity flags are candidates only; users can record a focal hint with its source |
| Camera capture UI (photos and recordings) | Implemented, but not yet validated with physical cameras |
| External geometry import and viewer | Imports PLY points/triangles/quads and ASCII/binary STL with a selected input unit, preserving separate history. Also displays synthetic demo geometry and supports touch and two-point scale calibration |
| Geometry diagnostics | Select a stored history entry to inspect dimensions, triangle area, degenerate faces, boundary/non-manifold edges, inconsistent winding and duplicate faces without changing it. Save a JSON report with methods and provenance |
| Export | Project ZIP and history-selected point-cloud PLY or surface PLY/STL; applies source-matched calibration. ZIP export checks restore limits before writing |
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

Open `http://localhost:5173` in a browser. Run local regression tests, build and type-check with:

```bash
npm test
npm run build
npm run typecheck
```

Camera APIs require a secure context (HTTPS or `localhost`). Compatibility with physical cameras and real captured videos has not been sufficiently validated, including on iOS Safari.

## Basic workflow

1. Create a project.
2. Add images or videos from **Import**, or allow camera access in the **Camera capture** section on the same screen.
3. Check the image-set diagnostics in **Pipeline** and review flagged images in **Images**. Record a focal hint and its source if needed. Run **Generate demo** to inspect the downstream workflow, or add PLY/STL geometry with an explicit input unit in **Import**.
4. Inspect the point cloud and surface in **Viewer**. Pick two geometry points (or enter X/Y/Z coordinates) and their measured distance to calibrate the current reconstruction series. Demo results are not reconstructions of your input data.
5. In **Diagnostics**, choose a point cloud or surface from the stored history and select **Inspect geometry**. Review the results and methods, then use **Save diagnostics JSON** if needed.
6. Save a project ZIP from **Export**, or select stored geometry from history: PLY for point clouds and PLY/STL for surfaces. Calibrated PLY/STL receives the scale factor, while original stage data in IndexedDB and ZIP stays unchanged. ZIPs over 128 MiB require direct saving in a supported browser. Geometry export runs in a cancelable Worker. Select the same project unit in the receiving application.

After reconstruction is rerun into a different coordinate series, an older calibration is not applied automatically; pick two points again. When storage usage is high, export a project ZIP and verify restoration before deleting unneeded projects.

ZIP export and restoration support at most 256 MiB per file, 1 GiB each for expanded data and the ZIP itself, 9,999 assets (10,000 entries including metadata), and 8 MiB of metadata. Export checks ZIP overhead and asset-size consistency before writing and rejects oversized or inconsistent archives. Keep the original data if these limits are exceeded; direct saving has the same restore limits.

The in-app quick guide presents the same workflow and limitations in Japanese and English. Use the on-screen controls to change the language and light/dark theme.

## Geometry input and inspection scope

PLY 1.0 supports ASCII, binary little-endian and binary big-endian input. Point clouds, triangles and quads are accepted; each quad is split into two triangles. Polygons with five or more vertices, incomplete payloads, mismatched payload lengths, invalid coordinates and invalid face indices are rejected. XYZ coordinates and face indices are retained; ancillary properties such as colors, UVs and normals are validated and skipped. External input is limited to 32 MiB and one million stored vertices and triangles each. STL stores vertices per triangle, so the vertex limit also applies. Binary STL requires the declared triangle count to match the exact file length. ASCII STL validates the complete structure and three vertices per face; incomplete facets and extra data are rejected instead of partially imported. Surface PLY export preserves stored vertices and triangle indices.

Inspection uses the selected history entry and never modifies the stored geometry. Calibration applies only when its source matches that geometry. Calculations use the same scaled Float32 coordinates as PLY/STL export; lengths use the project unit and areas its square. The UI identifies missing or different-source calibration. JSON reports include the asset/stage, demo/external origin, unit, applied scale, creation time, methods and unchecked items.

Dimensions describe an axis-aligned bounding box of all stored vertices. Area sums include duplicate and overlapping triangles. Exactly zero-area faces count as degenerate and are excluded from edge checks. Inspection groups exactly equal XYZ coordinates, then counts edges incident to one face, edges incident to three or more faces, and winding inconsistencies along edges incident to exactly two faces. Duplicate-face counts ignore winding.

Edge and duplicate-face checks run only when both vertex and triangle counts are at most 200,000. Above either limit, dimensions, area and degenerate faces are still inspected, with the remaining checks explicitly marked skipped. Area and edges do not apply to point clouds. A Worker performs the inspection and stops on cancellation, leaving the tab, or a 30-second timeout. Self-intersections, vertex manifoldness, outward orientation, near-coincident vertices, thin-triangle quality and physical accuracy are unchecked. Zero findings do not certify watertightness, valid volume or FEM suitability.

## Technical notes

- This is a serverless static application. Long-running jobs use browser Web Workers and IndexedDB.
- No WASM reconstruction component is bundled yet. The production app includes a Service Worker that supplies COOP/COEP-equivalent responses and reports `crossOriginIsolated` status in the UI.
- The PWA atomically precaches only the HTML/JavaScript/CSS required to boot. Lazy chunks, icons, and license documents are cached independently while the app is idle, so an optional download failure does not block installation. That warmup is skipped on data-saving or slow connections and those resources are cached when used instead. An update does not force-reload active work; it switches only after the on-screen update action is selected. Offline use becomes available after the first online load and preparation.
- The 3D viewer and external geometry parsers load on demand. External geometry parsing and geometry inspection run in Workers. The current initial JavaScript chunk is about 318 KB.
- The viewer, exports and diagnostics share stored-geometry loading and validation. ZIP restoration also checks geometry payloads before the first database write, rejecting invalid coordinates or face indices without saving a partial project.
- ZIPs with over 64 MiB of expanded data use OPFS for temporary staging; importing them requires OPFS and Web Locks support.
- GitHub Actions and automatic deployment workflows are disabled during development. Validation uses local `npm test` and `npm run build`; only the final GitHub Pages publication may run GitHub's internal Pages workflow.
- Browser storage can be lost through data clearing, private-browsing expiration, or storage limits.
- Review the source code and release notes before relying on an unfinished feature in a public deployment.

## License

Original code in this repository is available under the [MIT License](LICENSE). Copyright (c) 2026 Takayuki Minagawa.

The browser distribution includes third-party software under its respective licenses. See the [third-party software notices](app/public/third-party-licenses.txt) for copyright notices and license texts.

After adding a production dependency, regenerate the notices with `npm run licenses:generate`. `npm run build` intentionally fails until distribution terms can be verified when a package does not include its license text or when the generated notices no longer match the dependency tree.
