/**
 * The country a visitor is browsing. Public pages scope to ONE country: a
 * reader in Port-au-Prince sees Haiti, a reader in Miami sees the US, and
 * either can switch with "Change country". Client-safe (no next/headers), so
 * the menu that writes the choice and the server that reads it share this.
 */

export const SUPPORTED_COUNTRIES = ['HT', 'US', 'CA', 'FR'] as const
export type CountryCode = (typeof SUPPORTED_COUNTRIES)[number]

/** Where an explicit "Change country" choice is remembered (server-readable). */
export const COUNTRY_COOKIE = 'tikem_country'
const ONE_YEAR_S = 60 * 60 * 24 * 365

export function normalizeCountry(raw?: string | null): CountryCode | null {
  const code = String(raw || '').trim().toUpperCase()
  return (SUPPORTED_COUNTRIES as readonly string[]).includes(code) ? (code as CountryCode) : null
}

/**
 * First usable answer wins: an explicit ?country=, the saved choice (cookie,
 * written by the country menu and by accepting the "Events near…" prompt),
 * the signed-in profile's country, the country the request comes from
 * (Vercel's x-vercel-ip-country), then Haiti.
 */
export function resolveCountry(...candidates: (string | null | undefined)[]): CountryCode {
  for (const c of candidates) {
    const hit = normalizeCountry(c)
    if (hit) return hit
  }
  return 'HT'
}

/** Remember a country choice in this browser. Client only. */
export function saveCountryChoice(code: CountryCode) {
  try {
    document.cookie = `${COUNTRY_COOKIE}=${code}; path=/; max-age=${ONE_YEAR_S}; samesite=lax`
  } catch {
    // Cookies blocked: the ?country= in the URL still carries the choice.
  }
}
