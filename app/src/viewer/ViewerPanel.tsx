import { useEffect, useRef, useState } from 'react';
import { getAssetBlob, listAssets } from '../db/assets';
import { getStage } from '../db/stages';
import { localizeError } from '../errorText';
import { decodeMeshBinary } from '../export/formats';
import { useI18n } from '../i18n';
import type { AssetMeta, Stage } from '../types';
import { Badge, Section } from '../ui/common';
import { ThreeView } from './threeView';

interface Loaded {
  asset: AssetMeta;
  stage?: Stage;
}

/** 3Dビューア(1D)。最新の点群・サーフェスを表示する */
export function ViewerPanel(props: { projectId: string; refreshKey: number }) {
  const { tr } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ThreeView | null>(null);
  const [cloud, setCloud] = useState<Loaded | null>(null);
  const [mesh, setMesh] = useState<Loaded | null>(null);
  const [showPoints, setShowPoints] = useState(true);
  const [showMesh, setShowMesh] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ ja: string; en: string } | null>(null);
  // 再読込(refreshKey更新)でgeometryを作り直した直後に現在の表示ON/OFFを
  // 再適用するための参照(新規作成されたPoints/Meshは既定でvisibleのため)
  const visRef = useRef({ points: true, mesh: true });

  useEffect(() => {
    if (!containerRef.current) return;
    const view = new ThreeView(containerRef.current);
    viewRef.current = view;
    return () => {
      view.dispose();
      viewRef.current = null;
    };
  }, []);

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
          listAssets(props.projectId, ['pointcloud']),
          listAssets(props.projectId, ['mesh']),
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
  }, [props.projectId, props.refreshKey]);

  useEffect(() => {
    visRef.current.points = showPoints;
    viewRef.current?.setVisibility('points', showPoints);
  }, [showPoints]);
  useEffect(() => {
    visRef.current.mesh = showMesh;
    viewRef.current?.setVisibility('mesh', showMesh);
  }, [showMesh]);

  const isDemo = cloud?.stage?.demo || mesh?.stage?.demo;

  return (
    <Section
      title={tr('3Dビューア', '3D viewer')}
      aside={
        <div className="row">
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
