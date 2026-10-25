import { normalizeSongText, parseSpotifyEmbedHtml, pickItunesMatch } from '@/lib/songPreview'

const track = { name: 'Never Gonna Give You Up', artists: ['Rick Astley'] }
const r = (trackName: string, artistName: string, previewUrl = 'https://audio-ssl.itunes.apple.com/x.m4a') => ({
  trackName,
  artistName,
  previewUrl,
  trackViewUrl: 'https://music.apple.com/x',
})

describe('song preview matching', () => {
  it('normalizes accents, brackets and feat. tails', () => {
    expect(normalizeSongText('Bèl Fanm (Remastered) feat. X')).toBe('bel fanm')
    expect(normalizeSongText('Song - Live at Parc')).toBe('song')
  })

  it('prefers the exact title by the same artist', () => {
    const m = pickItunesMatch(track, [
      r('Never Gonna Give You Up (Cake Mix)', 'Rick Astley'),
      r('Never Gonna Give You Up', 'Rick Astley'),
    ])
    expect(m?.trackName).toBe('Never Gonna Give You Up')
  })

  it('refuses a same-title song by another artist', () => {
    expect(pickItunesMatch(track, [r('Never Gonna Give You Up', 'Cover Band')])).toBeNull()
  })

  it('ignores results without an https preview', () => {
    expect(pickItunesMatch(track, [r('Never Gonna Give You Up', 'Rick Astley', 'http://x')])).toBeNull()
  })

  it('reads title and artists from the embed page', () => {
    const data = { props: { pageProps: { state: { data: { entity: { name: 'Song', artists: [{ name: 'A' }, { name: 'B' }] } } } } } }
    const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`
    expect(parseSpotifyEmbedHtml(html)).toEqual({ name: 'Song', artists: ['A', 'B'] })
    expect(parseSpotifyEmbedHtml('<html></html>')).toBeNull()
  })
})
