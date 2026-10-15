import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { useDialogFocus } from './dialogFocus';

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  /** 実行内容を表す動詞(「削除する」「抽出を開始」など)。 */
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  /** 確認と同時に選ばせる追加の選択肢(例: 抽出フレームも削除する)。 */
  checkbox?: { label: string; defaultChecked?: boolean };
}

export interface ConfirmResult {
  checked: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  id: number;
  resolve: (result: ConfirmResult | null) => void;
}

function ConfirmDialog(props: { request: PendingConfirm; onDone: (result: ConfirmResult | null) => void }) {
  const { tr } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [checked, setChecked] = useState(Boolean(props.request.checkbox?.defaultChecked));
  const { onDone } = props;
  const cancel = useCallback(() => onDone(null), [onDone]);
  // 破壊的操作で誤ってEnterを押しても実行しないよう、初期フォーカスは「キャンセル」に置く。
  useDialogFocus(true, dialogRef, cancelRef, cancel);

  return (
    <div className="manual-backdrop" role="presentation" onMouseDown={cancel}>
      <div
        ref={dialogRef}
        className="manual-dialog confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="confirm-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="manual-head">
          <h2 id={titleId}>{props.request.title}</h2>
        </div>
        <div className="confirm-body">
          <div>{props.request.message}</div>
          {props.request.checkbox && (
            <label className="check">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => setChecked(event.target.checked)}
              />
              {props.request.checkbox.label}
            </label>
          )}
        </div>
        <div className="manual-footer">
          <button ref={cancelRef} type="button" onClick={cancel} data-testid="confirm-cancel">
            {props.request.cancelLabel ?? tr('キャンセル', 'Cancel')}
          </button>
          <button
            type="button"
            className={props.request.danger ? 'danger' : 'primary'}
            onClick={() => onDone({ checked })}
            data-testid="confirm-accept"
          >
            {props.request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * window.confirm の代替。テーマ・言語・キーボード操作と整合し、自動操作でも
 * ブロッキングダイアログにならない。キャンセル時は null を返す。
 */
export function useConfirm(): [ReactNode, (options: ConfirmOptions) => Promise<ConfirmResult | null>] {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);
  const sequence = useRef(0);
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<ConfirmResult | null>((resolve) => {
        // 同時に2つ開かない。先の要求はキャンセル扱いにする。
        pendingRef.current?.resolve(null);
        const next = { ...options, id: ++sequence.current, resolve };
        pendingRef.current = next;
        setPending(next);
      }),
    [],
  );
  const onDone = useCallback((result: ConfirmResult | null) => {
    pendingRef.current?.resolve(result);
    pendingRef.current = null;
    setPending(null);
  }, []);
  const element = pending ? <ConfirmDialog key={pending.id} request={pending} onDone={onDone} /> : null;
  return [element, confirm];
}
