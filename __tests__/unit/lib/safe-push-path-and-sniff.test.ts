import { safePushPath } from '@/lib/push/safePushPath'
import { sniffRasterImage } from '@/lib/security/sniffImage'

describe('safePushPath', () => {
  it('accepts same-origin relative paths', () => {
    expect(safePushPath('/events/123?x=1#t')).toBe('/events/123?x=1#t')
    expect(safePushPath(undefined)).toBe('/')
    expect(safePushPath('')).toBe('/')
  })
  it.each([
    'https://evil.com',
    '//evil.com',
    '/\\evil.com',
    'javascript:alert(1)',
    'evil.com',
    '/a\nb',
    42,
  ])('rejects %p', (raw) => {
    expect(safePushPath(raw as any)).toBeNull()
  })
  it('collapses dot-segment tricks to a single leading slash', () => {
    const out = safePushPath('/.//evil.com')
    expect(out === null || !out.startsWith('//')).toBe(true)
  })
})

describe('sniffRasterImage', () => {
  const pad = (b: number[]) => Buffer.concat([Buffer.from(b), Buffer.alloc(16)])
  it('identifies raster formats from bytes', () => {
    expect(sniffRasterImage(pad([0xff, 0xd8, 0xff]))?.mime).toBe('image/jpeg')
    expect(sniffRasterImage(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.ext).toBe('png')
    expect(sniffRasterImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'binary'))?.mime).toBe('image/webp')
    expect(sniffRasterImage(Buffer.from('GIF89a......'))?.mime).toBe('image/gif')
  })
  it('rejects SVG and HTML', () => {
    expect(sniffRasterImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull()
    expect(sniffRasterImage(Buffer.from('<!doctype html><script>alert(1)</script>'))).toBeNull()
  })
})
