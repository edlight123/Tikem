import { buildTrackingUrl, eventPageUrl, parseStoredLinks } from '../mobile/lib/trackingLinks'

describe('mobile tracking links', () => {
  it('builds www event URLs with only the non-empty UTM params', () => {
    const base = eventPageUrl('abc123')
    expect(base).toBe('https://www.tikem.co/events/abc123')
    expect(buildTrackingUrl(base, 'instagram', 'story', '')).toBe(
      'https://www.tikem.co/events/abc123?utm_source=instagram&utm_medium=story'
    )
    expect(buildTrackingUrl(base, ' whatsapp ', '', 'fèt 2026')).toBe(
      'https://www.tikem.co/events/abc123?utm_source=whatsapp&utm_campaign=f%C3%A8t+2026'
    )
    expect(buildTrackingUrl(base, '', '', '')).toBe(base)
  })

  it('drops malformed stored links', () => {
    expect(parseStoredLinks(null)).toEqual([])
    expect(parseStoredLinks('not json')).toEqual([])
    expect(parseStoredLinks(JSON.stringify([{ id: 'a', url: 'u', label: 'l' }, { id: 1 }]))).toHaveLength(1)
  })
})
