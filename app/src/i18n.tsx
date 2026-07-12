import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

/** The product language is intentionally Japanese by default, regardless of the browser locale. */
export type Language = 'ja' | 'en';

export const LANGUAGE_STORAGE_KEY = 'scan2fem:language';

export type Translate = (japanese: string, english: string) => string;

export type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  /** Choose the supplied Japanese or English copy without a runtime translation service. */
  tr: Translate;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function isLanguage(value: string | null): value is Language {
  return value === 'ja' || value === 'en';
}

/** Local storage is optional: private browsing modes may deny access. */
export function getStoredLanguage(): Language {
  if (typeof window === 'undefined') return 'ja';
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(stored) ? stored : 'ja';
  } catch {
    return 'ja';
  }
}

function applyDocumentLanguage(language: Language): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.title =
    language === 'ja'
      ? 'Scan2FEM — 3Dスキャン・FEMモデル準備'
      : 'Scan2FEM — 3D Scan and FEM Model Preparation';
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  description?.setAttribute(
    'content',
    language === 'ja'
      ? 'Scan2FEM: ブラウザ内で画像・動画の整理、デモ形状の確認、メッシュデータの出力を行う実験的な静的Webアプリ。'
      : 'Scan2FEM: An experimental static web app for organizing captures, viewing demo geometry, and exporting mesh-related data in the browser.',
  );
}

/** Call before the first React render so a saved language updates the document immediately. */
export function initializeLanguage(): Language {
  const language = getStoredLanguage();
  applyDocumentLanguage(language);
  return language;
}

function persistLanguage(language: Language): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Keep the selected language for this session if persistence is unavailable.
  }
}

export function I18nProvider({ children }: PropsWithChildren) {
  const [language, setLanguageState] = useState<Language>(getStoredLanguage);

  useEffect(() => {
    applyDocumentLanguage(language);
  }, [language]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LANGUAGE_STORAGE_KEY) return;
      setLanguageState(isLanguage(event.newValue) ? event.newValue : 'ja');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setLanguage = useCallback((nextLanguage: Language) => {
    persistLanguage(nextLanguage);
    setLanguageState(nextLanguage);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === 'ja' ? 'en' : 'ja');
  }, [language, setLanguage]);

  const tr = useCallback<Translate>(
    (japanese, english) => (language === 'ja' ? japanese : english),
    [language],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ language, setLanguage, toggleLanguage, tr }),
    [language, setLanguage, toggleLanguage, tr],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider.');
  return value;
}
