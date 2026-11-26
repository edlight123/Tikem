/**
 * @jest-environment jsdom
 */
import fs from 'fs'
import path from 'path'
import { EMBED_MODE_SCRIPT } from '@/lib/embed-mode'

function run(url: string, ua = 'Mozilla/5.0 (iPhone) Safari') {
  document.documentElement.removeAttribute('data-in-app')
  window.history.replaceState(null, '', url)
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
  // eslint-disable-next-line no-new-func
  new Function(EMBED_MODE_SCRIPT)()
  return document.documentElement.hasAttribute('data-in-app')
}

describe('embed mode (site chrome hidden inside the app)', () => {
  beforeEach(() => sessionStorage.clear())

  it('is off on a plain browser visit', () => {
    expect(run('/resources')).toBe(false)
  })

  it('is on for the app WebView user agent', () => {
    expect(run('/resources', 'Mozilla/5.0 (iPhone) TikemApp')).toBe(true)
  })

  it('is on for ?embed=1 and stays on for that tab', () => {
    expect(run('/legal/terms?embed=1')).toBe(true)
    expect(run('/legal/privacy')).toBe(true)
  })

  it('does not match a look-alike parameter', () => {
    expect(run('/resources?embed=10')).toBe(false)
    expect(run('/resources?noembed=1')).toBe(false)
  })

  it('hides the organizer bar, not only the public navbar', () => {
    const src = fs.readFileSync(path.join(__dirname, '../components/organizer/OrganizerTopNav.tsx'), 'utf8')
    expect(src).toMatch(/<div data-site-chrome /)
  })
})
