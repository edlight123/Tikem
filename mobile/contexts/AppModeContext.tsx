import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppMode = 'attendee' | 'organizer' | 'staff';

interface AppModeContextType {
  mode: AppMode;
  /** `landingTab` picks the tab the navigator resets to (default: the mode's first tab). */
  setMode: (mode: AppMode, opts?: { landingTab?: string }) => void;
  /** Read-once: the navigator's mode-change reset consumes the requested landing tab. */
  takeLandingTab: () => string | null;
  isLoading: boolean;
}

const AppModeContext = createContext<AppModeContextType>({
  mode: 'attendee',
  setMode: () => {},
  takeLandingTab: () => null,
  isLoading: true,
});

export const useAppMode = () => useContext(AppModeContext);

const MODE_STORAGE_KEY = '@Tikem:appMode';

export const AppModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<AppMode>('attendee');
  const [isLoading, setIsLoading] = useState(true);

  // Load persisted mode on mount
  useEffect(() => {
    loadMode();
  }, []);

  const loadMode = async () => {
    try {
      const savedMode = await AsyncStorage.getItem(MODE_STORAGE_KEY);
      if (savedMode === 'organizer' || savedMode === 'attendee' || savedMode === 'staff') {
        setModeState(savedMode);
      }
    } catch (error) {
      console.error('Error loading app mode:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const landingTabRef = useRef<string | null>(null);
  const takeLandingTab = useCallback(() => {
    const tab = landingTabRef.current;
    landingTabRef.current = null;
    return tab;
  }, []);

  const setMode = async (newMode: AppMode, opts?: { landingTab?: string }) => {
    try {
      await AsyncStorage.setItem(MODE_STORAGE_KEY, newMode);
      landingTabRef.current = opts?.landingTab ?? null;
      setModeState(newMode);
    } catch (error) {
      console.error('Error saving app mode:', error);
    }
  };

  return (
    <AppModeContext.Provider value={{ mode, setMode, takeLandingTab, isLoading }}>
      {children}
    </AppModeContext.Provider>
  );
};
