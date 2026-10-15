import { useState, type FormEvent } from 'react';
import { updateProjectDetails } from '../db/projects';
import { localizeError } from '../errorText';
import { useI18n } from '../i18n';
import type { CaptureMethod, Project, ScaleMethod } from '../types';
import { validateProjectInput, type ProjectValidationError } from './projectValidation';

export function projectValidationMessage(error: ProjectValidationError, tr: (ja: string, en: string) => string): string {
  switch (error) {
    case 'nameRequired':
      return tr('プロジェクト名を入力してください。', 'Enter a project name.');
    case 'objectNameRequired':
      return tr('対象物名称を入力してください。', 'Enter an object name.');
    case 'sizeNotNumber':
      return tr('幅・高さ・奥行きは数値で入力してください(空欄・文字は不可)。', 'Width, height and depth must be numbers (blank or text is not allowed).');
    case 'sizeNotPositive':
      return tr('幅・高さ・奥行きは0より大きい値にしてください。', 'Width, height and depth must be greater than 0.');
  }
}

/** 作成後のプロジェクト情報の編集。単位は校正・ZIPの整合性のため変更できない。 */
export function ProjectEditForm(props: { project: Project; onSaved: (project: Project) => void; onCancel: () => void }) {
  const { tr } = useI18n();
  const p = props.project;
  const [name, setName] = useState(p.name);
  const [objectName, setObjectName] = useState(p.objectName);
  const [w, setW] = useState(String(p.approxSize.w));
  const [h, setH] = useState(String(p.approxSize.h));
  const [d, setD] = useState(String(p.approxSize.d));
  const [captureMethod, setCaptureMethod] = useState<CaptureMethod>(p.captureMethod);
  const [scaleMethod, setScaleMethod] = useState<ScaleMethod>(p.scaleMethod);
  const [note, setNote] = useState(p.note ?? '');
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

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

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = validateProjectInput({ name, objectName, w, h, d });
    if (!result.ok) {
      setErrors(result.errors.map((error) => projectValidationMessage(error, tr)));
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      const updated = await updateProjectDetails(p.id, {
        ...result.value,
        captureMethod,
        scaleMethod,
        note: note.trim() || undefined,
      });
      props.onSaved(updated);
    } catch (cause) {
      const reason = localizeError(cause);
      setErrors([tr(reason.ja, reason.en)]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form project-edit-form" onSubmit={(event) => void submit(event)} data-testid="project-edit-form">
      <label>
        {tr('プロジェクト名 *', 'Project name *')}
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label>
        {tr('対象物名称 *', 'Object name *')}
        <input value={objectName} onChange={(event) => setObjectName(event.target.value)} required />
      </label>
      <div className="form-row">
        <label>
          {tr('単位(変更不可)', 'Unit (fixed)')}
          <input value={p.unit} readOnly aria-readonly="true" />
        </label>
        <label>
          {tr('幅', 'Width')}
          <input type="number" value={w} onChange={(event) => setW(event.target.value)} min="0.001" step="any" required />
        </label>
        <label>
          {tr('高さ', 'Height')}
          <input type="number" value={h} onChange={(event) => setH(event.target.value)} min="0.001" step="any" required />
        </label>
        <label>
          {tr('奥行き', 'Depth')}
          <input type="number" value={d} onChange={(event) => setD(event.target.value)} min="0.001" step="any" required />
        </label>
      </div>
      <div className="form-row">
        <label>
          {tr('撮影方法', 'Capture method')}
          <select value={captureMethod} onChange={(event) => setCaptureMethod(event.target.value as CaptureMethod)}>
            {Object.entries(captureMethodLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          {tr('スケール設定', 'Scale setting')}
          <select value={scaleMethod} onChange={(event) => setScaleMethod(event.target.value as ScaleMethod)}>
            {Object.entries(scaleMethodLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        {tr('メモ', 'Notes')}
        <textarea value={note} rows={3} onChange={(event) => setNote(event.target.value)} />
      </label>
      <p className="hint">
        {tr(
          '撮影方法とスケール設定は記録用の参考情報です。現在の処理内容には影響しません。概算寸法は形状診断で校正後の寸法と大きく食い違う場合の警告に使います。',
          'Capture method and scale setting are reference notes and do not change processing. The approximate size is used to warn when inspected dimensions differ greatly.',
        )}
      </p>
      {errors.length > 0 && (
        <ul className="warn-box" role="alert">
          {errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      )}
      <div className="row">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? tr('保存中…', 'Saving…') : tr('保存', 'Save')}
        </button>
        <button type="button" onClick={props.onCancel} disabled={saving}>
          {tr('キャンセル', 'Cancel')}
        </button>
      </div>
    </form>
  );
}
