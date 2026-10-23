import * as web from '../lib/profile/org-brand'
import * as mobile from '../mobile/lib/orgBrand'

/**
 * The organizer brand resolves the same way on both apps, so a logo set on one
 * shows on the other (lib/profile/org-brand.ts has the reasoning).
 */
describe('org brand resolution', () => {
  const pub = { organization_name: 'Kanaval Co', organization_logo: 'https://x/pub.png' }
  const user = { organization_name: 'Old Name', organization_logo: 'https://x/user.png' }
  const org = { organization_name: 'Web Name', organization_logo: 'https://x/org.png' }

  const cases: Array<[string, any[]]> = [
    ['canonical wins', [pub, user, org]],
    ['missing canonical falls back to users', [{}, user, org]],
    ['missing canonical and users falls back to organizers', [null, {}, org]],
    ['an empty canonical value is a removal, not a gap', [{ organization_logo: '' }, user, org]],
    ['non-string values are skipped', [{ organization_name: 42, organization_logo: null }, {}, org]],
    ['nothing anywhere', [null, undefined, {}]],
    ['trims', [{ organization_name: '  Spaced  ' }, {}, {}]],
  ]

  it.each(cases)('%s', (_label, sources) => {
    expect(mobile.resolveOrgBrand(...sources)).toEqual(web.resolveOrgBrand(...sources))
  })

  it('resolves in priority order', () => {
    expect(web.resolveOrgBrand(pub, user, org)).toEqual({
      organization_name: 'Kanaval Co',
      organization_logo: 'https://x/pub.png',
    })
    expect(web.resolveOrgBrand({}, user, org).organization_logo).toBe('https://x/user.png')
    expect(web.resolveOrgBrand(null, {}, org).organization_name).toBe('Web Name')
    // Removed in the app: organizers/{uid} still holds the old logo, which
    // must not come back.
    expect(web.resolveOrgBrand({ organization_logo: '' }, { organization_logo: '' }, org).organization_logo).toBe('')
  })

  it('picks only the brand fields present in a patch', () => {
    const patch = { organization_logo: ' https://x/new.png ', full_name: 'Me', updated_at: 'now' }
    expect(web.pickOrgBrandPatch(patch)).toEqual({ organization_logo: 'https://x/new.png' })
    expect(mobile.pickOrgBrandPatch(patch)).toEqual(web.pickOrgBrandPatch(patch))
    expect(web.pickOrgBrandPatch({ organization_name: '' })).toEqual({ organization_name: '' })
    expect(web.pickOrgBrandPatch(null)).toEqual({})
  })
})
