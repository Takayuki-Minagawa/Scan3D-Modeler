import { useEffect, useRef, useState } from 'react';
import { exportGeometryBlob } from '../export/geometryWorkerClient';
import { exportProjectZip, saveProjectZipDirectly } from '../export/zip';
import { localizeError, type LocalizedError } from '../errorText';
import { geometryBlob, listGeometryAssets, type GeometryAsset } from '../geometry/repository';
import { useI18n } from '../i18n';
import type { Project } from '../types';
import { calibrationMatchesSource, scaleSourceForAsset } from '../viewer/scale';
import { Section } from './common';
import { downloadBlob, fmtBytes } from './misc';

export function ExportPanel(props: { project: Project; refreshKey: number }) {
  const { tr } = useI18n();
  const [entries, setEntries] = useState<GeometryAsset[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<'geometry' | 'zip' | null>(null);
  const [status, setStatus] = useState<LocalizedError | null>(null);
  const [error, setError] = useState<LocalizedError | null>(null);
  const active = useRef<{ controller?: AbortController } | null>(null);
  const mounted = useRef(false);
  const selected = entries.find((entry) => entry.asset.id === selectedId);
  const calibration = props.project.scaleCalibration;
  const scaleApplies = !calibration || Boolean(selected && calibrationMatchesSource(
    calibration, scaleSourceForAsset(selected.asset, selected.stage),
  ));
  const contextKey = JSON.stringify([
    props.project.id, props.project.unit, props.refreshKey, selectedId, calibration,
  ]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.controller?.abort();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setEntries([]);
    void listGeometryAssets(props.project.id).then((next) => {
      if (!alive) return;
      setEntries(next);
      setSelectedId((id) => next.some((entry) => entry.asset.id === id) ? id : next.at(-1)?.asset.id ?? '');
    }).catch((cause) => { if (alive) setError(localizeError(cause)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [props.project.id, props.refreshKey]);

  useEffect(() => {
    if (active.current?.controller) {
      active.current.controller.abort();
      active.current = null;
      setOperation(null);
    }
    setStatus(null);
  }, [contextKey]);

  async function exportZip(direct: boolean) {
    if (active.current) return;
    const token = {};
    active.current = token;
    setOperation('zip');
    setError(null);
    setStatus({ ja: 'ZIP作成中…', en: 'Creating ZIP…' });
    try {
      let excludedRunningStages: number;
      let sizeText = '';
      if (direct) {
        ({ excludedRunningStages } = await saveProjectZipDirectly(props.project.id, `${props.project.name}.zip`));
      } else {
        const result = await exportProjectZip(props.project.id);
        excludedRunningStages = result.excludedRunningStages;
        sizeText = ` (${fmtBytes(result.blob.size)})`;
        downloadBlob(result.blob, `${props.project.name}.zip`);
      }
      if (mounted.current) setStatus({
        ja: `ZIP出力完了${sizeText}` + (excludedRunningStages > 0
          ? ` — 実行途中の段階${excludedRunningStages}件は再開情報を持ち出せないため含めていません` : ''),
        en: `ZIP export complete${sizeText}` + (excludedRunningStages > 0
          ? ` — ${excludedRunningStages} in-progress stage(s) were omitted because their resume state cannot be exported` : ''),
      });
    } catch (cause) {
      if (mounted.current) {
        setStatus(null);
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(localizeError(cause));
      }
    } finally {
      if (active.current === token) {
        active.current = null;
        if (mounted.current) setOperation(null);
      }
    }
  }

  async function exportGeometry(mode: 'ply' | 'stl') {
    if (!selected || !scaleApplies || loading || active.current) return;
    const controller = new AbortController();
    const token = { controller };
    active.current = token;
    setOperation('geometry');
    setError(null);
    setStatus({ ja: '形状を出力中…', en: 'Exporting geometry…' });
    try {
      const source = await geometryBlob(selected);
      const blob = await exportGeometryBlob(source, selected.asset.kind, mode, calibration?.factor ?? 1, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      const name = selected.asset.name.replace(/\.[^.]+$/, '').replace(/[/\\<>:"|?*\u0000-\u001f]/g, '_');
      downloadBlob(blob, `${props.project.name}_${name}_${selected.asset.id.slice(0, 8)}.${mode}`);
      setStatus({ ja: `${mode.toUpperCase()}出力完了 (${fmtBytes(blob.size)})`, en: `${mode.toUpperCase()} export complete (${fmtBytes(blob.size)})` });
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) {
        setStatus(null);
        setError(localizeError(cause));
      }
    } finally {
      if (active.current === token) {
        active.current = null;
        if (mounted.current) setOperation(null);
      }
    }
  }

  function cancelGeometry() {
    active.current?.controller?.abort();
    active.current = null;
    setOperation(null);
    setStatus({ ja: '形状の出力を中止しました', en: 'Geometry export canceled' });
  }

  function originLabel(entry: GeometryAsset) {
    if (entry.stage?.demo || entry.stage?.origin === 'demo') return tr('デモ', 'Demo');
    if (entry.stage?.origin === 'external') return tr('外部取込', 'External import');
    return tr('保存データ', 'Stored data');
  }

  return (
    <Section title={tr('データ出力', 'Data export')}>
      <div className="export-grid">
        <div>
          <h3>{tr('プロジェクト一式(ZIP)', 'Complete project (ZIP)')}</h3>
          <p className="hint">{tr(
            '撮影画像と完了済み段階データを含むバックアップ/端末間移動用です。別端末の本アプリへインポートできますが、実行中・一時停止中ジョブの再開状態は引き継がれません。',
            'For backing up or moving captures and completed stage data between devices. In-progress and paused job resume state is not transferred.',
          )}</p>
          <p className="hint">{tr(
            '復元上限: 1ファイル256MiB、展開データとZIP本体は各1GiB、最大9,999アセット、管理情報8MiB。上限を超える場合は出力前にお知らせします。',
            'Restore limits: 256 MiB per file, 1 GiB each for expanded data and the ZIP, 9,999 assets, and 8 MiB of metadata. Exceeding a limit prevents export.',
          )}</p>
          <div className="row wrap">
            <button className="primary" disabled={operation !== null} onClick={() => void exportZip(false)}>
              {tr('プロジェクトZIPを出力', 'Export project ZIP')}
            </button>
            {'showSaveFilePicker' in window && <button disabled={operation !== null} onClick={() => void exportZip(true)}>
              {tr('大容量ZIPを直接保存', 'Save large ZIP directly')}
            </button>}
          </div>
        </div>
        <div className="geometry-export">
          <h3>{tr('形状(PLY / STL)', 'Geometry (PLY / STL)')}</h3>
          <label>
            {tr('出力対象（保存履歴）', 'Geometry to export (history)')}
            <select value={selectedId} disabled={loading || entries.length === 0 || operation !== null}
              onChange={(event) => { setSelectedId(event.target.value); setError(null); }}>
              {entries.length === 0 && <option value="">{loading ? tr('読み込み中…', 'Loading…') : tr('形状データなし', 'No geometry')}</option>}
              {[...entries].reverse().map((entry) => <option key={entry.asset.id} value={entry.asset.id}>
                {originLabel(entry)} · {entry.asset.kind === 'mesh' ? tr('サーフェス', 'Surface') : tr('点群', 'Point cloud')}
                {` #${entry.stage?.seq ?? '-'} · ${entry.asset.name}`}
              </option>)}
            </select>
          </label>
          {selected && <p className="hint">{tr(
            `対象: ${selected.asset.name} / ${originLabel(selected)} / 単位: ${props.project.unit} / ${fmtBytes(selected.asset.size)}`,
            `Target: ${selected.asset.name} / ${originLabel(selected)} / unit: ${props.project.unit} / ${fmtBytes(selected.asset.size)}`,
          )}</p>}
          {selected && !scaleApplies && <p className="warn-box">{tr(
            '保存済みスケールはこの形状の座標系と一致しません。校正と一致する履歴を選ぶか、3Dビューアで再校正してください。',
            'The saved scale does not match this geometry. Choose matching history or recalibrate in the 3D viewer.',
          )}</p>}
          {selected && scaleApplies && <p className="hint">{calibration ? tr(
            `保存済みスケール ×${calibration.factor.toPrecision(6)} を適用します。元の保存座標は変更しません。`,
            `The saved scale ×${calibration.factor.toPrecision(6)} will be applied. Stored coordinates stay unchanged.`,
          ) : tr(
            '未校正の保存座標を出力します。入力単位と実測寸法を確認してください。',
            'Exports uncalibrated stored coordinates. Check the input unit and measured dimensions.',
          )}</p>}
          <div className="row wrap">
            <button disabled={!selected || !scaleApplies || loading || operation !== null} onClick={() => void exportGeometry('ply')}>
              {tr('PLYを出力', 'Export PLY')}
            </button>
            <button disabled={selected?.asset.kind !== 'mesh' || !scaleApplies || loading || operation !== null} onClick={() => void exportGeometry('stl')}>
              {tr('STLを出力', 'Export STL')}
            </button>
            {operation === 'geometry' && <button onClick={cancelGeometry}>{tr('中止', 'Cancel')}</button>}
          </div>
          <p className="hint">{tr(
            'PLYは点群またはサーフェスの頂点と面索引を保持します。STLはサーフェス専用です。どちらも数値座標をプロジェクト単位として出力するため、読込先で同じ単位を指定してください。',
            'PLY preserves points or surface vertices and face indices. STL supports surfaces only. Coordinates use the project unit; select the same unit in the receiving application.',
          )}</p>
        </div>
      </div>
      {error && <p role="alert" className="warn-box">{tr(error.ja, error.en)}</p>}
      <p className="hint" role="status" aria-live="polite" aria-busy={operation !== null}>{status && tr(status.ja, status.en)}</p>
      <p className="hint">{tr(
        'MSH / VTU / INP(面セット付き)は四面体メッシュ生成の実装後に対応します。FEM解析は外部ソルバで実施してください。',
        'MSH / VTU / INP (with face sets) will be available after tetrahedral meshing is implemented. Run FEM analysis in an external solver.',
      )}</p>
    </Section>
  );
}
