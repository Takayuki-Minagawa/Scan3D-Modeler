import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n';

type ManualDialogProps = {
  open: boolean;
  onClose: () => void;
};

/** A concise, in-app guide that makes the demo/validation boundaries explicit. */
export function ManualDialog({ open, onClose }: ManualDialogProps) {
  const { tr } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="manual-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="manual-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-guide-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="manual-head">
          <div>
            <p className="eyebrow">Scan2FEM</p>
            <h2 id="quick-guide-title">{tr('簡易マニュアル', 'Quick guide')}</h2>
          </div>
          <button ref={closeRef} type="button" className="mini" onClick={onClose}>
            {tr('閉じる', 'Close')}
          </button>
        </div>

        <div className="manual-content">
          <section>
            <h3>{tr('このアプリについて', 'What this app does')}</h3>
            <p>
              {tr(
                'Scan2FEMは、撮影画像・動画を整理し、3D形状からFEM用データを準備する流れをブラウザ内で試す静的Webアプリです。FEM解析そのものは行いません。',
                'Scan2FEM is a static web app for organizing captures and exploring a browser-based workflow toward FEM-ready data. It does not run FEM analysis itself.',
              )}
            </p>
          </section>

          <section>
            <h3>{tr('基本の流れ', 'Basic workflow')}</h3>
            <ol>
              <li>{tr('プロジェクトを作成します。', 'Create a project.')}</li>
              <li>{tr('「取込」から静止画・動画を追加するか、カメラ撮影を使います。', 'Add images or videos from Import, or use camera capture.')}</li>
              <li>
                {tr(
                  '動画はキーフレーム抽出、静止画はブレ判定を行えます。不要な画像は「画像」タブで除外できます。',
                  'Videos can be processed into key frames and still images can be blur-scored. Exclude unwanted images in Images.',
                )}
              </li>
              <li>
                {tr(
                  '「パイプライン」の「デモ生成」で、ビューアと出力の操作を確認します。',
                  'Use Generate demo in Pipeline to try the viewer and export flow.',
                )}
              </li>
              <li>{tr('「出力」からプロジェクトZIPや利用可能な形式を保存します。', 'Save a project ZIP or an available format from Export.')}</li>
            </ol>
          </section>

          <section>
            <h3>{tr('大切な制約', 'Important limitations')}</h3>
            <ul>
              <li>
                {tr(
                  '現在の3D結果は合成データのデモです。実撮影画像からのSfM/MVS/サーフェス再構成は未実装です。',
                  'Current 3D results are synthetic demos. SfM/MVS/surface reconstruction from real captures is not implemented.',
                )}
              </li>
              <li>
                {tr(
                  '四面体メッシュ、MSH/VTU/INP出力、スケール設定は未実装です。',
                  'Tetrahedral meshing, MSH/VTU/INP export, and scale setting are not implemented.',
                )}
              </li>
              <li>
                {tr(
                  '表示された形状だけで設計・製造・安全性の判断を行わないでください。',
                  'Do not use the displayed geometry for design, manufacturing, or safety decisions.',
                )}
              </li>
            </ul>
          </section>

          <section>
            <h3>{tr('データとカメラ', 'Data and camera')}</h3>
            <p>
              {tr(
                'このアプリには画像・動画を受け取るバックエンドはなく、通常はブラウザのIndexedDBに保存されます。カメラはHTTPSまたはlocalhostが必要です。ブラウザのデータ削除やストレージ容量制限に備え、必要なプロジェクトはZIPでバックアップしてください。ZIPには実行中・一時停止中ジョブの再開状態は含まれません。',
                'This app has no backend for receiving images or videos; data is normally stored in browser IndexedDB. Camera access requires HTTPS or localhost. Export a project ZIP to back up data against browser clearing or storage limits. ZIP files do not include resume state for in-progress or paused jobs.',
              )}
            </p>
          </section>
        </div>

        <div className="manual-footer">
          <button type="button" className="primary" onClick={onClose}>
            {tr('理解しました', 'Got it')}
          </button>
        </div>
      </div>
    </div>
  );
}
