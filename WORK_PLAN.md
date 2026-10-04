# 2026-10-04 作業計画

作業ブランチ: `codex/project-recovery-and-export`

## 調査と判断

- mainとorigin/mainの一致、既存28テスト成功、依存監査0件を確認。
- 大規模再設計は不要。形状出力とZIP制限を局所的に共通化する。
- STLで破損したASCIIの一部とbinaryの余剰データを受理する不具合を修正。
- ZIP直接保存が復元上限を超える不具合を修正し、保存前に説明付きで拒否。
- 追加機能は保存履歴の選択出力と、頂点・面索引を保持したサーフェスPLY。
- 実再構成/WASM・四面体メッシュは既存計画の未実施フェーズとして維持。

## 実施順序

1. STL全体検証と回帰テスト。
2. ZIPの読込/出力上限を共通化し、境界テスト。
3. PLYメッシュ出力、出力Worker、履歴選択UI、校正の由来検証。
4. 日英のマニュアル・README・進捗更新、ローカル全テスト/型検査/本番ビルド/ブラウザ確認。
5. PR作成後、独立サブエージェントレビューと指摘修正・再検証。
6. 一時計画を削除してPRへ反映し、マージ・main同期・作業ブランチ削除。

CIは今回はローカルのみ。GitHub Actionsを追加・実行する場合はLinuxのみとする。

## 一次資料

- https://threejs.org/docs/pages/PLYExporter.html
- https://github.com/mrdoob/three.js/blob/master/examples/jsm/exporters/PLYExporter.js
- https://www.loc.gov/preservation/digital/formats/fdd/fdd000505.shtml

## 完了条件

破損STL拒否、正常STL/PLY往復、PLY面索引/スケール/元データ不変、履歴切替と多重出力防止、ZIP出力/復元上限の対称性、既存回帰、ライセンス検査に成功し、レビューの阻害事項がないこと。
