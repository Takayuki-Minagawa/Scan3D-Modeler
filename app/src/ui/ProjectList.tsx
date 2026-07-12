import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createProject, deleteProject, listProjects } from '../db/projects';
import { localizeError } from '../errorText';
import { stopProjectJobs } from '../jobs/runner';
import { importProjectZip } from '../export/zip';
import type { CaptureMethod, Project, ScaleMethod, Unit } from '../types';
import { useI18n } from '../i18n';
import { Section } from './common';
import { fmtDateTime } from './misc';
import { AppControls } from './AppControls';

type LocalizedMessage = { ja: string; en: string };

/** トップ画面: プロジェクト一覧+新規作成(使用書§7)+ZIPインポート */
export function ProjectList(props: { onOpen: (id: string) => void }) {
  const { language, tr } = useI18n();
  const [projects, setProjects] = useState<Project[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [status, setStatus] = useState<LocalizedMessage | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [objectName, setObjectName] = useState('');
  const [unit, setUnit] = useState<Unit>('mm');
  const [w, setW] = useState('100');
  const [h, setH] = useState('100');
  const [d, setD] = useState('100');
  const [captureMethod, setCaptureMethod] = useState<CaptureMethod>('video');
  const [scaleMethod, setScaleMethod] = useState<ScaleMethod>('twoPoint');

  const captureMethodLabels: Record<CaptureMethod, string> = {
    video: tr('動画', 'Video'),
    photos: tr('静止画', 'Photos'),
    mixed: tr('動画+静止画', 'Video + photos'),
  };
  const scaleMethodLabels: Record<ScaleMethod, string> = {
    marker: tr('寸法既知マーカー', 'Known-size marker'),
    knownDimension: tr('対象物上の既知寸法', 'Known dimension on object'),
    twoPoint: tr('2点間の実測寸法を後で入力', 'Enter a measured two-point distance later'),
    later: tr('後で設定', 'Set later'),
  };

  async function reload() {
    setProjects(await listProjects());
  }
  useEffect(() => {
    void reload();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !objectName.trim()) return;
    const p = await createProject({
      name: name.trim(),
      objectName: objectName.trim(),
      unit,
      approxSize: { w: Number(w) || 0, h: Number(h) || 0, d: Number(d) || 0 },
      captureMethod,
      scaleMethod,
    });
    props.onOpen(p.id);
  }

  async function handleImport(file: File | null) {
    if (!file) return;
    setStatus({ ja: 'インポート中…', en: 'Importing…' });
    try {
      const p = await importProjectZip(file);
      setStatus({ ja: `インポートしました: ${p.name}`, en: `Imported: ${p.name}` });
      await reload();
    } catch (e) {
      const reason = localizeError(e);
      setStatus({
        ja: `インポート失敗: ${reason.ja}`,
        en: `Import failed: ${reason.en}`,
      });
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  }

  async function remove(p: Project) {
    if (
      !window.confirm(
        tr(
          `プロジェクト「${p.name}」を完全に削除しますか?(元に戻せません)`,
          `Permanently delete project “${p.name}”? This cannot be undone.`,
        ),
      )
    ) {
      return;
    }
    setStatus({
      ja: '削除中…(実行中のジョブを停止しています)',
      en: 'Deleting… (stopping active jobs)',
    });
    // 実行中ジョブを全タブで停止させてから削除する(孤児データ防止)
    await stopProjectJobs(p.id);
    await deleteProject(p.id);
    setStatus(null);
    await reload();
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="container">
      <header className="app-head app-head-with-controls">
        <div>
          <h1>Scan2FEM</h1>
          <p className="hint">
            {tr(
              '小型対象物の撮影画像から3D形状を再構成し、FEM用メッシュデータを作成する静的Webアプリ(すべての処理は端末内で完結し、サーバへ送信されません)',
              'A static web app for organizing captures and exploring a workflow toward FEM-ready data. Processing stays in this browser; no project data is uploaded by this app.',
            )}
          </p>
        </div>
        <AppControls />
      </header>

      <Section
        title={tr('プロジェクト', 'Projects')}
        aside={
          <div className="row">
            <input
              ref={importRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => void handleImport(e.target.files?.[0] ?? null)}
            />
            <button onClick={() => importRef.current?.click()}>{tr('ZIPインポート', 'Import ZIP')}</button>
            <button className="primary" onClick={() => setShowForm((v) => !v)}>
              {tr('新規プロジェクト', 'New project')}
            </button>
          </div>
        }
      >
        {status && <p className="hint">{tr(status.ja, status.en)}</p>}
        {showForm && (
          <form className="form" onSubmit={(e) => void submit(e)}>
            <label>
              {tr('プロジェクト名 *', 'Project name *')}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={tr(`例: L型ブラケット_${today}_TEST01`, `Example: L-bracket_${today}_TEST01`)}
                required
              />
            </label>
            <label>
              {tr('対象物名称 *', 'Object name *')}
              <input
                value={objectName}
                onChange={(e) => setObjectName(e.target.value)}
                placeholder={tr('例: L型ブラケット', 'Example: L-bracket')}
                required
              />
            </label>
            <div className="form-row">
              <label>
                {tr('単位', 'Unit')}
                <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
                  <option value="mm">mm</option>
                  <option value="cm">cm</option>
                  <option value="m">m</option>
                </select>
              </label>
              <label>
                {tr('幅', 'Width')}
                <input type="number" value={w} onChange={(e) => setW(e.target.value)} min="0" />
              </label>
              <label>
                {tr('高さ', 'Height')}
                <input type="number" value={h} onChange={(e) => setH(e.target.value)} min="0" />
              </label>
              <label>
                {tr('奥行き', 'Depth')}
                <input type="number" value={d} onChange={(e) => setD(e.target.value)} min="0" />
              </label>
            </div>
            <div className="form-row">
              <label>
                {tr('撮影方法', 'Capture method')}
                <select
                  value={captureMethod}
                  onChange={(e) => setCaptureMethod(e.target.value as CaptureMethod)}
                >
                  {Object.entries(captureMethodLabels).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {tr('スケール設定', 'Scale setting')}
                <select
                  value={scaleMethod}
                  onChange={(e) => setScaleMethod(e.target.value as ScaleMethod)}
                >
                  {Object.entries(scaleMethodLabels).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row">
              <button type="submit" className="primary">
                {tr('プロジェクトを作成', 'Create project')}
              </button>
              <button type="button" onClick={() => setShowForm(false)}>
                {tr('キャンセル', 'Cancel')}
              </button>
            </div>
          </form>
        )}

        {projects.length === 0 && !showForm ? (
          <p className="hint">
            {tr(
              'プロジェクトがまだありません。「新規プロジェクト」から作成してください。',
              'No projects yet. Create one with New project.',
            )}
          </p>
        ) : (
          <ul className="project-list">
            {projects.map((p) => (
              <li key={p.id} className="project-item">
                <button
                  type="button"
                  className="project-open"
                  onClick={() => props.onOpen(p.id)}
                  aria-label={tr(`プロジェクト「${p.name}」を開く`, `Open project “${p.name}”`)}
                >
                  <strong>{p.name}</strong>
                  <span className="hint">
                    {p.objectName} ・ {tr('約', 'Approx. ')}
                    {p.approxSize.w}×{p.approxSize.h}×{p.approxSize.d}
                    {p.unit} ・ {tr('更新 ', 'Updated ')}{fmtDateTime(p.updatedAt, language)}
                  </span>
                </button>
                <button
                  type="button"
                  className="mini danger"
                  onClick={() => void remove(p)}
                >
                  {tr('削除', 'Delete')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <footer className="hint center">
        {tr(
          '本アプリが生成する形状は撮影時に見えた表面形状です。内部構造・板厚などは画像から判定できません。解析結果のみでの安全性判断は行わないでください。',
          'The app can only represent surfaces visible in captures; it cannot infer internal structure or thickness. Do not make safety decisions from these results alone.',
        )}
      </footer>
    </main>
  );
}
