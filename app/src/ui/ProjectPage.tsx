import { useEffect, useState } from 'react';
import { CapturePanel } from '../capture/CapturePanel';
import { Gallery } from '../capture/Gallery';
import { ImportPanel } from '../capture/ImportPanel';
import { getProject } from '../db/projects';
import { PipelinePanel } from '../pipeline/PipelinePanel';
import type { Project } from '../types';
import { ViewerPanel } from '../viewer/ViewerPanel';
import { ExportPanel } from './ExportPanel';

type Tab = 'capture' | 'images' | 'pipeline' | 'viewer' | 'export';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'capture', label: '取込' },
  { id: 'images', label: '画像' },
  { id: 'pipeline', label: 'パイプライン' },
  { id: 'viewer', label: 'ビューア' },
  { id: 'export', label: '出力' },
];

export function ProjectPage(props: { projectId: string; onBack: () => void }) {
  const [project, setProject] = useState<Project | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>('capture');
  // 撮影・ジョブ完了などでギャラリー/ビューア/出力を再読込させるためのキー
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    void getProject(props.projectId).then((p) => {
      if (p) setProject(p);
      else setNotFound(true);
    });
  }, [props.projectId]);

  if (notFound) {
    return (
      <main className="container">
        <p>プロジェクトが見つかりません。</p>
        <button onClick={props.onBack}>一覧へ戻る</button>
      </main>
    );
  }
  if (!project) return <main className="container">読み込み中…</main>;

  return (
    <main className="container">
      <header className="app-head row">
        <button onClick={props.onBack}>← 一覧</button>
        <div>
          <h1>{project.name}</h1>
          <div className="hint">
            {project.objectName} ・ 約{project.approxSize.w}×{project.approxSize.h}×
            {project.approxSize.d}
            {project.unit}
          </div>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'capture' && (
        <>
          <CapturePanel projectId={project.id} onCaptured={bump} />
          <ImportPanel projectId={project.id} onImported={bump} />
        </>
      )}
      {tab === 'images' && (
        <Gallery projectId={project.id} refreshKey={refreshKey} onChanged={bump} />
      )}
      {tab === 'pipeline' && <PipelinePanel projectId={project.id} onDataChanged={bump} />}
      {tab === 'viewer' && <ViewerPanel projectId={project.id} refreshKey={refreshKey} />}
      {tab === 'export' && <ExportPanel project={project} refreshKey={refreshKey} />}
    </main>
  );
}
