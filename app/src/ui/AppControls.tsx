import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import {
  activatePwaUpdate,
  getRuntimeIsolationStatus,
  onRuntimeIsolationStatusChange,
  reloadForPwaActivation,
  type RuntimeIsolationStatus,
} from '../pwa';
import { ManualDialog } from './ManualDialog';
import { ThemeToggle } from './ThemeToggle';

/** Language, appearance, and help controls shared by the project list and project pages. */
export function AppControls() {
  const { language, toggleLanguage, tr } = useI18n();
  const [manualOpen, setManualOpen] = useState(false);
  const isJapanese = language === 'ja';
  const closeManual = useCallback(() => setManualOpen(false), []);
  const [isolation, setIsolation] = useState<RuntimeIsolationStatus>(() =>
    getRuntimeIsolationStatus(),
  );

  useEffect(
    () =>
      onRuntimeIsolationStatusChange(() => {
        setIsolation(getRuntimeIsolationStatus());
      }),
    [],
  );

  const isolationText: Record<RuntimeIsolationStatus, string> = {
    active: tr('WASM並列: 有効', 'WASM threads: ready'),
    installing: tr('WASM並列: 準備中', 'WASM threads: preparing'),
    unavailable: tr('WASM並列: 非対応', 'WASM threads: unavailable'),
    failed: tr('WASM並列: 準備失敗', 'WASM threads: setup failed'),
    update: tr('アプリ更新あり', 'App update ready'),
    reload: tr('再読込でWASM並列を有効化', 'Reload to enable WASM threads'),
  };

  function confirmReloadForPwa(): boolean {
    return window.confirm(
      tr(
        'アプリを再読み込みします。録画中のデータや入力途中の内容は失われるため、先に保存または一時停止してください。続けますか?',
        'The app will reload. Unsaved recording data and in-progress input will be lost, so save or pause first. Continue?',
      ),
    );
  }

  function handlePwaAction(): void {
    if (!confirmReloadForPwa()) return;
    if (isolation === 'update') activatePwaUpdate();
    else reloadForPwaActivation();
  }

  return (
    <div className="app-controls">
      <span
        className={`runtime-status runtime-status-${isolation}`}
        role="status"
        aria-live="polite"
        title={tr(
          'SharedArrayBufferを使う将来のWASM並列処理に必要な分離実行状態',
          'Cross-origin isolation required by future SharedArrayBuffer-based WASM threads',
        )}
      >
        {isolationText[isolation]}
      </span>
      {(isolation === 'update' || isolation === 'reload' || isolation === 'failed') && (
        <button type="button" className="mini" onClick={handlePwaAction}>
          {isolation === 'update'
            ? tr('更新して再読み込み', 'Update and reload')
            : isolation === 'failed'
              ? tr('再試行', 'Retry')
              : tr('再読み込み', 'Reload')}
        </button>
      )}
      <button
        type="button"
        className="control-button language-toggle"
        onClick={toggleLanguage}
        aria-label={tr('表示言語を英語に切り替え', 'Switch display language to Japanese')}
      >
        {isJapanese ? 'English' : '日本語'}
      </button>
      <ThemeToggle
        labels={{
          groupLabel: tr('表示テーマ', 'Appearance theme'),
          system: tr('端末設定', 'System'),
          light: tr('ライト', 'Light'),
          dark: tr('ダーク', 'Dark'),
        }}
      />
      <button
        type="button"
        className="control-button manual-trigger"
        onClick={() => setManualOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={manualOpen}
      >
        {tr('簡易マニュアル', 'Quick guide')}
      </button>
      <ManualDialog open={manualOpen} onClose={closeManual} />
    </div>
  );
}
