import { useEffect, useState } from 'react';
import { getAssetBlob, listAssets } from '../db/assets';
import { decodeMeshBinary, plyFromPoints, stlFromMesh } from '../export/formats';
import { exportProjectZip } from '../export/zip';
import type { AssetMeta, Project } from '../types';
import { Section } from './common';
import { downloadBlob, fmtBytes } from './misc';

/** データ出力(1F-3の一部+1A-3)。 */
export function ExportPanel(props: { project: Project; refreshKey: number }) {
  const [cloud, setCloud] = useState<AssetMeta | null>(null);
  const [mesh, setMesh] = useState<AssetMeta | null>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    void (async () => {
      setCloud((await listAssets(props.project.id, ['pointcloud'])).at(-1) ?? null);
      setMesh((await listAssets(props.project.id, ['mesh'])).at(-1) ?? null);
    })();
  }, [props.project.id, props.refreshKey]);

  async function exportZip() {
    setBusy('ZIP作成中…(データ量により時間がかかります)');
    try {
      const { blob, excludedRunningStages } = await exportProjectZip(props.project.id);
      downloadBlob(blob, `${props.project.name}.zip`);
      setBusy(
        `ZIP出力完了(${fmtBytes(blob.size)})` +
          (excludedRunningStages > 0
            ? ` — 実行途中の段階${excludedRunningStages}件は再開情報を持ち出せないため含めていません`
            : ''),
      );
    } catch (e) {
      setBusy(`ZIP出力失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function exportPly() {
    if (!cloud) return;
    const blob = await getAssetBlob(cloud.id);
    if (!blob) return;
    const points = new Float32Array(await blob.arrayBuffer());
    downloadBlob(plyFromPoints(points), `${props.project.name}_points.ply`);
  }

  async function exportStl() {
    if (!mesh) return;
    const blob = await getAssetBlob(mesh.id);
    if (!blob) return;
    const m = decodeMeshBinary(await blob.arrayBuffer());
    downloadBlob(stlFromMesh(m.positions, m.indices), `${props.project.name}_surface.stl`);
  }

  return (
    <Section title="データ出力">
      <div className="export-grid">
        <div>
          <h3>プロジェクト一式(ZIP)</h3>
          <p className="hint">
            撮影画像・段階データを含むバックアップ/端末間移動用。別端末の本アプリで
            インポートすると処理を引き継げます(例: スマホで撮影 → PCで処理)。
          </p>
          <button className="primary" onClick={() => void exportZip()}>
            プロジェクトZIPを出力
          </button>
        </div>
        <div>
          <h3>点群(PLY)</h3>
          <p className="hint">
            {cloud ? `最新: ${cloud.name}(${fmtBytes(cloud.size)})` : '点群データがまだありません'}
          </p>
          <button disabled={!cloud} onClick={() => void exportPly()}>
            PLYを出力
          </button>
        </div>
        <div>
          <h3>サーフェス(STL)</h3>
          <p className="hint">
            {mesh ? `最新: ${mesh.name}(${fmtBytes(mesh.size)})` : 'サーフェスデータがまだありません'}
          </p>
          <button disabled={!mesh} onClick={() => void exportStl()}>
            STLを出力
          </button>
        </div>
      </div>
      {busy && <p className="hint">{busy}</p>}
      <p className="hint">
        MSH / VTU / INP(面セット付き)は四面体メッシュ生成の実装後に対応します(作業計画
        フェーズ1F・4)。FEM解析は本ツールでは行わず、外部ソルバで実施してください(前提P5)。
      </p>
    </Section>
  );
}
