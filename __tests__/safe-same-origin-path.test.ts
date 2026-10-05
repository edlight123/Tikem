/**
 * Post-login redirect targets (lib/safeUrl.safeSameOriginPath), used by the web
 * login page and the phone sign-in panel. Only same-origin paths survive.
 *
 * @jest-environment node
 */
import { safeSameOriginPath } from '@/lib/safeUrl'

const ORIGIN = 'https://www.tikem.co'

describe('safeSameOriginPath', () => {
  it.each([
    ['//evil.com', '/'],
    ['/\\evil.com', '/'],
    ['\\\\evil.com', '/'],
    ['https://evil.com', '/'],
    ['https://evil.com/events/x', '/'],
    ['javascript:alert(1)', '/'],
    ['  javascript:alert(1)', '/'],
    ['JaVaScRiPt:alert(1)', '/'],
    ['data:text/html,<script>alert(1)</script>', '/'],
    ['http://www.tikem.co/events/x', '/'],
    ['', '/'],
    [null, '/'],
    [undefined, '/'],
  ])('%p -> %p', (input, out) => {
    expect(safeSameOriginPath(input as any, ORIGIN)).toBe(out)
  })

  it('keeps a normal path with its query and hash', () => {
    expect(safeSameOriginPath('/events/x', ORIGIN)).toBe('/events/x')
    expect(safeSameOriginPath('/events/x?ref=ig#tickets', ORIGIN)).toBe('/events/x?ref=ig#tickets')
    expect(safeSameOriginPath('https://www.tikem.co/tickets', ORIGIN)).toBe('/tickets')
  })

  it('never returns an absolute or protocol-relative URL', () => {
    for (const raw of ['//evil.com', '/\\evil.com', '/%2F%2Fevil.com', '/./evil', 'events/x']) {
      const out = safeSameOriginPath(raw, ORIGIN)
      expect(out.startsWith('/')).toBe(true)
      expect(out.startsWith('//')).toBe(false)
    }
  })
})

describe('dot-segment bypasses', () => {
  it.each(['/.//evil.com', '/./\\evil.com', '/a/..//evil.com', '/%2e//evil.com'])('%p stays on this site', (raw) => {
    const out = safeSameOriginPath(raw, 'https://www.tikem.co')
    expect(out.startsWith('//')).toBe(false)
    expect(out.startsWith('/\\')).toBe(false)
    expect(new URL(out, 'https://www.tikem.co').origin).toBe('https://www.tikem.co')
  })
})
