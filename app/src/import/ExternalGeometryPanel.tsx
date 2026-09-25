import { useState } from 'react';
import { useI18n } from '../i18n';
import type { Project, Unit } from '../types';
import { Section } from '../ui/common';
import { localizeError } from '../errorText';
import { MAX_GEOMETRY_FILE_BYTES, parseExternalGeometryInWorker, saveExternalGeometry } from './externalGeometry';

export function ExternalGeometryPanel(props: { project: Project; onChanged: () => void }) {
  const { tr } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [inputUnit, setInputUnit] = useState<Unit | ''>('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ja: string; en: string } | null>(null);

  async function importFile() {
    if (!file || !inputUnit) return;
    setBusy(true);
    setMessage(null);
    try {
      const parsed = await parseExternalGeometryInWorker(file, inputUnit, props.project.unit);
      const stage = await saveExternalGeometry(props.project, file.name, parsed);
      setMessage({
        ja: `${file.name}を外部取込 #${stage.seq} として保存しました (${inputUnit} → ${props.project.unit})`,
        en: `Saved ${file.name} as external import #${stage.seq} (${inputUnit} → ${props.project.unit})`,
      });
      setFile(null);
      props.onChanged();
    } catch (cause) {
      const reason = localizeError(cause);
      setMessage({ ja: `形状取込失敗: ${reason.ja}`, en: `Geometry import failed: ${reason.en}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={tr('外部3D形状の取込', 'Import external 3D geometry')}>
      <p className="hint">
        {tr(
          `PLY点群・PLY三角面・ASCII/binary STLに対応します。入力単位を選び、プロジェクト単位(${props.project.unit})へ換算して新しい履歴として保存します。元のファイルが検証済みFEMモデルであることは保証しません。暫定上限: ${MAX_GEOMETRY_FILE_BYTES / 1024 / 1024}MiB。`,
          `Supports PLY points, PLY triangles, and ASCII/binary STL. Select the input unit; coordinates are converted to the project unit (${props.project.unit}) and saved as a new history entry. The source is not verified as a FEM model. Provisional file limit: ${MAX_GEOMETRY_FILE_BYTES / 1024 / 1024}MiB.`,
        )}
      </p>
      <div className="row wrap">
        <label>
          {tr('ファイル', 'File')}{' '}
          <input type="file" accept=".ply,.stl" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label>
          {tr('入力ファイルの単位', 'Input file unit')}{' '}
          <select value={inputUnit} onChange={(e) => setInputUnit(e.target.value as Unit | '')}>
            <option value="">{tr('選択してください', 'Select unit')}</option>
            <option value="mm">mm</option>
            <option value="cm">cm</option>
            <option value="m">m</option>
          </select>
        </label>
        <button className="primary" disabled={!file || !inputUnit || busy} onClick={() => void importFile()}>
          {busy ? tr('検査・保存中…', 'Validating and saving…') : tr('形状を取り込む', 'Import geometry')}
        </button>
      </div>
      {message && <p className="hint">{tr(message.ja, message.en)}</p>}
    </Section>
  );
}
