import { useCallback, useState } from 'react';
import { useI18n } from '../i18n';
import { ManualDialog } from './ManualDialog';
import { ThemeToggle } from './ThemeToggle';

/** Language, appearance, and help controls shared by the project list and project pages. */
export function AppControls() {
  const { language, toggleLanguage, tr } = useI18n();
  const [manualOpen, setManualOpen] = useState(false);
  const isJapanese = language === 'ja';
  const closeManual = useCallback(() => setManualOpen(false), []);

  return (
    <div className="app-controls">
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
