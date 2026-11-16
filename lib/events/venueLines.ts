/**
 * The address lines under a venue's name, without repeats.
 *
 * Organizers often type the commune and city into the address itself
 * ("Kokoye, Pétion-Ville, Haïti"), and the page then printed the commune
 * again on its own line; an event with a city but no commune printed a bare
 * ", Port-au-Prince". Each part prints once, empty parts not at all, and a
 * part the address (or the venue name) already contains is left out.
 */
export function venueAddressLines({
  venueName,
  address,
  commune,
  city,
}: {
  venueName?: string | null
  address?: string | null
  commune?: string | null
  city?: string | null
}): string[] {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  // An address that opens with the venue's own name ("Kokoye, Pétion-Ville"
  // under a venue called Kokoye) loses that segment: the name is printed
  // right above it.
  const venueN = norm(venueName || '')
  const addr = (address || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s, i) => s && !(i === 0 && venueN && norm(s) === venueN))
    .join(', ')
  const seen = norm(`${venueName || ''} ${addr}`)
  const place: string[] = []
  for (const raw of [commune, city]) {
    const part = (raw || '').trim()
    if (!part) continue
    const n = norm(part)
    if (seen.includes(n) || place.some((p) => norm(p) === n)) continue
    place.push(part)
  }
  // An address equal to the venue name says nothing new.
  const lines = addr && norm(addr) !== norm(venueName || '') ? [addr] : []
  if (place.length) lines.push(place.join(', '))
  return lines
}
