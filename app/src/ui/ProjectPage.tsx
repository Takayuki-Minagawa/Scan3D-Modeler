import { Component, lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CapturePanel } from '../capture/CapturePanel';
import { Gallery } from '../capture/Gallery';
import { ImportPanel } from '../capture/ImportPanel';
import { getProject } from '../db/projects';
import { useI18n } from '../i18n';
import { onJobsChanged } from '../jobs/runner';
import { PipelinePanel } from '../pipeline/PipelinePanel';
import { ExternalGeometryPanel } from '../import/ExternalGeometryPanel';
import { StoragePanel } from '../storage/StoragePanel';
import type { Project } from '../types';
import { ExportPanel } from './ExportPanel';
import { AppControls } from './AppControls';
import { GeometryDiagnosticsPanel } from '../geometry/GeometryDiagnosticsPanel';
import { ProjectEditForm } from './ProjectEditForm';
import { PROJECT_TABS, type ProjectTab } from './route';

const ViewerPanel = lazy(() =>
  import('../viewer/ViewerPanel').then((module) => ({ default: module.ViewerPanel })),
);

class ViewerLoadBoundary extends Component<
  { children: ReactNode; message: string; reloadLabel: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error('3D viewer chunk failed to load', error);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="warn-box">
        <p>{this.props.message}</p>
        <button type="button" onClick={() => window.location.reload()}>
          {this.props.reloadLabel}
        </button>
      </div>
    );
  }
}

type Tab = ProjectTab;

export function ProjectPage(props: {
  projectId: string;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  onBack: () => void;
}) {
  const { tr } = useI18n();
  const [project, setProject] = useState<Project | null>(null);
  const [notFound, setNotFound] = useState(false);
  const tab = props.tab;
  const setTab = props.onTabChange;
  const [editing, setEditing] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // 撮影・ジョブ完了などでギャラリー/ビューア/出力を再読込させるためのキー
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'capture', label: tr('取込', 'Import') },
    { id: 'images', label: tr('画像', 'Images') },
    { id: 'pipeline', label: tr('パイプライン', 'Pipeline') },
    { id: 'viewer', label: tr('ビューア', 'Viewer') },
    { id: 'diagnostics', label: tr('形状診断', 'Diagnostics') },
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

  // WAI-ARIA tabs: 矢印キー/Home/Endで選択タブを移動し、Tabキーはパネルへ抜ける
  function onTabKeyDown(event: KeyboardEvent<HTMLElement>) {
    const index = PROJECT_TABS.indexOf(tab);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % PROJECT_TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + PROJECT_TABS.length) % PROJECT_TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = PROJECT_TABS.length - 1;
    else return;
    event.preventDefault();
    setTab(PROJECT_TABS[next]);
    tabRefs.current[next]?.focus();
  }

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
              {project.note && ` ・ ${project.note}`}
            </div>
          </div>
          <button type="button" className="mini" aria-expanded={editing} onClick={() => setEditing((v) => !v)} data-testid="project-edit">
            {editing ? tr('編集を閉じる', 'Close editor') : tr('編集', 'Edit')}
          </button>
        </div>
        <AppControls />
      </header>
      {editing && (
        <section className="card">
          <ProjectEditForm
            project={project}
            onSaved={(updated) => {
              setProject(updated);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </section>
      )}

      <StoragePanel refreshKey={refreshKey} onManageStorage={props.onBack} compact />

      <nav className="tabs" role="tablist" aria-label={tr('プロジェクトの画面', 'Project views')} onKeyDown={onTabKeyDown}>
        {tabs.map((t, index) => (
          <button
            key={t.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            id={`tab-${t.id}`}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`tabpanel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            data-testid={`tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`} data-testid={`tabpanel-${tab}`}>

      {tab === 'capture' && (
        <>
          <CapturePanel projectId={project.id} onCaptured={bump} />
          <ImportPanel projectId={project.id} refreshKey={refreshKey} onImported={bump} />
          <ExternalGeometryPanel project={project} onChanged={bump} />
        </>
      )}
      {tab === 'images' && (
        <Gallery projectId={project.id} refreshKey={refreshKey} onChanged={bump} />
      )}
      {tab === 'pipeline' && <PipelinePanel projectId={project.id} />}
      {tab === 'viewer' && (
        <ViewerLoadBoundary
          message={tr(
            '3Dビューアを読み込めませんでした。アプリ更新後の古いキャッシュが残っている可能性があります。',
            'The 3D viewer could not be loaded. An older cached app version may still be active.',
          )}
          reloadLabel={tr('再読み込み', 'Reload')}
        >
          <Suspense fallback={<p className="hint">{tr('3Dビューアを読み込み中…', 'Loading 3D viewer…')}</p>}>
            <ViewerPanel
              project={project}
              refreshKey={refreshKey}
              onProjectChange={setProject}
            />
          </Suspense>
        </ViewerLoadBoundary>
      )}
      {tab === 'export' && <ExportPanel project={project} refreshKey={refreshKey} />}
      {tab === 'diagnostics' && <GeometryDiagnosticsPanel project={project} refreshKey={refreshKey} />}
      </div>
    </main>
  );
}
