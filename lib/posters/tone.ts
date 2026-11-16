/**
 * A deep, on-brand shade of a poster's average colour: same hue, pushed dark
 * enough to sit behind white text or on the near-black canvas. Shared by
 * /api/posters/tone (the matte behind odd-shaped flyers) and the attendee
 * PDF's header band.
 */
export function toneFrom(r: number, g: number, b: number): string {
  // RGB → HSL
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
    h /= 6
  }
  // Deep and quiet: 10–18% lightness, saturation capped so neon art doesn't
  // turn the mount into a coloured slab.
  const L = Math.min(0.18, Math.max(0.1, l * 0.4))
  const S = Math.min(0.55, s * 1.1)
  // HSL → RGB
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S
  const p = 2 * L - q
  const ch = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p
    return Math.round(v * 255).toString(16).padStart(2, '0')
  }
  return `#${ch(h + 1 / 3)}${ch(h)}${ch(h - 1 / 3)}`
}
