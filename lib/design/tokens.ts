/**
 * Tikèm web design tokens — the ONE place the website's colours and text
 * sizes are defined (owner, 2026-11-18: "make sure it is done like the app").
 *
 * Mirrors mobile/theme/tokens.ts: the same canvas, the same elevation steps,
 * the same text greys, the same status colours, the same 4px corner. The
 * Tailwind config reads this file, so components write `bg-surface`,
 * `text-fg-muted`, `border-line`, `text-danger`, `text-meta` — never a raw
 * hex, a `white/NN` alpha or a stock palette colour like `red-500`.
 * __tests__/design-tokens.test.ts keeps both apps in step and fails on new
 * raw colours.
 *
 * Surfaces and text greys are white at an alpha rather than solid greys, so
 * they read the same on the black canvas (where they equal the app's solid
 * values) and stay legible over a poster or a photo.
 */

const white = (a: number) => `rgb(255 255 255 / ${a})`
const black = (a: number) => `rgb(0 0 0 / ${a})`

const teal = {
  50: '#F0FDFA',
  100: '#CCFBF1',
  200: '#99F6E4',
  300: '#5EEAD4',
  400: '#2DD4BF',
  500: '#14B8A6', // app: colors.teal / accent
  600: '#0D9488',
  700: '#0F766E',
  800: '#115E59',
  900: '#134E4A',
} as const

export const color = {
  // The one accent: teal, used sparingly where it MEANS something (verified,
  // active, live, focus), never as decoration. `accent` is the same scale.
  brand: { ...teal, primary: teal[700], secondary: teal[500] },
  accent: teal,

  // Canvas & elevation: depth is a brightness step, not a border (POSH §1).
  canvas: '#0A0A0A', // app: colors.bg
  surface: {
    low: white(0.03), // quiet wells, sunken rows
    DEFAULT: white(0.055), // ≈ #161616 on the canvas — app: colors.surface
    raised: white(0.08), // ≈ #1F1F1F — app: colors.surfaceRaised
    high: white(0.12), // hover / pressed on a raised surface
    solid: '#161616', // opaque surface (sticky bars, sheets over content)
    'raised-solid': '#1F1F1F',
  },
  line: {
    soft: white(0.06),
    DEFAULT: white(0.1), // ≈ #262626 — app: colors.border
    strong: white(0.2),
    solid: '#262626', // opaque hairline (charts, canvas drawing)
  },

  // Text. `fg` is plain white so `fg/NN` still works for a one-off.
  fg: {
    DEFAULT: '#FFFFFF', // app: textPrimary
    soft: white(0.82),
    muted: white(0.64), // ≈ #A3A3A3 — app: textSecondary
    subtle: white(0.45), // ≈ #6B6B6B — app: textTertiary
    faint: white(0.3),
    'muted-solid': '#A3A3A3', // opaque muted (charts, canvas drawing)
  },

  // The white primary button and what sits on it.
  inverse: { DEFAULT: '#FFFFFF', hover: white(0.9) },
  'on-inverse': '#000000', // app: onWhite

  // Dark veils over posters and photos. `shade` is plain black for the odd
  // custom veil (`bg-shade/20`); prefer a scrim step.
  shade: '#000000',
  scrim: { light: black(0.45), DEFAULT: black(0.65), strong: black(0.8) },

  // The wordmark's own pair (TikemLogo, ticket monogram).
  logo: { cream: '#F8F5EE', deep: '#0C5E57' },

  // Control Room: the admin console's own world, deliberately unlike the
  // public site (blue-ink ground, no teal; amber/red only mean "waiting").
  console: {
    ground: '#12151A',
    panel: '#1A1E25',
    raise: '#20252E',
    text: '#E8EAED',
    mut: '#8B93A1',
    faint: '#545D6B',
    amber: '#E8A33D',
    red: '#FF6B52',
    green: '#4CC38A',
  },

  // Locked status semantics (POSH §2.7): one colour never means two things.
  danger: { soft: '#FCA5A5', DEFAULT: '#F87171', strong: '#EF4444' }, // app: red
  warning: { soft: '#FDE68A', DEFAULT: '#FCD34D', strong: '#F59E0B' }, // app: amber
  success: { soft: '#6EE7B7', DEFAULT: '#34D399', strong: '#10B981' }, // app: emerald
} as const

/**
 * The text-size ladder, same steps as the app's (mobile/theme/tokens.ts
 * `type`), plus the web's own 14/16 (`sm`/`base`: 16 keeps iOS from zooming
 * into inputs). Sizes only — line heights stay where each component set them.
 */
export const fontSize = {
  eyebrow: '11px', // uppercase eyebrows / tags — the floor
  caption: '12px',
  meta: '13px', // secondary meta, labels, links
  body: '15px', // body; card and row titles
  lead: '17px', // emphasised titles
  title: '20px', // sheet / page titles (sans)
  section: '22px', // serif section headers
  headline: '28px',
  display: '32px',
  hero: '44px', // wordmarks and page heroes on wide screens
} as const

/** One corner everywhere: the poster's 4px. Circles only for avatars/dots. */
export const radius = { DEFAULT: '0.25rem', full: '9999px' } as const

export const tokens = { color, fontSize, radius }
export default tokens
