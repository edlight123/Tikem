/**
 * tikèm design tokens — the single source of truth for the app's visual system.
 *
 * Rules:
 * - The canvas and all cards are DARK. Teal is an *accent only* (CTAs, active
 *   states, price, links, small highlights) — never full-bleed header blocks.
 * - New / refactored components consume these tokens directly. The semantic
 *   palette in `config/brand.ts` (`useTheme().colors`) is derived from these
 *   same values so existing screens stay in sync automatically.
 */

export const colors = {
  // Canvas & elevation — depth is a BRIGHTNESS STEP, not a border (POSH §1).
  // Cards separate from the canvas by getting lighter, not by drawing a 1px box.
  //   bg (#0A0A0A)  →  surface (#161616)  →  surfaceRaised (#1F1F1F)
  bg: '#0A0A0A', // near-black app background — the frame
  surface: '#161616', // elevated card (lowest step)
  surfaceRaised: '#1F1F1F', // higher step: pressed / elevated cards, sheets, stat blocks
  border: '#262626', // reserve for rare hairline dividers, not box outlines

  // Teal accent scale. Historically labelled "THE platform color", but under the
  // POSH direction teal is a SPARING SEMANTIC accent (verified / active-tab /
  // live-status / focus), never a decorative fill. Prefer the `accent*` aliases
  // below at call sites so intent ("this means something") reads clearly.
  // NOTE: `teal` is kept unchanged for backward compatibility — do not remove.
  teal: '#14B8A6',
  tealBright: '#2DD4BF', // hover / pressed / active highlight
  tealMuted: 'rgba(20,184,166,0.14)', // chip fills, subtle backgrounds
  onTeal: '#04211E', // dark text / icon placed ON a solid teal button

  // Semantic accent — an explicit alias of `teal`. Use where teal CARRIES MEANING.
  accent: '#14B8A6',
  accentMuted: 'rgba(20,184,166,0.14)',

  // Locked status semantics (POSH §2.7) — one color never means two things.
  amber: '#FCD34D', // action-needed / pending
  amberMuted: 'rgba(252,211,77,0.16)',
  red: '#F87171', // error / expired / void / declined / sold-out
  redMuted: 'rgba(248,113,113,0.16)',
  emerald: '#34D399', // success / paid
  emeraldMuted: 'rgba(52,211,153,0.16)',
  gold: '#E6C067', // verified (alternative to teal)

  // Inverted / neutral helpers — the white primary pill and white ticket stub.
  white: '#FFFFFF',
  black: '#000000',
  onWhite: '#000000', // text / icon placed ON the solid-white primary pill
  onWhiteMuted: 'rgba(0,0,0,0.6)', // muted sub-label ON the white pill (price, etc.)
  neutralMuted: 'rgba(255,255,255,0.10)', // grey chip fill (used / neutral status)

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#A3A3A3',
  textTertiary: '#6B6B6B',
} as const;

/**
 * Font families — the three voices.
 *  serif → event titles / wordmark (editorial soul)
 *  mono  → TRUE IDENTIFIERS ONLY: ticket IDs, order refs, codes
 *  (UI / body text uses the system default grotesk-like sans, no token needed)
 *
 * `mono` used to cover "dates, prices-as-data, eyebrows" as well, which put
 * JetBrains Mono on nearly every human-readable line in the app — dates,
 * venues, prices. Against posh, the reference for this product, that read
 * technical rather than editorial: posh sets the same lines in a humanist
 * sans. Narrowed deliberately (2026-08-09) to identifiers, where monospace
 * earns its place by making characters unambiguous. Anything a person reads
 * as language, rather than looks up as a code, takes the sans.
 */
export const font = {
  serif: 'InstrumentSerif_400Regular_Italic',
  mono: 'JetBrainsMono_500Medium',
  monoRegular: 'JetBrainsMono_400Regular',
} as const;

// ONE corner radius across the whole mobile app: 4px, the same as the poster.
// This is a brand rule from the owner. Every step below (sm, chip, md, button,
// lg, xl) is 4 so existing imports keep working; do not reintroduce larger
// values. Bottom sheets round their top corners at 4 too.
// `pill: 999` (or `size / 2`) is ONLY for TRUE CIRCLES: avatars, profile
// photos, status dots, radio buttons, toggle thumbs, small count badges,
// pagination dots and the centre "+" tab button. Never use it for a wide
// shape (button, chip, search bar, filter, tab) - those take 4.
export const radius = { none: 0, poster: 4, sm: 4, chip: 4, md: 4, button: 4, lg: 4, xl: 4, pill: 999 } as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const type = {
  display: { fontSize: 28, fontWeight: '700' as const, lineHeight: 34 },
  title: { fontSize: 20, fontWeight: '700' as const, lineHeight: 26 },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 22 },
  label: { fontSize: 13, fontWeight: '600' as const, lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: '500' as const, lineHeight: 16 },
  // lowercase "for you" style section labels
  sectionEyebrow: { fontSize: 13, fontWeight: '600' as const, letterSpacing: 0.3 },
} as const;

/**
 * `#RRGGBB` → `rgba(...)` so gradient stops can be DERIVED from a theme token
 * (e.g. `colors.background`) instead of hardcoding a literal. Non-hex input
 * (an already-rgba token) is passed through untouched.
 *
 * Lives here rather than beside one scrim because the tab bar and the event
 * page's CTA footer both build fades from the canvas colour and must agree.
 */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  const value = parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

export const tokens = { colors, radius, spacing, type, font };
export default tokens;
