import { colors as T } from '../theme/tokens';

export const BRAND = {
  name: 'Tikèm',
  logoText: '🎭 Tikèm',
  tagline: 'Discover Amazing Events',
  primaryColor: '#0F766E',
  secondaryColor: '#0D9488',
};

export const COLORS = {
  primary: '#0F766E',
  primaryLight: '#14B8A6',
  primaryDark: '#134E4A',
  // De-rainbowed: one cohesive teal accent family (was orange).
  secondary: '#0D9488',
  secondaryLight: '#14B8A6',
  // Soft teal wash used for chips / selected states / icon tiles.
  primarySoft: '#F0FDFA',
  primarySoftText: '#0F766E',
  // Label / icon colour placed ON a solid `primary` fill (selected chips).
  // Light theme's primary is the dark teal #0F766E, so white is the readable
  // pairing there (5.5:1).
  onPrimary: '#FFFFFF',
  background: '#F9FAFB',
  surface: '#FFFFFF',
  // Subtle off-white surface for nested cards / inputs.
  surfaceMuted: '#F8FAFC',
  // Raised / pressed surface (sheets, elevated cards).
  surfaceRaised: '#FFFFFF',
  white: '#FFFFFF',
  text: '#0F172A',
  textSecondary: '#64748B',
  textTertiary: '#94A3B8',
  border: '#E5E7EB',
  borderLight: '#F1F5F9',
  error: '#DC2626',
  errorLight: '#FEE2E2',
  success: '#0D9488',
  successLight: '#CCFBF1',
  warning: '#D97706',
  warningLight: '#FEF3C7',
  // De-rainbowed: informational accents lean teal, not blue.
  info: '#0F766E',
  infoLight: '#CCFBF1',
  overlay: 'rgba(15, 23, 42, 0.55)',
  gradientStart: '#F0FDFA',
  gradientEnd: '#FFFFFF',
};

// Crisp, near-black canvas with teal as the single platform accent. Values are
// derived from `theme/tokens.ts` so the design system has one source of truth.
export const DARK_COLORS: typeof COLORS = {
  primary: T.teal,
  primaryLight: T.tealBright,
  primaryDark: '#0F766E',
  secondary: T.teal,
  secondaryLight: T.tealBright,
  primarySoft: '#0E2624',
  primarySoftText: T.tealBright,
  // ON a solid teal chip. White would only reach 2.5:1 against #14B8A6 — this
  // near-black teal (tokens.onTeal) reaches 6.8:1, so selected-chip labels stay
  // legible now that selection is a full teal fill rather than a tint.
  onPrimary: T.onTeal,
  background: T.bg,
  surface: T.surface,
  surfaceMuted: '#101012',
  surfaceRaised: T.surfaceRaised,
  white: '#FFFFFF',
  text: T.textPrimary,
  textSecondary: T.textSecondary,
  textTertiary: T.textTertiary,
  border: T.border,
  borderLight: '#1C1C1F',
  error: '#F87171',
  errorLight: '#450A0A',
  success: T.teal,
  successLight: '#0E2624',
  warning: '#FCD34D',
  warningLight: '#451A03',
  info: T.teal,
  infoLight: '#0E2624',
  overlay: 'rgba(0, 0, 0, 0.7)',
  gradientStart: T.bg,
  gradientEnd: '#101012',
};

/* ---------------------------------------------------------------------------
 * Shared design tokens
 * One source of truth for rhythm, rounding, elevation and type so every
 * screen feels part of the same crisp, modern system.
 * ------------------------------------------------------------------------- */

/** 4pt spacing scale. */
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
} as const;

/**
 * Corner radii. ONE brand radius across the mobile app: 4px, the same as the
 * poster (see theme/tokens.ts `radius`). Every step is 4 so imports keep
 * working. `full` (999) is ONLY for true circles (avatars, dots, radios,
 * toggle thumbs, count badges).
 */
export const RADIUS = {
  sm: 4,
  md: 4,
  lg: 4,
  xl: 4,
  '2xl': 4,
  full: 999,
} as const;

/** Brand gradient tuples for headers / hero scrims (expo-linear-gradient). */
export const GRADIENTS = {
  brand: ['#0F766E', '#0B4F49'] as const,
  brandSoft: ['#F0FDFA', '#FFFFFF'] as const,
  scrimBottom: ['transparent', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.82)'] as const,
  scrimTop: ['rgba(0,0,0,0.45)', 'transparent'] as const,
};

/** Soft, layered shadows. Spread into a style object: `...SHADOWS.card`. */
export const SHADOWS = {
  none: {
    shadowColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
  },
  xs: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  card: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  poster: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 8,
  },
  floating: {
    shadowColor: '#0F766E',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 10,
  },
} as const;

/** Type ramp — sizes + line-heights for consistent text. */
export const TYPE = {
  eyebrow: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.8 },
  caption: { fontSize: 12, fontWeight: '500' as const },
  bodySm: { fontSize: 13, fontWeight: '500' as const },
  body: { fontSize: 15, fontWeight: '500' as const },
  title: { fontSize: 18, fontWeight: '700' as const },
  headline: { fontSize: 22, fontWeight: '800' as const, letterSpacing: -0.3 },
  display: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.5 },
} as const;
