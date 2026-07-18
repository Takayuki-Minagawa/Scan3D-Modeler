import { useEffect, useRef, useState } from 'react';
import { getAssetBlob, listAssets } from '../db/assets';
import { updateProjectScaleCalibration } from '../db/projects';
import { getStage } from '../db/stages';
import { localizeError } from '../errorText';
import { decodeMeshBinary } from '../export/formats';
import { useI18n } from '../i18n';
import type { AssetMeta, Project, Stage } from '../types';
import { Badge, Section } from '../ui/common';
import { ThreeView, type MeasurementPoint } from './threeView';
import {
  calibrationMatchesSource,
  makeScaleCalibration,
  modelDistance,
  scaleSourceForAsset,
  scaleSourcesMatch,
  type ScaleCalibrationSource,
} from './scale';

interface Loaded {
  asset: AssetMeta;
  stage?: Stage;
}

const EMPTY_COORDINATES = ['', '', '', '', '', ''] as const;

/** 3Dビューア(1D)。最新の点群・サーフェスを表示する */
export function ViewerPanel(props: {
  project: Project;
  refreshKey: number;
  onProjectChange: (project: Project) => void;
}) {
  const { tr } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ThreeView | null>(null);
  const [cloud, setCloud] = useState<Loaded | null>(null);
  const [mesh, setMesh] = useState<Loaded | null>(null);
  const [showPoints, setShowPoints] = useState(true);
  const [showMesh, setShowMesh] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ ja: string; en: string } | null>(null);
  const [measurementMode, setMeasurementMode] = useState(false);
  const [measurementPoints, setMeasurementPoints] = useState<MeasurementPoint[]>([]);
  const [measurementSource, setMeasurementSource] = useState<ScaleCalibrationSource | null>(null);
  const [coordinateInputs, setCoordinateInputs] = useState<string[]>([...EMPTY_COORDINATES]);
  const [knownDistance, setKnownDistance] = useState('');
  const [scaleStatus, setScaleStatus] = useState<{ ja: string; en: string } | null>(null);
  const visibleSources: ScaleCalibrationSource[] = [];
  if (showPoints && cloud) visibleSources.push(scaleSourceForAsset(cloud.asset, cloud.stage));
  if (showMesh && mesh) visibleSources.push(scaleSourceForAsset(mesh.asset, mesh.stage));
  const framesMatch =
    visibleSources.length > 0 &&
    visibleSources.every((source) => scaleSourcesMatch(source, visibleSources[0]));
  const coordinateSource = framesMatch ? visibleSources[0] : undefined;
  const calibrationApplies =
    visibleSources.length > 0 &&
    visibleSources.every((source) =>
      calibrationMatchesSource(props.project.scaleCalibration, source),
    );
  const factor = calibrationApplies ? (props.project.scaleCalibration?.factor ?? 1) : 1;
  // 再読込(refreshKey更新)でgeometryを作り直した直後に現在の表示ON/OFFを
  // 再適用するための参照(新規作成されたPoints/Meshは既定でvisibleのため)
  const visRef = useRef({ points: true, mesh: true });

  useEffect(() => {
    if (!containerRef.current) return;
    const view = new ThreeView(containerRef.current);
    view.setScale(1);
    view.setMeasurementEnabled(false, syncMeasurementPoints);
    viewRef.current = view;
    return () => {
      view.dispose();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    view?.setScale(factor);
    const calibration = props.project.scaleCalibration;
    if (calibration && calibrationApplies) {
      const savedPoints: MeasurementPoint[] = [calibration.pointA, calibration.pointB];
      syncMeasurementPoints(savedPoints);
      if (coordinateSource) setMeasurementSource(coordinateSource);
      view?.setMeasurementPoints(savedPoints);
    } else if (calibration && coordinateSource) {
      setMeasurementPoints([]);
      setCoordinateInputs([...EMPTY_COORDINATES]);
      view?.clearMeasurement();
    }
  }, [factor, calibrationApplies, props.project.scaleCalibration, coordinateSource?.assetId]);

  useEffect(() => {
    if (
      !measurementSource ||
      measurementPoints.length === 0 ||
      (coordinateSource && scaleSourcesMatch(measurementSource, coordinateSource))
    ) {
      return;
    }
    setMeasurementMode(false);
    setMeasurementSource(null);
    setMeasurementPoints([]);
    setCoordinateInputs([...EMPTY_COORDINATES]);
    setKnownDistance('');
    viewRef.current?.setMeasurementEnabled(false);
    viewRef.current?.clearMeasurement();
    setScaleStatus({
      ja: '表示する再構成系列が変わったため、未保存の選択点をクリアしました',
      en: 'Unsaved points were cleared because the visible reconstruction series changed.',
    });
  }, [
    coordinateSource?.assetId,
    coordinateSource?.stageId,
    measurementPoints.length,
    measurementSource,
  ]);

  useEffect(() => {
    if (measurementPoints.length !== 2) {
      setKnownDistance('');
      return;
    }
    const distance = modelDistance(measurementPoints[0], measurementPoints[1]) * factor;
    setKnownDistance(String(Number(distance.toPrecision(8))));
  }, [factor, measurementPoints]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      const view = viewRef.current;
      if (!view) return;
      try {
        // I/Oとdecodeはすべてlocalへ準備し、最後のalive確認後に一括commitする。
        // cleanup済みeffectがThreeViewへ途中結果を書き、新effectを上書きするのを防ぐ。
        const [clouds, meshes] = await Promise.all([
          listAssets(props.project.id, ['pointcloud']),
          listAssets(props.project.id, ['mesh']),
        ]);
        if (!alive) return;

        const cloudAsset = clouds.at(-1);
        let nextCloud: { loaded: Loaded; points: Float32Array } | null = null;
        if (cloudAsset) {
          const [blob, stage] = await Promise.all([
            getAssetBlob(cloudAsset.id),
            cloudAsset.stageId ? getStage(cloudAsset.stageId) : undefined,
          ]);
          if (!blob) throw new Error(`点群「${cloudAsset.name}」の本体データがありません`);
          const buf = await blob.arrayBuffer();
          nextCloud = {
            loaded: { asset: cloudAsset, stage },
            points: new Float32Array(buf),
          };
        }

        const meshAsset = meshes.at(-1);
        let nextMesh:
          | { loaded: Loaded; positions: Float32Array; indices: Uint32Array }
          | null = null;
        if (meshAsset) {
          const [blob, stage] = await Promise.all([
            getAssetBlob(meshAsset.id),
            meshAsset.stageId ? getStage(meshAsset.stageId) : undefined,
          ]);
          if (!blob) throw new Error(`サーフェス「${meshAsset.name}」の本体データがありません`);
          const decoded = decodeMeshBinary(await blob.arrayBuffer());
          nextMesh = { loaded: { asset: meshAsset, stage }, ...decoded };
        }

        if (!alive) return;
        // geometry作成とvisibility再適用の間にawaitを挟まず、OFF状態で一度も
        // stale geometryを表示しない。Blob欠損時はcatchで旧geometryも消す。
        view.setPointCloud(nextCloud?.points ?? null);
        view.setVisibility('points', visRef.current.points);
        view.setMesh(nextMesh?.positions ?? null, nextMesh?.indices);
        view.setVisibility('mesh', visRef.current.mesh);
        const nextSources: ScaleCalibrationSource[] = [];
        if (visRef.current.points && nextCloud) {
          nextSources.push(scaleSourceForAsset(nextCloud.loaded.asset, nextCloud.loaded.stage));
        }
        if (visRef.current.mesh && nextMesh) {
          nextSources.push(scaleSourceForAsset(nextMesh.loaded.asset, nextMesh.loaded.stage));
        }
        const nextFactor =
          nextSources.length > 0 &&
          nextSources.every((source) =>
            calibrationMatchesSource(props.project.scaleCalibration, source),
          )
            ? (props.project.scaleCalibration?.factor ?? 1)
            : 1;
        view.setScale(nextFactor);
        setCloud(nextCloud?.loaded ?? null);
        setMesh(nextMesh?.loaded ?? null);
        view.fit();
      } catch (e) {
        if (!alive) return;
        view.setPointCloud(null);
        view.setMesh(null);
        setCloud(null);
        setMesh(null);
        setError(localizeError(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [props.project.id, props.project.scaleCalibration, props.refreshKey]);

  useEffect(() => {
    visRef.current.points = showPoints;
    viewRef.current?.setVisibility('points', showPoints);
  }, [showPoints]);
  useEffect(() => {
    visRef.current.mesh = showMesh;
    viewRef.current?.setVisibility('mesh', showMesh);
  }, [showMesh]);

  const isDemo = cloud?.stage?.demo || mesh?.stage?.demo;
  const rawDistance =
    measurementPoints.length === 2
      ? modelDistance(measurementPoints[0], measurementPoints[1])
      : null;

  function toggleMeasurement(): void {
    const next = !measurementMode;
    if (next && !coordinateSource) return;
    setMeasurementMode(next);
    if (next) setMeasurementSource(coordinateSource ?? null);
    setScaleStatus(null);
    viewRef.current?.setMeasurementEnabled(next);
  }

  function clearPoints(): void {
    setMeasurementPoints([]);
    setMeasurementSource(null);
    setCoordinateInputs([...EMPTY_COORDINATES]);
    setKnownDistance('');
    setScaleStatus(null);
    viewRef.current?.clearMeasurement();
  }

  function syncMeasurementPoints(points: MeasurementPoint[]): void {
    const next = points.slice(0, 2);
    setMeasurementPoints(next);
    if (next.length === 2) {
      setCoordinateInputs(next.flatMap((point) => point.map((value) => String(value))));
    } else if (next.length === 0) {
      setCoordinateInputs([...EMPTY_COORDINATES]);
    }
  }

  function applyCoordinatePoints(): void {
    if (!coordinateSource) {
      setScaleStatus({
        ja: '座標を適用する再構成系列を1つだけ表示してください',
        en: 'Show exactly one reconstruction coordinate frame before applying coordinates.',
      });
      return;
    }
    const values = coordinateInputs.map(Number);
    if (
      values.length !== 6 ||
      values.some(
        (value, index) => !coordinateInputs[index].trim() || !Number.isFinite(value),
      )
    ) {
      setScaleStatus({
        ja: 'A・B両点のX/Y/Z座標をすべて有限の数値で入力してください',
        en: 'Enter finite X/Y/Z coordinates for both points A and B.',
      });
      return;
    }
    const points: MeasurementPoint[] = [
      [values[0], values[1], values[2]],
      [values[3], values[4], values[5]],
    ];
    syncMeasurementPoints(points);
    setMeasurementSource(coordinateSource);
    viewRef.current?.setMeasurementPoints(points);
    setScaleStatus(null);
  }

  async function saveScale(): Promise<void> {
    if (
      measurementPoints.length !== 2 ||
      !coordinateSource ||
      !measurementSource ||
      !scaleSourcesMatch(measurementSource, coordinateSource)
    ) {
      setScaleStatus({
        ja: '選択点と現在表示中の形状が一致しません。2点を選び直してください',
        en: 'The selected points do not match the visible geometry. Select the two points again.',
      });
      return;
    }
    try {
      const calibration = makeScaleCalibration(
        [measurementPoints[0], measurementPoints[1]],
        Number(knownDistance),
        props.project.unit,
        measurementSource,
      );
      const updated = await updateProjectScaleCalibration(props.project.id, calibration);
      props.onProjectChange(updated);
      setMeasurementMode(false);
      viewRef.current?.setMeasurementEnabled(false);
      viewRef.current?.setScale(calibration.factor);
      viewRef.current?.fit();
      setScaleStatus({
        ja: `スケールを保存しました (倍率 ${calibration.factor.toPrecision(6)})`,
        en: `Scale saved (factor ${calibration.factor.toPrecision(6)})`,
      });
    } catch (cause) {
      setScaleStatus(localizeError(cause));
    }
  }

  async function resetScale(): Promise<void> {
    try {
      const updated = await updateProjectScaleCalibration(props.project.id, null);
      props.onProjectChange(updated);
      setMeasurementMode(false);
      viewRef.current?.setMeasurementEnabled(false);
      clearPoints();
      viewRef.current?.setScale(1);
      viewRef.current?.fit();
      setScaleStatus({ ja: 'スケール設定を解除しました', en: 'Scale calibration cleared' });
    } catch (cause) {
      setScaleStatus(localizeError(cause));
    }
  }

  return (
    <Section
      title={tr('3Dビューア', '3D viewer')}
      aside={
        <div className="row wrap viewer-controls">
          {isDemo && <Badge tone="demo">{tr('デモデータ(合成)', 'Demo data (synthetic)')}</Badge>}
          <label className="check">
            <input
              type="checkbox"
              checked={showPoints}
              onChange={(e) => setShowPoints(e.target.checked)}
            />
            {tr('点群', 'Point cloud')}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={showMesh}
              onChange={(e) => setShowMesh(e.target.checked)}
            />
            {tr('サーフェス', 'Surface')}
          </label>
          <button onClick={() => viewRef.current?.fit()}>{tr('フィット', 'Fit view')}</button>
          <button
            className={measurementMode ? 'primary' : ''}
            disabled={loading || (!measurementMode && !coordinateSource)}
            onClick={toggleMeasurement}
          >
            {measurementMode ? tr('点選択を終了', 'Finish picking') : tr('2点を計測', 'Measure 2 points')}
          </button>
        </div>
      }
    >
      {error && (
        <p className="warn-box">
          {tr('3Dデータを読み込めません: ', 'Could not load 3D data: ')}
          {tr(error.ja, error.en)}
        </p>
      )}
      <div className="viewer" ref={containerRef}>
        {!loading && !cloud && !mesh && (
          <div className="viewer-empty">
            {tr('表示できる3Dデータがまだありません。', 'No 3D data is available to display yet.')}
            <br />
            {tr(
              '「パイプライン」タブでデモ生成を実行するか、再構成(実装予定)を行ってください。',
              'Run Generate demo in Pipeline, or use reconstruction when it becomes available.',
            )}
          </div>
        )}
      </div>
      {!coordinateSource && visibleSources.length > 1 && (
        <p className="warn-box">
          {tr(
            '表示中の点群とサーフェスは別の再構成系列です。誤った校正を防ぐため、一方を非表示にしてから2点を計測してください。',
            'The visible point cloud and surface belong to different reconstruction series. Hide one before measuring to avoid calibrating the wrong coordinate frame.',
          )}
        </p>
      )}
      {(measurementMode || measurementPoints.length > 0 || props.project.scaleCalibration) && (
        <div className="measurement-panel">
          <div className="row wrap">
            <strong>{tr('2点間スケール', 'Two-point scale')}</strong>
            {props.project.scaleCalibration && calibrationApplies && (
              <Badge tone="ok">
                {tr(
                  `設定済み ×${factor.toPrecision(6)} (${props.project.unit}/モデル単位)`,
                  `Calibrated ×${factor.toPrecision(6)} (${props.project.unit}/model unit)`,
                )}
              </Badge>
            )}
          </div>
          {props.project.scaleCalibration && coordinateSource && !calibrationApplies && (
            <p className="warn-box">
              {tr(
                '保存済みスケールは別の再構成結果に対する設定です。現在の形状には適用していません。2点を選び直して再校正してください。',
                'The saved scale belongs to a different reconstruction. It is not applied to the current geometry; pick two points and recalibrate.',
              )}
            </p>
          )}
          {measurementMode && (
            <p className="hint">
              {tr(
                `形状上をクリック/タップして2点を選択してください (${measurementPoints.length}/2)。ドラッグは従来どおり回転です。`,
                `Click or tap two positions on the geometry (${measurementPoints.length}/2). Dragging still rotates the view.`,
              )}
            </p>
          )}
          <fieldset className="coordinate-entry">
            <legend>{tr('座標を直接入力（キーボード操作）', 'Enter coordinates (keyboard)')}</legend>
            <div className="coordinate-grid">
              {(['A', 'B'] as const).flatMap((pointLabel, pointIndex) =>
                (['X', 'Y', 'Z'] as const).map((axis, axisIndex) => {
                  const inputIndex = pointIndex * 3 + axisIndex;
                  return (
                    <label key={`${pointLabel}-${axis}`}>
                      {pointLabel} {axis}
                      <input
                        type="number"
                        step="any"
                        value={coordinateInputs[inputIndex]}
                        onChange={(event) => {
                          const next = [...coordinateInputs];
                          next[inputIndex] = event.target.value;
                          setCoordinateInputs(next);
                        }}
                      />
                    </label>
                  );
                }),
              )}
            </div>
            <button className="mini" onClick={applyCoordinatePoints}>
              {tr('入力座標を2点に設定', 'Set the two entered points')}
            </button>
          </fieldset>
          {rawDistance !== null && (
            <div className="measurement-form">
              <span className="hint">
                {tr(
                  `モデル距離: ${rawDistance.toPrecision(7)} / 現在の表示距離: ${(rawDistance * factor).toPrecision(7)} ${props.project.unit}`,
                  `Model distance: ${rawDistance.toPrecision(7)} / current displayed distance: ${(rawDistance * factor).toPrecision(7)} ${props.project.unit}`,
                )}
              </span>
              <label>
                {tr(`実測距離 (${props.project.unit})`, `Measured distance (${props.project.unit})`)}
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={knownDistance}
                  onChange={(event) => setKnownDistance(event.target.value)}
                />
              </label>
              <button
                className="primary"
                disabled={!Number.isFinite(Number(knownDistance)) || Number(knownDistance) <= 0}
                onClick={() => void saveScale()}
              >
                {tr('実測距離でスケールを保存', 'Save scale from measured distance')}
              </button>
            </div>
          )}
          <div className="row wrap">
            {measurementPoints.length > 0 && (
              <button className="mini" onClick={clearPoints}>
                {tr('選択点をクリア', 'Clear picked points')}
              </button>
            )}
            {props.project.scaleCalibration && (
              <button className="mini danger" onClick={() => void resetScale()}>
                {tr('スケール設定を解除', 'Clear scale calibration')}
              </button>
            )}
          </div>
          {scaleStatus && <p className="hint">{tr(scaleStatus.ja, scaleStatus.en)}</p>}
          <p className="hint">
            {tr(
              '校正は表示とPLY/STL出力に適用されます。元の段階データは上書きしません。',
              'Calibration is applied to display and PLY/STL export. Original stage data is never overwritten.',
            )}
          </p>
        </div>
      )}
      <div className="hint">
        {tr(
          'ドラッグ/1本指: 回転 ・ ホイール/2本指ピンチ: ズーム ・ 右ドラッグ/2本指ドラッグ: 移動',
          'Drag / one finger: rotate · wheel / two-finger pinch: zoom · right drag / two-finger drag: pan',
        )}
        {cloud && tr(` | 点群: ${String(cloud.asset.meta?.count ?? '-')}点`, ` | Point cloud: ${String(cloud.asset.meta?.count ?? '-')} points`)}
        {mesh && tr(` | サーフェス: ${String(mesh.asset.meta?.triangles ?? '-')}三角形`, ` | Surface: ${String(mesh.asset.meta?.triangles ?? '-')} triangles`)}
      </div>
    </Section>
  );
}
