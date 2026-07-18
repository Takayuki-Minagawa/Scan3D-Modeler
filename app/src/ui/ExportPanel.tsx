import { useEffect, useState } from 'react';
import { getAssetBlob, listAssets } from '../db/assets';
import { getStage } from '../db/stages';
import { decodeMeshBinary, plyFromPoints, stlFromMesh } from '../export/formats';
import { exportProjectZip } from '../export/zip';
import { localizeError } from '../errorText';
import { useI18n } from '../i18n';
import type { AssetMeta, Project, Stage } from '../types';
import {
  calibrationMatchesSource,
  scaleSourceForAsset,
  scaledPositions,
} from '../viewer/scale';
import { Section } from './common';
import { downloadBlob, fmtBytes } from './misc';

/** データ出力(1F-3の一部+1A-3)。 */
interface ExportAsset {
  asset: AssetMeta;
  stage?: Stage;
}

export function ExportPanel(props: { project: Project; refreshKey: number }) {
  const { tr } = useI18n();
  const [cloud, setCloud] = useState<ExportAsset | null>(null);
  const [mesh, setMesh] = useState<ExportAsset | null>(null);
  const [busy, setBusy] = useState<{ ja: string; en: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const [cloudAsset, meshAsset] = await Promise.all([
        listAssets(props.project.id, ['pointcloud']).then((assets) => assets.at(-1)),
        listAssets(props.project.id, ['mesh']).then((assets) => assets.at(-1)),
      ]);
      const [cloudStage, meshStage] = await Promise.all([
        cloudAsset?.stageId ? getStage(cloudAsset.stageId) : undefined,
        meshAsset?.stageId ? getStage(meshAsset.stageId) : undefined,
      ]);
      setCloud(cloudAsset ? { asset: cloudAsset, stage: cloudStage } : null);
      setMesh(meshAsset ? { asset: meshAsset, stage: meshStage } : null);
    })();
  }, [props.project.id, props.refreshKey]);

  const calibration = props.project.scaleCalibration;
  const cloudScaleApplies = calibration
    ? calibrationMatchesSource(
        calibration,
        cloud ? scaleSourceForAsset(cloud.asset, cloud.stage) : undefined,
      )
    : true;
  const meshScaleApplies = calibration
    ? calibrationMatchesSource(
        calibration,
        mesh ? scaleSourceForAsset(mesh.asset, mesh.stage) : undefined,
      )
    : true;

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
    if (!cloud || !cloudScaleApplies) return;
    try {
      const blob = await getAssetBlob(cloud.asset.id);
      if (!blob) throw new Error('点群の本体データがありません');
      const points = new Float32Array(await blob.arrayBuffer());
      const scaled = scaledPositions(points, calibration?.factor ?? 1);
      downloadBlob(plyFromPoints(scaled), `${props.project.name}_points.ply`);
      setBusy({ ja: 'PLY出力が完了しました', en: 'PLY export complete' });
    } catch (cause) {
      const reason = localizeError(cause);
      setBusy({ ja: `PLY出力失敗: ${reason.ja}`, en: `PLY export failed: ${reason.en}` });
    }
  }

  async function exportStl() {
    if (!mesh || !meshScaleApplies) return;
    try {
      const blob = await getAssetBlob(mesh.asset.id);
      if (!blob) throw new Error('サーフェスの本体データがありません');
      const m = decodeMeshBinary(await blob.arrayBuffer());
      const scaled = scaledPositions(m.positions, calibration?.factor ?? 1);
      downloadBlob(stlFromMesh(scaled, m.indices), `${props.project.name}_surface.stl`);
      setBusy({ ja: 'STL出力が完了しました', en: 'STL export complete' });
    } catch (cause) {
      const reason = localizeError(cause);
      setBusy({ ja: `STL出力失敗: ${reason.ja}`, en: `STL export failed: ${reason.en}` });
    }
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
              ? tr(`最新: ${cloud.asset.name}(${fmtBytes(cloud.asset.size)})`, `Latest: ${cloud.asset.name} (${fmtBytes(cloud.asset.size)})`)
              : tr('点群データがまだありません', 'No point-cloud data yet')}
          </p>
          {cloud && calibration && !cloudScaleApplies && (
            <p className="warn-box">
              {tr(
                '保存済みスケールはこの点群の座標系と一致しません。3Dビューアで再校正してください。',
                'The saved scale does not match this point cloud. Recalibrate it in the 3D viewer.',
              )}
            </p>
          )}
          <button disabled={!cloud || !cloudScaleApplies} onClick={() => void exportPly()}>
            {tr('PLYを出力', 'Export PLY')}
          </button>
        </div>
        <div>
          <h3>{tr('サーフェス(STL)', 'Surface (STL)')}</h3>
          <p className="hint">
            {mesh
              ? tr(`最新: ${mesh.asset.name}(${fmtBytes(mesh.asset.size)})`, `Latest: ${mesh.asset.name} (${fmtBytes(mesh.asset.size)})`)
              : tr('サーフェスデータがまだありません', 'No surface data yet')}
          </p>
          {mesh && calibration && !meshScaleApplies && (
            <p className="warn-box">
              {tr(
                '保存済みスケールはこのサーフェスの座標系と一致しません。3Dビューアで再校正してください。',
                'The saved scale does not match this surface. Recalibrate it in the 3D viewer.',
              )}
            </p>
          )}
          <button disabled={!mesh || !meshScaleApplies} onClick={() => void exportStl()}>
            {tr('STLを出力', 'Export STL')}
          </button>
        </div>
      </div>
      {busy && <p className="hint">{tr(busy.ja, busy.en)}</p>}
      {calibration && (cloudScaleApplies || meshScaleApplies) && (
        <p className="hint">
          {tr(
            `座標系が一致するPLY/STLには保存済みスケール ×${calibration.factor.toPrecision(6)} を適用します (単位: ${props.project.unit})。ZIP内の元段階データは変更しません。`,
            `PLY/STL data in the matching coordinate frame uses the saved scale ×${calibration.factor.toPrecision(6)} (unit: ${props.project.unit}). Original stage data in the ZIP is unchanged.`,
          )}
        </p>
      )}
      <p className="hint">
        {tr(
          'MSH / VTU / INP(面セット付き)は四面体メッシュ生成の実装後に対応します。FEM解析は本ツールでは行わず、外部ソルバで実施してください。',
          'MSH / VTU / INP (with face sets) will be available after tetrahedral meshing is implemented. Run FEM analysis in an external solver, not in this app.',
        )}
      </p>
    </Section>
  );
}
