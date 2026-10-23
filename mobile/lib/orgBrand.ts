/**
 * The organizer's brand (organization name + logo): where it lives and how a
 * reader resolves it. A mirror of the web's lib/profile/org-brand.ts, which
 * has the full reasoning; __tests__/mobile-org-brand-parity.test.ts keeps the
 * two in step.
 *
 * CANONICAL HOME: public_profiles/{uid}.organization_name / .organization_logo
 * (cross-user readable, and the owner may write it from the app). The
 * users/{uid} copy is still written alongside it; the web also keeps an
 * organizers/{uid} copy, which the app cannot write.
 *
 * Resolution: the first source that has the field as a string wins, and an
 * empty string counts (the logo was removed); a missing field falls through.
 */

export interface OrgBrand {
  organization_name: string;
  organization_logo: string;
}

export const ORG_BRAND_FIELDS = ['organization_name', 'organization_logo'] as const;
export type OrgBrandField = (typeof ORG_BRAND_FIELDS)[number];

type Source = Record<string, unknown> | null | undefined;

function resolveField(field: OrgBrandField, sources: Source[]): string {
  for (const src of sources) {
    const v = src?.[field];
    if (typeof v === 'string') return v.trim();
  }
  return '';
}

/** Resolve from sources in priority order: (public_profiles, users). */
export function resolveOrgBrand(...sources: Source[]): OrgBrand {
  return {
    organization_name: resolveField('organization_name', sources),
    organization_logo: resolveField('organization_logo', sources),
  };
}

/** The brand fields present in a patch, trimmed. */
export function pickOrgBrandPatch(patch: Record<string, unknown> | null | undefined): Partial<OrgBrand> {
  const out: Partial<OrgBrand> = {};
  if (!patch) return out;
  for (const field of ORG_BRAND_FIELDS) {
    const v = patch[field];
    if (typeof v === 'string') out[field] = v.trim();
  }
  return out;
}
