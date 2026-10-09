import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { brand, dark, light, type Brand, type ThemeColors } from './colors';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedMode = 'light' | 'dark';

const STORAGE_KEY = 'easzygoo:themeMode';

interface ThemeContextValue {
  /** What the user chose. 'system' follows the OS. */
  mode: ThemeMode;
  /** What that actually resolves to right now. */
  resolvedMode: ResolvedMode;
  colors: ThemeColors;
  /** Fixed brand marks — identical in both themes. */
  brand: Brand;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Restore an explicit override on launch. 'system' is the default, so a
  // missing/garbage key just leaves it following the OS.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && isThemeMode(stored)) setModeState(stored);
      })
      .catch((err) => console.error('[theme] could not restore mode:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    // Persist in the background; a storage failure must not block the UI.
    AsyncStorage.setItem(STORAGE_KEY, next).catch((err) =>
      console.error('[theme] could not persist mode:', err),
    );
  }, []);

  const resolvedMode: ResolvedMode =
    mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolvedMode,
      colors: resolvedMode === 'dark' ? dark : light,
      brand,
      setMode,
    }),
    [mode, resolvedMode, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}
