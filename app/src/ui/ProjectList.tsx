import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createProject, deleteProject, listProjects } from '../db/projects';
import { stopProjectJobs } from '../jobs/runner';
import { importProjectZip } from '../export/zip';
import type { CaptureMethod, Project, ScaleMethod, Unit } from '../types';
import { CAPTURE_METHOD_LABEL, SCALE_METHOD_LABEL } from '../types';
import { Section } from './common';
import { fmtDateTime } from './misc';

/** トップ画面: プロジェクト一覧+新規作成(使用書§7)+ZIPインポート */
export function ProjectList(props: { onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [status, setStatus] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [objectName, setObjectName] = useState('');
  const [unit, setUnit] = useState<Unit>('mm');
  const [w, setW] = useState('100');
  const [h, setH] = useState('100');
  const [d, setD] = useState('100');
  const [captureMethod, setCaptureMethod] = useState<CaptureMethod>('video');
  const [scaleMethod, setScaleMethod] = useState<ScaleMethod>('twoPoint');

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
    setStatus('インポート中…');
    try {
      const p = await importProjectZip(file);
      setStatus(`インポートしました: ${p.name}`);
      await reload();
    } catch (e) {
      setStatus(`インポート失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  }

  async function remove(p: Project) {
    if (!window.confirm(`プロジェクト「${p.name}」を完全に削除しますか?(元に戻せません)`)) return;
    setStatus('削除中…(実行中のジョブを停止しています)');
    // 実行中ジョブを全タブで停止させてから削除する(孤児データ防止)
    await stopProjectJobs(p.id);
    await deleteProject(p.id);
    setStatus('');
    await reload();
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="container">
      <header className="app-head">
        <h1>Scan2FEM</h1>
        <p className="hint">
          小型対象物の撮影画像から3D形状を再構成し、FEM用メッシュデータを作成する静的Webアプリ
          (すべての処理は端末内で完結し、サーバへ送信されません)
        </p>
      </header>

      <Section
        title="プロジェクト"
        aside={
          <div className="row">
            <input
              ref={importRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => void handleImport(e.target.files?.[0] ?? null)}
            />
            <button onClick={() => importRef.current?.click()}>ZIPインポート</button>
            <button className="primary" onClick={() => setShowForm((v) => !v)}>
              新規プロジェクト
            </button>
          </div>
        }
      >
        {status && <p className="hint">{status}</p>}
        {showForm && (
          <form className="form" onSubmit={(e) => void submit(e)}>
            <label>
              プロジェクト名 *
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`例: L型ブラケット_${today}_TEST01`}
                required
              />
            </label>
            <label>
              対象物名称 *
              <input
                value={objectName}
                onChange={(e) => setObjectName(e.target.value)}
                placeholder="例: L型ブラケット"
                required
              />
            </label>
            <div className="form-row">
              <label>
                単位
                <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
                  <option value="mm">mm</option>
                  <option value="cm">cm</option>
                  <option value="m">m</option>
                </select>
              </label>
              <label>
                幅
                <input type="number" value={w} onChange={(e) => setW(e.target.value)} min="0" />
              </label>
              <label>
                高さ
                <input type="number" value={h} onChange={(e) => setH(e.target.value)} min="0" />
              </label>
              <label>
                奥行き
                <input type="number" value={d} onChange={(e) => setD(e.target.value)} min="0" />
              </label>
            </div>
            <div className="form-row">
              <label>
                撮影方法
                <select
                  value={captureMethod}
                  onChange={(e) => setCaptureMethod(e.target.value as CaptureMethod)}
                >
                  {Object.entries(CAPTURE_METHOD_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                スケール設定
                <select
                  value={scaleMethod}
                  onChange={(e) => setScaleMethod(e.target.value as ScaleMethod)}
                >
                  {Object.entries(SCALE_METHOD_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row">
              <button type="submit" className="primary">
                プロジェクトを作成
              </button>
              <button type="button" onClick={() => setShowForm(false)}>
                キャンセル
              </button>
            </div>
          </form>
        )}

        {projects.length === 0 && !showForm ? (
          <p className="hint">
            プロジェクトがまだありません。「新規プロジェクト」から作成してください。
          </p>
        ) : (
          <ul className="project-list">
            {projects.map((p) => (
              <li key={p.id} className="project-item" onClick={() => props.onOpen(p.id)}>
                <div>
                  <strong>{p.name}</strong>
                  <div className="hint">
                    {p.objectName} ・ 約{p.approxSize.w}×{p.approxSize.h}×{p.approxSize.d}
                    {p.unit} ・ 更新 {fmtDateTime(p.updatedAt)}
                  </div>
                </div>
                <button
                  className="mini danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    void remove(p);
                  }}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <footer className="hint center">
        本アプリが生成する形状は撮影時に見えた表面形状です。内部構造・板厚などは画像から判定できません
        (使用書§1)。解析結果のみでの安全性判断は行わないでください(使用書§35)。
      </footer>
    </main>
  );
}
