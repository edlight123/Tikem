import * as web from '../lib/guestlistVisibility'
import * as mobile from '../mobile/lib/guestlistVisibility'

/**
 * Both apps read and write the same event doc, so the mobile resolver must
 * give the web's answer for every shape an event can be in — including the
 * legacy boolean-only events and the case that used to break: a web-set
 * guestlist_visibility that mobile had overwritten only as show_guestlist.
 */
describe('guestlist visibility: mobile matches web', () => {
  const modes = [undefined, 'faces', 'count', 'hidden', 'bogus']
  const bools = [undefined, true, false]

  it.each(modes.flatMap((m) => bools.map((b) => [m, b] as const)))(
    'guestlist_visibility=%s show_guestlist=%s',
    (m, b) => {
      const doc = { guestlist_visibility: m, show_guestlist: b }
      expect(mobile.guestlistVisibilityFrom(doc)).toBe(web.guestlistVisibilityFrom(doc))
    },
  )

  it('derives the same legacy boolean', () => {
    for (const v of web.GUESTLIST_VISIBILITIES) {
      expect(mobile.showGuestlistFor(v)).toBe(web.showGuestlistFor(v))
    }
  })

  it('cycles faces -> count -> hidden -> faces, the web order', () => {
    expect(mobile.GUESTLIST_VISIBILITIES).toEqual(web.GUESTLIST_VISIBILITIES)
    expect(mobile.nextGuestlistVisibility('faces')).toBe('count')
    expect(mobile.nextGuestlistVisibility('count')).toBe('hidden')
    expect(mobile.nextGuestlistVisibility('hidden')).toBe('faces')
  })

  it('treats a missing doc as the default', () => {
    expect(mobile.guestlistVisibilityFrom(undefined)).toBe('faces')
  })
})
