import { useEffect, useRef, useState } from 'react';
import { getAssetBlob, listAssets } from '../db/assets';
import { getStage } from '../db/stages';
import { decodeMeshBinary } from '../export/formats';
import type { AssetMeta, Stage } from '../types';
import { Badge, Section } from '../ui/common';
import { ThreeView } from './threeView';

interface Loaded {
  asset: AssetMeta;
  stage?: Stage;
}

/** 3Dビューア(1D)。最新の点群・サーフェスを表示する */
export function ViewerPanel(props: { projectId: string; refreshKey: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ThreeView | null>(null);
  const [cloud, setCloud] = useState<Loaded | null>(null);
  const [mesh, setMesh] = useState<Loaded | null>(null);
  const [showPoints, setShowPoints] = useState(true);
  const [showMesh, setShowMesh] = useState(true);
  const [loading, setLoading] = useState(true);

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
      const view = viewRef.current;
      if (!view) return;

      const clouds = await listAssets(props.projectId, ['pointcloud']);
      const cloudAsset = clouds.at(-1);
      if (cloudAsset) {
        const blob = await getAssetBlob(cloudAsset.id);
        if (blob && alive) {
          view.setPointCloud(new Float32Array(await blob.arrayBuffer()));
          const stage = cloudAsset.stageId ? await getStage(cloudAsset.stageId) : undefined;
          setCloud({ asset: cloudAsset, stage });
        }
      } else {
        view.setPointCloud(null);
        setCloud(null);
      }

      const meshes = await listAssets(props.projectId, ['mesh']);
      const meshAsset = meshes.at(-1);
      if (meshAsset) {
        const blob = await getAssetBlob(meshAsset.id);
        if (blob && alive) {
          const decoded = decodeMeshBinary(await blob.arrayBuffer());
          view.setMesh(decoded.positions, decoded.indices);
          const stage = meshAsset.stageId ? await getStage(meshAsset.stageId) : undefined;
          setMesh({ asset: meshAsset, stage });
        }
      } else {
        view.setMesh(null);
        setMesh(null);
      }

      if (alive) {
        view.fit();
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [props.projectId, props.refreshKey]);

  useEffect(() => viewRef.current?.setVisibility('points', showPoints), [showPoints]);
  useEffect(() => viewRef.current?.setVisibility('mesh', showMesh), [showMesh]);

  const isDemo = cloud?.stage?.demo || mesh?.stage?.demo;

  return (
    <Section
      title="3Dビューア"
      aside={
        <div className="row">
          {isDemo && <Badge tone="demo">デモデータ(合成)</Badge>}
          <label className="check">
            <input
              type="checkbox"
              checked={showPoints}
              onChange={(e) => setShowPoints(e.target.checked)}
            />
            点群
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={showMesh}
              onChange={(e) => setShowMesh(e.target.checked)}
            />
            サーフェス
          </label>
          <button onClick={() => viewRef.current?.fit()}>フィット</button>
        </div>
      }
    >
      <div className="viewer" ref={containerRef}>
        {!loading && !cloud && !mesh && (
          <div className="viewer-empty">
            表示できる3Dデータがまだありません。
            <br />
            「パイプライン」タブでデモ生成を実行するか、再構成(実装予定)を行ってください。
          </div>
        )}
      </div>
      <div className="hint">
        ドラッグ/1本指: 回転 ・ ホイール/2本指ピンチ: ズーム ・ 右ドラッグ/2本指ドラッグ: 移動
        {cloud && ` | 点群: ${String(cloud.asset.meta?.count ?? '-')}点`}
        {mesh && ` | サーフェス: ${String(mesh.asset.meta?.triangles ?? '-')}三角形`}
      </div>
    </Section>
  );
}
