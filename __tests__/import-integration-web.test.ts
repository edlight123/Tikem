/**
 * Where the app runs Connect Eventbrite and who may see its Firebase token
 * (mobile/lib/integrationWeb): www.tikem.co, exact host list, no suffix match.
 */
import { eventbriteReturn, externalTicketsUrl, integrationWebOrigin, isTokenHost } from '../mobile/lib/integrationWeb'

const PROD = 'https://www.tikem.co'

describe('integrationWebOrigin', () => {
  it('runs on www for every production alias (the apex 308 drops WebView headers)', () => {
    for (const base of ['https://tikem.co', 'https://www.tikem.co', 'https://eventhaiti.vercel.app', 'https://jointikem.vercel.app/']) {
      expect(integrationWebOrigin(base)).toBe('https://www.tikem.co')
    }
  })
  it('keeps a local or preview server as configured', () => {
    expect(integrationWebOrigin('http://192.168.1.5:3000/')).toBe('http://192.168.1.5:3000')
  })
})

describe('isTokenHost', () => {
  it('only our exact hosts', () => {
    expect(isTokenHost('https://www.tikem.co/api/integrations/eventbrite/callback?code=1', PROD)).toBe(true)
    expect(isTokenHost('https://tikem.co/x', PROD)).toBe(true)
    for (const u of [
      'https://www.eventbrite.com/oauth/authorize',
      'https://evil.tikem.co/x',
      'https://tikem.co.evil.com/x',
      'https://wwwtikem.co/x',
      'http://www.tikem.co/x',
      'not a url',
    ]) {
      expect(isTokenHost(u, PROD)).toBe(false)
    }
  })
  it('the configured dev server too', () => {
    expect(isTokenHost('http://192.168.1.5:3000/api/integrations/eventbrite/start', 'http://192.168.1.5:3000')).toBe(true)
  })
})

describe('eventbriteReturn', () => {
  it('reads the end of the round trip on our host only', () => {
    expect(eventbriteReturn('https://www.tikem.co/organizer/import?eventbrite=connected', PROD)).toBe('connected')
    expect(eventbriteReturn('https://www.tikem.co/organizer/import/?eventbrite=error', PROD)).toBe('error')
    expect(eventbriteReturn('https://www.tikem.co/organizer/import?eventbrite=weird', PROD)).toBeNull()
    expect(eventbriteReturn('https://www.eventbrite.com/organizer/import?eventbrite=connected', PROD)).toBeNull()
    expect(eventbriteReturn('https://www.tikem.co/organizer?eventbrite=connected', PROD)).toBeNull()
  })
})

describe('externalTicketsUrl', () => {
  it('links out only for a synced Eventbrite event with an https link', () => {
    expect(externalTicketsUrl({ imported: { source: 'eventbrite' }, external_url: 'https://www.eventbrite.com/e/1' })).toBe('https://www.eventbrite.com/e/1')
    expect(externalTicketsUrl({ imported: { source: 'eventbrite' }, external_url: 'javascript:alert(1)' })).toBeNull()
    expect(externalTicketsUrl({ imported: { source: 'eventbrite' }, external_url: 'http://x.com' })).toBeNull()
    expect(externalTicketsUrl({ external_url: 'https://www.eventbrite.com/e/1' })).toBeNull()
    expect(externalTicketsUrl(null)).toBeNull()
  })
})
