/**
 * The organizer's brand (organization name + logo): where it lives and how a
 * reader resolves it. Pure, no Firebase imports, so both the server and tests
 * can use it. Mirrored for the app in mobile/lib/orgBrand.ts (parity test:
 * __tests__/mobile-org-brand-parity.test.ts).
 *
 * CANONICAL HOME: public_profiles/{uid}.organization_name / .organization_logo
 *
 * Why there: the brand is shown to OTHER people (event "Hosted by", organizer
 * page, follow lists, search), so it has to be cross-user readable, and
 * users/{uid} is owner-read-only (firestore.rules H4). Of the two readable
 * docs, public_profiles is the one BOTH apps can write: the owner may write
 * their own projection from the client (mobile does, in AuthContext
 * updateUserProfile), while organizers/{uid} is closed to client writes
 * because it carries payout-trust fields. Every mobile cross-user reader
 * already read public_profiles; only the web was missing.
 *
 * LEGACY copies, still dual-written so older readers keep working:
 *  - users/{uid}.organization_*        mobile always wrote here
 *  - organizers/{uid}.organization_*   the web organization settings wrote here
 *
 * Resolution: the FIRST source that has the field as a string wins, and an
 * empty string counts — it is an explicit "removed". A missing field falls
 * through to the next source. That matters for organizers/{uid}: the app
 * cannot write it, so after a logo is removed on mobile it still holds the old
 * one, and a "first non-empty" rule would bring it back.
 * scripts/backfill-org-brand.mjs fills the canonical fields for accounts that
 * only have a legacy copy.
 */

export interface OrgBrand {
  organization_name: string
  organization_logo: string
}

export const ORG_BRAND_FIELDS = ['organization_name', 'organization_logo'] as const
export type OrgBrandField = (typeof ORG_BRAND_FIELDS)[number]

type Source = Record<string, unknown> | null | undefined

function resolveField(field: OrgBrandField, sources: Source[]): string {
  for (const src of sources) {
    const v = src?.[field]
    if (typeof v === 'string') return v.trim()
  }
  return ''
}

/**
 * Resolve the brand from its sources in priority order: pass
 * (public_profiles, users, organizers), leaving out any you did not read.
 */
export function resolveOrgBrand(...sources: Source[]): OrgBrand {
  return {
    organization_name: resolveField('organization_name', sources),
    organization_logo: resolveField('organization_logo', sources),
  }
}

/**
 * The brand fields present in a patch, trimmed, for a write. Only strings are
 * kept, so a partial patch (logo only) leaves the name alone.
 */
export function pickOrgBrandPatch(patch: Record<string, unknown> | null | undefined): Partial<OrgBrand> {
  const out: Partial<OrgBrand> = {}
  if (!patch) return out
  for (const field of ORG_BRAND_FIELDS) {
    const v = patch[field]
    if (typeof v === 'string') out[field] = v.trim()
  }
  return out
}
