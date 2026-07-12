import { useEffect, useState } from 'react';
import { getAssetBlob, listAssets } from '../db/assets';
import { decodeMeshBinary, plyFromPoints, stlFromMesh } from '../export/formats';
import { exportProjectZip } from '../export/zip';
import { localizeError } from '../errorText';
import { useI18n } from '../i18n';
import type { AssetMeta, Project } from '../types';
import { Section } from './common';
import { downloadBlob, fmtBytes } from './misc';

/** データ出力(1F-3の一部+1A-3)。 */
export function ExportPanel(props: { project: Project; refreshKey: number }) {
  const { tr } = useI18n();
  const [cloud, setCloud] = useState<AssetMeta | null>(null);
  const [mesh, setMesh] = useState<AssetMeta | null>(null);
  const [busy, setBusy] = useState<{ ja: string; en: string } | null>(null);

  useEffect(() => {
    void (async () => {
      setCloud((await listAssets(props.project.id, ['pointcloud'])).at(-1) ?? null);
      setMesh((await listAssets(props.project.id, ['mesh'])).at(-1) ?? null);
    })();
  }, [props.project.id, props.refreshKey]);

  async function exportZip() {
    setBusy({
      ja: 'ZIP作成中…(データ量により時間がかかります)',
      en: 'Creating ZIP… (this can take a while for large data)',
    });
    try {
      const { blob, excludedRunningStages } = await exportProjectZip(props.project.id);
      downloadBlob(blob, `${props.project.name}.zip`);
      setBusy({
        ja:
          `ZIP出力完了(${fmtBytes(blob.size)})` +
          (excludedRunningStages > 0
            ? ` — 実行途中の段階${excludedRunningStages}件は再開情報を持ち出せないため含めていません`
            : ''),
        en:
          `ZIP export complete (${fmtBytes(blob.size)})` +
          (excludedRunningStages > 0
            ? ` — ${excludedRunningStages} in-progress stage(s) were omitted because their resume state cannot be exported`
            : ''),
      });
    } catch (e) {
      const reason = localizeError(e);
      setBusy({
        ja: `ZIP出力失敗: ${reason.ja}`,
        en: `ZIP export failed: ${reason.en}`,
      });
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
    <Section title={tr('データ出力', 'Data export')}>
      <div className="export-grid">
        <div>
          <h3>{tr('プロジェクト一式(ZIP)', 'Complete project (ZIP)')}</h3>
          <p className="hint">
            {tr(
              '撮影画像と完了済み段階データを含むバックアップ/端末間移動用です。別端末の本アプリへインポートできますが、実行中・一時停止中ジョブの再開状態は引き継がれません。',
              'For backing up or moving captures and completed stage data between devices. You can import it into this app elsewhere, but in-progress and paused job resume state is not transferred.',
            )}
          </p>
          <button className="primary" onClick={() => void exportZip()}>
            {tr('プロジェクトZIPを出力', 'Export project ZIP')}
          </button>
        </div>
        <div>
          <h3>{tr('点群(PLY)', 'Point cloud (PLY)')}</h3>
          <p className="hint">
            {cloud
              ? tr(`最新: ${cloud.name}(${fmtBytes(cloud.size)})`, `Latest: ${cloud.name} (${fmtBytes(cloud.size)})`)
              : tr('点群データがまだありません', 'No point-cloud data yet')}
          </p>
          <button disabled={!cloud} onClick={() => void exportPly()}>
            {tr('PLYを出力', 'Export PLY')}
          </button>
        </div>
        <div>
          <h3>{tr('サーフェス(STL)', 'Surface (STL)')}</h3>
          <p className="hint">
            {mesh
              ? tr(`最新: ${mesh.name}(${fmtBytes(mesh.size)})`, `Latest: ${mesh.name} (${fmtBytes(mesh.size)})`)
              : tr('サーフェスデータがまだありません', 'No surface data yet')}
          </p>
          <button disabled={!mesh} onClick={() => void exportStl()}>
            {tr('STLを出力', 'Export STL')}
          </button>
        </div>
      </div>
      {busy && <p className="hint">{tr(busy.ja, busy.en)}</p>}
      <p className="hint">
        {tr(
          'MSH / VTU / INP(面セット付き)は四面体メッシュ生成の実装後に対応します。FEM解析は本ツールでは行わず、外部ソルバで実施してください。',
          'MSH / VTU / INP (with face sets) will be available after tetrahedral meshing is implemented. Run FEM analysis in an external solver, not in this app.',
        )}
      </p>
    </Section>
  );
}
