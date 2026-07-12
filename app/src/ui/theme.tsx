import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

/** A user's saved choice. `system` follows the operating system setting. */
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = Exclude<ThemePreference, 'system'>;

export const THEME_STORAGE_KEY = 'scan2fem:theme-preference';
const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function mediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(DARK_MEDIA_QUERY);
}

/** Read a persisted setting defensively; privacy modes may reject localStorage. */
export function getStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function getSystemTheme(): ResolvedTheme {
  return mediaQuery()?.matches ? 'dark' : 'light';
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? getSystemTheme() : preference;
}

function themeColor(theme: ResolvedTheme): string {
  return theme === 'dark' ? '#10151c' : '#f6f8fb';
}

/**
 * Reflect the active theme on the root element.  This is deliberately exported
 * so main.tsx can call initializeTheme() before React renders and avoid a
 * system-theme flash when a user has saved an explicit preference.
 */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolvedTheme = resolveTheme(preference);
  if (typeof document === 'undefined') return resolvedTheme;

  const root = document.documentElement;
  root.dataset.theme = resolvedTheme;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolvedTheme;

  // index.html has one media-specific tag per OS theme. Update every tag so an
  // explicit in-app choice also colors browser chrome correctly.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((colorMeta) => {
    colorMeta.setAttribute('content', themeColor(resolvedTheme));
  });
  return resolvedTheme;
}

/** Call before the first React render for a flicker-free initial theme. */
export function initializeTheme(): ThemePreference {
  const preference = getStoredThemePreference();
  applyTheme(preference);
  return preference;
}

function persistThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The setting remains active for this session when storage is unavailable.
  }
}

function subscribeToMediaChange(query: MediaQueryList, listener: () => void): () => void {
  // Safari 14 and older expose the deprecated addListener API.
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }
  const legacyQuery = query as MediaQueryList & {
    addListener?: (callback: () => void) => void;
    removeListener?: (callback: () => void) => void;
  };
  if (legacyQuery.addListener && legacyQuery.removeListener) {
    legacyQuery.addListener(listener);
    return () => legacyQuery.removeListener?.(listener);
  }
  return () => undefined;
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [preference, setPreferenceState] = useState<ThemePreference>(getStoredThemePreference);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(getStoredThemePreference()));

  const syncTheme = useCallback((nextPreference: ThemePreference) => {
    setResolvedTheme(applyTheme(nextPreference));
  }, []);

  // Also covers callers that do not use initializeTheme() before mounting.
  useLayoutEffect(() => {
    syncTheme(preference);
  }, [preference, syncTheme]);

  useEffect(() => {
    if (preference !== 'system') return;
    const query = mediaQuery();
    if (!query) return;
    return subscribeToMediaChange(query, () => syncTheme('system'));
  }, [preference, syncTheme]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      const nextPreference =
        event.key === null ? 'system' : isThemePreference(event.newValue) ? event.newValue : 'system';
      setPreferenceState(nextPreference);
      syncTheme(nextPreference);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [syncTheme]);

  const setPreference = useCallback(
    (nextPreference: ThemePreference) => {
      persistThemePreference(nextPreference);
      setPreferenceState(nextPreference);
      // Apply immediately so the control feels responsive before React commits.
      syncTheme(nextPreference);
    },
    [syncTheme],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used inside ThemeProvider.');
  }
  return value;
}
