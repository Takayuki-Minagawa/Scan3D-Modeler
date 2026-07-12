import { useEffect, useState } from 'react';
import { CapturePanel } from '../capture/CapturePanel';
import { Gallery } from '../capture/Gallery';
import { ImportPanel } from '../capture/ImportPanel';
import { getProject } from '../db/projects';
import { useI18n } from '../i18n';
import { onJobsChanged } from '../jobs/runner';
import { PipelinePanel } from '../pipeline/PipelinePanel';
import type { Project } from '../types';
import { ViewerPanel } from '../viewer/ViewerPanel';
import { ExportPanel } from './ExportPanel';
import { AppControls } from './AppControls';

type Tab = 'capture' | 'images' | 'pipeline' | 'viewer' | 'export';

export function ProjectPage(props: { projectId: string; onBack: () => void }) {
  const { tr } = useI18n();
  const [project, setProject] = useState<Project | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>('capture');
  // 撮影・ジョブ完了などでギャラリー/ビューア/出力を再読込させるためのキー
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'capture', label: tr('取込', 'Import') },
    { id: 'images', label: tr('画像', 'Images') },
    { id: 'pipeline', label: tr('パイプライン', 'Pipeline') },
    { id: 'viewer', label: tr('ビューア', 'Viewer') },
    { id: 'export', label: tr('出力', 'Export') },
  ];

  // ジョブ状態変化の購読は、常時マウントされるこの階層で行う。
  // パイプライン画面のマウント中に限定すると、ジョブ実行中に別タブ
  // (ビューア・出力)へ移った場合、完了しても表示が更新されないため。
  // refreshKeyの更新はビューア/ギャラリーのBlob再読込を伴うので、
  // 「このプロジェクトの・データ変化(change)」の通知だけに反応する
  // (全タブ・全プロジェクトの進捗通知ごとに再読込するとjank/OOM要因になる)
  useEffect(
    () =>
      onJobsChanged((ev) => {
        if (ev.kind === 'change' && (ev.projectId === null || ev.projectId === props.projectId)) {
          setRefreshKey((k) => k + 1);
        }
      }),
    [props.projectId],
  );

  useEffect(() => {
    void getProject(props.projectId).then((p) => {
      if (p) setProject(p);
      else setNotFound(true);
    });
  }, [props.projectId]);

  if (notFound) {
    return (
      <main className="container">
        <p>{tr('プロジェクトが見つかりません。', 'Project not found.')}</p>
        <button onClick={props.onBack}>{tr('一覧へ戻る', 'Back to projects')}</button>
      </main>
    );
  }
  if (!project) return <main className="container">{tr('読み込み中…', 'Loading…')}</main>;

  return (
    <main className="container">
      <header className="app-head app-head-with-controls">
        <div className="row wrap">
          <button onClick={props.onBack}>← {tr('一覧', 'Projects')}</button>
          <div>
            <h1>{project.name}</h1>
            <div className="hint">
              {project.objectName} ・ {tr('約', 'Approx. ')}{project.approxSize.w}×{project.approxSize.h}×
              {project.approxSize.d}
              {project.unit}
            </div>
          </div>
        </div>
        <AppControls />
      </header>

      <nav className="tabs">
        {tabs.map((t) => (
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
          <ImportPanel projectId={project.id} refreshKey={refreshKey} onImported={bump} />
        </>
      )}
      {tab === 'images' && (
        <Gallery projectId={project.id} refreshKey={refreshKey} onChanged={bump} />
      )}
      {tab === 'pipeline' && <PipelinePanel projectId={project.id} />}
      {tab === 'viewer' && <ViewerPanel projectId={project.id} refreshKey={refreshKey} />}
      {tab === 'export' && <ExportPanel project={project} refreshKey={refreshKey} />}
    </main>
  );
}
