import { useEffect, useRef, useState } from 'react';
import { localizeError } from '../errorText';
import { useI18n } from '../i18n';
import type { Project } from '../types';
import { Badge, Section } from '../ui/common';
import { downloadBlob } from '../ui/misc';
import { geometryBlob, listGeometryAssets, type GeometryAsset } from './repository';
import { createGeometryReport, diagnosticScale, type GeometryReport } from './report';
import { inspectGeometryBlob } from './workerClient';

export function GeometryDiagnosticsPanel(props: { project: Project; refreshKey: number }) {
  const { tr } = useI18n();
  const [entries, setEntries] = useState<GeometryAsset[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ ja: string; en: string } | null>(null);
  const [result, setResult] = useState<{ key: string; report: GeometryReport } | null>(null);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const selected = entries.find((entry) => entry.asset.id === selectedId);
  const scale = selected ? diagnosticScale(props.project, selected) : undefined;
  const contextKey = JSON.stringify([
    props.project.id, props.project.unit, props.refreshKey, selectedId,
    scale?.factor, scale?.status, props.project.scaleCalibration?.updatedAt,
  ]);
  const report = result?.key === contextKey ? result.report : undefined;
  const busy = runningKey === contextKey;

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
    controllerRef.current?.abort();
    controllerRef.current = null;
    setRunningKey(null);
    setResult(null);
    setError(null);
    return () => { controllerRef.current?.abort(); };
  }, [contextKey]);

  async function inspect() {
    if (!selected || !scale || loading) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunningKey(contextKey);
    setError(null);
    setResult(null);
    try {
      const blob = await geometryBlob(selected);
      if (controller.signal.aborted) return;
      const diagnostics = await inspectGeometryBlob(blob, selected.asset.kind, scale.factor, controller.signal);
      if (!controller.signal.aborted) {
        setResult({ key: contextKey, report: createGeometryReport(props.project, selected, diagnostics) });
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(localizeError(cause));
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setRunningKey(null);
      }
    }
  }

  function cancel() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setRunningKey(null);
  }

  function originLabel(entry: GeometryAsset) {
    if (entry.stage?.demo || entry.stage?.origin === 'demo') return tr('デモ', 'Demo');
    if (entry.stage?.origin === 'external') return tr('外部取込', 'External import');
    return tr('保存データ', 'Stored data');
  }

  const number = (value: number) => Number(value.toPrecision(7)).toLocaleString(undefined, { maximumSignificantDigits: 7 });
  const diagnostics = report?.diagnostics;
  const topology = diagnostics?.topology;
  const issueCount = (diagnostics?.degenerateTriangles ?? 0) + (topology?.boundaryEdges ?? 0) +
    (topology?.nonManifoldEdges ?? 0) + (topology?.inconsistentWindingEdges ?? 0) + (topology?.duplicateTriangles ?? 0);

  return (
    <Section title={tr('形状診断', 'Geometry diagnostics')}>
      <p className="hint">{tr(
        '保存履歴から対象を選び、寸法と三角面を検査します。診断で形状を変更することはありません。',
        'Choose a stored history entry to inspect its dimensions and triangles. Inspection never changes the geometry.',
      )}</p>
      <div className="row wrap diagnostics-controls">
        <label>
          {tr('診断対象（保存履歴）', 'Geometry to inspect (history)')}
          <select value={selectedId} disabled={loading || entries.length === 0} onChange={(event) => setSelectedId(event.target.value)}>
            {entries.length === 0 && <option value="">{loading ? tr('読み込み中…', 'Loading…') : tr('形状データなし', 'No geometry')}</option>}
            {[...entries].reverse().map((entry) => (
              <option key={entry.asset.id} value={entry.asset.id}>
                {originLabel(entry)} · {entry.asset.kind === 'mesh' ? tr('サーフェス', 'Surface') : tr('点群', 'Point cloud')}
                {` #${entry.stage?.seq ?? '-'} · ${entry.asset.name}`}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={!selected || loading || busy} onClick={() => void inspect()}>
          {busy ? tr('診断中…', 'Inspecting…') : tr('形状を診断', 'Inspect geometry')}
        </button>
        {busy && <button onClick={cancel}>{tr('中止', 'Cancel')}</button>}
      </div>
      {selected && scale && <p className="hint">{tr(
        `対象: ${selected.asset.name} / ${originLabel(selected)} / 単位: ${props.project.unit} / 倍率: ×${number(scale.factor)}`,
        `Target: ${selected.asset.name} / ${originLabel(selected)} / unit: ${props.project.unit} / scale: ×${number(scale.factor)}`,
      )}</p>}
      {selected && scale?.status !== 'calibrated' && <p className="hint">{scale?.status === 'different-source' ? tr(
        '保存済み校正は別の形状が対象です。この診断には適用せず、保存座標を使用します。',
        'The saved calibration belongs to another geometry. This inspection uses the stored coordinates.',
      ) : tr(
        '未校正です。保存座標の寸法を表示するため、入力単位と実測寸法を確認してください。',
        'Uncalibrated: dimensions use stored coordinates. Check the input unit and measured dimensions.',
      )}</p>}
      {error && <p role="alert" className="warn-box">{tr(error.ja, error.en)}</p>}
      <div aria-live="polite" aria-busy={busy}>
        {diagnostics && report && <>
          <div className="row wrap">
            <h3>{tr('診断結果', 'Inspection results')}</h3>
            {issueCount > 0 && <Badge tone="warn">{tr('確認が必要な項目あり', 'Items need review')}</Badge>}
            <button onClick={() => downloadBlob(
              new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
              `${props.project.name}_geometry-diagnostics.json`,
            )}>{tr('診断JSONを保存', 'Save diagnostics JSON')}</button>
          </div>
          <dl className="diagnostics-grid">
            <div><dt>{tr('頂点数', 'Vertices')}</dt><dd>{diagnostics.vertexCount.toLocaleString()}</dd></div>
            <div><dt>{tr('三角形数', 'Triangles')}</dt><dd>{diagnostics.triangleCount.toLocaleString()}</dd></div>
            <div><dt>{tr('X / Y / Z 寸法', 'X / Y / Z size')}</dt><dd>{diagnostics.bounds.size.map(number).join(' / ')} {props.project.unit}</dd></div>
            <div><dt>{tr('最小 X / Y / Z', 'Minimum X / Y / Z')}</dt><dd>{diagnostics.bounds.min.map(number).join(' / ')} {props.project.unit}</dd></div>
            <div><dt>{tr('最大 X / Y / Z', 'Maximum X / Y / Z')}</dt><dd>{diagnostics.bounds.max.map(number).join(' / ')} {props.project.unit}</dd></div>
            {diagnostics.surfaceArea !== null && <>
              <div><dt>{tr('三角形面積の合計', 'Sum of triangle areas')}</dt><dd>{number(diagnostics.surfaceArea)} {props.project.unit}²</dd></div>
              <div><dt>{tr('退化面（面積0）', 'Degenerate faces (zero area)')}</dt><dd>{diagnostics.degenerateTriangles?.toLocaleString()}</dd></div>
            </>}
            {topology && <>
              <div><dt>{tr('完全一致を統合した頂点数', 'Vertices after exact-coordinate welding')}</dt><dd>{topology.uniqueVertexCount.toLocaleString()}</dd></div>
              <div><dt>{tr('境界辺（1面が共有）', 'Boundary edges (one incident face)')}</dt><dd>{topology.boundaryEdges.toLocaleString()}</dd></div>
              <div><dt>{tr('非多様体辺（3面以上）', 'Non-manifold edges (3+ faces)')}</dt><dd>{topology.nonManifoldEdges.toLocaleString()}</dd></div>
              <div><dt>{tr('共有辺の向き不整合', 'Inconsistent edge winding')}</dt><dd>{topology.inconsistentWindingEdges.toLocaleString()}</dd></div>
              <div><dt>{tr('重複面', 'Duplicate faces')}</dt><dd>{topology.duplicateTriangles.toLocaleString()}</dd></div>
            </>}
          </dl>
          {diagnostics.topologySkipReason === 'limit' && <p className="warn-box">{tr(
            '辺・重複面の検査は未実施です。頂点または三角形が20万を超えるため、寸法・面積・退化面のみ検査しました。',
            'Edge and duplicate-face checks were skipped: the geometry exceeds 200,000 vertices or triangles. Only dimensions, area and degenerate faces were checked.',
          )}</p>}
          {diagnostics.topologySkipReason === 'pointcloud' && <p className="hint">{tr(
            '点群には面がないため、面積と辺の検査は対象外です。',
            'Point clouds have no faces, so area and edge checks do not apply.',
          )}</p>}
        </>}
      </div>
      <details className="diagnostics-methods">
        <summary>{tr('検査条件と未検査の項目', 'Inspection methods and unchecked items')}</summary>
        <p className="hint">{tr(
          '寸法は座標軸に沿った外接箱です。辺は完全に同じ座標の頂点を診断時だけ統合し、面積0の面を除いて集計します。重複面は向きを無視して数え、面積合計には重複や重なりも含みます。近接点の統合や細長い三角形の品質判定は行いません。',
          'Dimensions use an axis-aligned bounding box. Edge counts weld only exactly equal coordinates for inspection and exclude zero-area faces. Duplicate faces ignore winding; area includes duplicates and overlaps. Nearby vertices are not merged, and thin triangle quality is not assessed.',
        )}</p>
      </details>
      <p className="hint">{tr(
        '自己交差・頂点多様体性・外向き法線・実形状の精度は未検査です。検出が0件でも水密性やFEM適合性を保証しません。',
        'Self-intersections, vertex manifoldness, outward orientation and physical accuracy are unchecked. Zero findings do not certify watertightness or FEM suitability.',
      )}</p>
    </Section>
  );
}
