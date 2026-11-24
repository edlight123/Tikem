/**
 * Organization links are stored as https URLs only (lib/organizer/links.ts):
 * the "create your organization" step, its app twin and settings all clean
 * them the same way.
 */
jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))

import { cleanOrgLinks, socialToHttpsUrl, toHttpsUrl } from '@/lib/organizer/links'
import { orgSetupPatch } from '@/lib/organizer/setupDetails'

describe('toHttpsUrl', () => {
  it('adds https to a bare domain and upgrades http', () => {
    expect(toHttpsUrl('kompanights.com')).toBe('https://kompanights.com/')
    expect(toHttpsUrl('http://kompanights.com/events')).toBe('https://kompanights.com/events')
    expect(toHttpsUrl('  https://www.kompa.ht  ')).toBe('https://www.kompa.ht/')
  })

  it('is empty for empty input', () => {
    expect(toHttpsUrl('')).toBe('')
    expect(toHttpsUrl('   ')).toBe('')
    expect(toHttpsUrl(undefined)).toBe('')
    expect(toHttpsUrl(null)).toBe('')
  })

  it('refuses other schemes, credentials, bare words, IPs and huge input', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'ftp://files.example.com',
      'mailto:a@b.com',
      'https://user:pass@example.com',
      'localhost',
      'https://192.168.1.1/admin',
      'not a url at all',
      `https://example.com/${'a'.repeat(600)}`,
    ]) {
      expect(toHttpsUrl(bad)).toBeNull()
    }
    expect(toHttpsUrl(42 as any)).toBeNull()
  })

  it('drops a port', () => {
    expect(toHttpsUrl('https://example.com:8443/x')).toBe('https://example.com/x')
  })
})

describe('socialToHttpsUrl', () => {
  it('turns a handle into that network profile URL', () => {
    expect(socialToHttpsUrl('instagram', '@kompa.nights')).toBe('https://www.instagram.com/kompa.nights')
    expect(socialToHttpsUrl('instagram', 'kompanights')).toBe('https://www.instagram.com/kompanights')
    expect(socialToHttpsUrl('facebook', 'kompanights')).toBe('https://www.facebook.com/kompanights')
    expect(socialToHttpsUrl('tiktok', '@kompa')).toBe('https://www.tiktok.com/@kompa')
  })

  it('keeps a link to the right network, as https', () => {
    expect(socialToHttpsUrl('instagram', 'instagram.com/kompa')).toBe('https://instagram.com/kompa')
    expect(socialToHttpsUrl('facebook', 'http://m.facebook.com/kompa')).toBe('https://m.facebook.com/kompa')
    expect(socialToHttpsUrl('twitter', 'https://x.com/kompa')).toBe('https://x.com/kompa')
  })

  it('refuses a link to another site, a bare network home page or a script', () => {
    expect(socialToHttpsUrl('instagram', 'https://evil.example/instagram')).toBeNull()
    expect(socialToHttpsUrl('instagram', 'https://instagram.com.evil.example/x')).toBeNull()
    expect(socialToHttpsUrl('facebook', 'facebook.com')).toBeNull()
    expect(socialToHttpsUrl('facebook', 'https://facebook.com/')).toBeNull()
    expect(socialToHttpsUrl('linkedin', 'javascript:alert(1)//x.com')).toBeNull()
  })

  it('is empty for empty input', () => {
    expect(socialToHttpsUrl('instagram', '')).toBe('')
    expect(socialToHttpsUrl('instagram', undefined)).toBe('')
  })
})

describe('cleanOrgLinks', () => {
  it('cleans only the keys present', () => {
    const r = cleanOrgLinks({ website: 'kompa.ht', instagram: '@kompa' })
    expect(r).toEqual({ ok: true, website: 'https://kompa.ht/', social: { instagram: 'https://www.instagram.com/kompa' } })
  })

  it('names the first bad field', () => {
    expect(cleanOrgLinks({ website: 'javascript:alert(1)' })).toEqual({ ok: false, field: 'website' })
    expect(cleanOrgLinks({ facebook: 'https://evil.example/x' })).toEqual({ ok: false, field: 'facebook' })
  })

  it('an empty value clears the link', () => {
    expect(cleanOrgLinks({ website: '', facebook: '' })).toEqual({ ok: true, website: '', social: { facebook: '' } })
  })
})

describe('orgSetupPatch (the one setup step)', () => {
  it('keeps one line and https links, drops what it cannot read', () => {
    expect(
      orgSetupPatch({
        description: '  Konpa nights\n in Port-au-Prince  ',
        website: 'kompa.ht',
        instagram: '@kompa',
        facebook: 'https://evil.example/page',
      })
    ).toEqual({
      organization_description: 'Konpa nights in Port-au-Prince',
      website: 'https://kompa.ht/',
      social_media: { instagram: 'https://www.instagram.com/kompa' },
    })
  })

  it('caps the line at 300 characters', () => {
    const patch = orgSetupPatch({ description: 'a'.repeat(400) })
    expect((patch?.organization_description as string).length).toBe(300)
  })

  it('is null when everything is empty or optional fields are missing', () => {
    expect(orgSetupPatch({})).toBeNull()
    expect(orgSetupPatch({ description: ' ', website: '', instagram: '' })).toBeNull()
    expect(orgSetupPatch(null)).toBeNull()
  })
})
