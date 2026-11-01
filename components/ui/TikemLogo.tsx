import React from 'react'

/** Accent color for the "è" and the mark's dot — ties the wordmark to the icon. */
export const TIKEM_ACCENT = '#2DD4BF'

/**
 * tikèm wordmark — "Option A": the editorial display serif (Instrument Serif,
 * same as the homepage), lowercase and *italic* by default, with a teal accent
 * "è" that unifies the logo with the platform's teal system. Base color is
 * inherited (set via className/style) so it works on light and dark surfaces.
 *
 * Refinements:
 *  - `italic` — defaults to true (the signature editorial slant). Pass
 *               `italic={false}` only in the rare case an upright mark is needed.
 *  - `capitalized` — render "Tikèm" with a capital T for a more conventional,
 *                 name-like feel. Lowercase reads as more premium/editorial.
 */
export function TikemWordmark({
  className = '',
  style,
  italic = true,
  capitalized = false,
}: {
  className?: string
  style?: React.CSSProperties
  italic?: boolean
  capitalized?: boolean
}) {
  return (
    <span
      className={`font-display leading-none tracking-tight ${italic ? 'italic' : ''} ${
        capitalized ? '' : 'lowercase'
      } ${className}`}
      style={style}
    >
      {capitalized ? 'T' : 't'}ik<span style={{ color: TIKEM_ACCENT }}>è</span>m
    </span>
  )
}

/**
 * Square app mark: teal rounded tile with a serif "T" (same Instrument Serif as
 * the wordmark) and an accent dot. Rendered with real page fonts so the T
 * matches the wordmark exactly.
 */
export function TikemMark({
  size = 40,
  className = '',
}: {
  size?: number
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-brand-700 to-[#0C5E57] ${className}`}
      style={{ width: size, height: size, borderRadius: size * 0.24 }}
    >
      <span
        className="font-display italic font-bold leading-none text-[#F8F5EE]"
        style={{ fontSize: size * 0.62 }}
      >
        T
      </span>
      <span
        className="absolute rounded-full"
        style={{
          background: TIKEM_ACCENT,
          width: size * 0.12,
          height: size * 0.12,
          top: size * 0.2,
          right: size * 0.22,
        }}
      />
    </span>
  )
}

/**
 * Mark + wordmark lockup. Used on auth screens and anywhere a full logo is needed.
 */
export function TikemLogo({
  markSize = 40,
  wordmarkClassName = 'text-[30px] text-brand-300',
  className = '',
}: {
  markSize?: number
  wordmarkClassName?: string
  className?: string
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <TikemMark size={markSize} />
      <TikemWordmark className={wordmarkClassName} />
    </span>
  )
}
