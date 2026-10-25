import { instagramPlatform } from '@/lib/instagram'

describe('instagramPlatform', () => {
  it('detects phones', () => {
    expect(instagramPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/129')).toBe('android')
    expect(instagramPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1')).toBe('ios')
  })
  it('leaves desktop alone', () => {
    expect(instagramPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129')).toBe('other')
  })
})
