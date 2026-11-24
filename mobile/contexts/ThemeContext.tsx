import React, { createContext, useContext, useMemo } from 'react';
import { COLORS, DARK_COLORS } from '../config/brand';
import { highContrastColors as HC } from '../theme/tokens';
import { useHighContrast } from '../lib/a11y';

type ThemeColors = typeof COLORS;

interface ThemeContextType {
  colors: ThemeColors;
  isDark: boolean;
  /** Profile > Accessibility > Higher contrast. */
  highContrast: boolean;
}

/**
 * Higher contrast: the same dark palette with brighter muted text and
 * stronger hairlines (theme/tokens highContrastColors). Surfaces, canvas and
 * accents are untouched.
 */
const HIGH_CONTRAST_COLORS: ThemeColors = {
  ...DARK_COLORS,
  textSecondary: HC.textSecondary,
  textTertiary: HC.textTertiary,
  border: HC.border,
  borderLight: '#38383D',
};

const ThemeContext = createContext<ThemeContextType>({ colors: DARK_COLORS, isDark: true, highContrast: false });

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Tikèm ships a single, premium dark aesthetic (Posh-style) across the whole
  // app for a crisp, consistent, image-forward feel.
  const highContrast = useHighContrast();
  const value = useMemo(
    () => ({ colors: highContrast ? HIGH_CONTRAST_COLORS : DARK_COLORS, isDark: true, highContrast }),
    [highContrast],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
