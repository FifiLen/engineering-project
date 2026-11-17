import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readSetting, saveSetting } from './storage';

export type ThemeMode = 'system' | 'light' | 'dark';
export const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];

interface Preferences {
  themeMode: ThemeMode;
  showZones: boolean;
  setThemeMode(mode: ThemeMode): void;
  setShowZones(value: boolean): void;
}

const DEFAULTS: Preferences = {
  themeMode: 'system',
  showZones: true,
  setThemeMode: () => undefined,
  setShowZones: () => undefined,
};

const PreferencesContext = createContext<Preferences>(DEFAULTS);

export const usePreferences = (): Preferences => useContext(PreferencesContext);

/**
 * Ustawienia zapisane na urządzeniu (decyzja D6): motyw i warstwa stref na mapie. Preferencje
 * powiadomień są w bazie (`PATCH /me/notifications`), bo dotyczą konta, a nie telefonu.
 */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [showZones, setShowZonesState] = useState(true);

  useEffect(() => {
    void readSetting('theme').then((v) => {
      if (v === 'light' || v === 'dark' || v === 'system') setThemeModeState(v);
    });
    void readSetting('showZones').then((v) => {
      if (v !== null) setShowZonesState(v === '1');
    });
  }, []);

  const value = useMemo<Preferences>(
    () => ({
      themeMode,
      showZones,
      setThemeMode: (mode) => {
        setThemeModeState(mode);
        void saveSetting('theme', mode);
      },
      setShowZones: (v) => {
        setShowZonesState(v);
        void saveSetting('showZones', v ? '1' : '0');
      },
    }),
    [themeMode, showZones],
  );
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
