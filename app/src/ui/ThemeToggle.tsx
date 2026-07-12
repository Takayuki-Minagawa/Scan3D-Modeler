import { useTheme, type ThemePreference } from './theme';

export type ThemeToggleLabels = {
  groupLabel: string;
  system: string;
  light: string;
  dark: string;
};

const japaneseLabels: ThemeToggleLabels = {
  groupLabel: '表示テーマ',
  system: '端末設定',
  light: 'ライト',
  dark: 'ダーク',
};

type ThemeToggleProps = {
  /** Pass translated labels from the i18n layer when the app language changes. */
  labels?: ThemeToggleLabels;
  className?: string;
};

const preferences: ThemePreference[] = ['system', 'light', 'dark'];

export function ThemeToggle({ labels = japaneseLabels, className }: ThemeToggleProps) {
  const { preference, setPreference } = useTheme();
  const text: Record<ThemePreference, string> = {
    system: labels.system,
    light: labels.light,
    dark: labels.dark,
  };

  return (
    <div className={['theme-toggle', className].filter(Boolean).join(' ')} role="group" aria-label={labels.groupLabel}>
      {preferences.map((option) => (
        <button
          key={option}
          type="button"
          className={`theme-toggle-option${preference === option ? ' active' : ''}`}
          aria-pressed={preference === option}
          onClick={() => setPreference(option)}
        >
          {text[option]}
        </button>
      ))}
    </div>
  );
}
