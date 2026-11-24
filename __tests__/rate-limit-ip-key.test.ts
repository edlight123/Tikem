jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))
import { ipLimitKey } from '@/lib/rate-limit'

describe('ipLimitKey', () => {
  it('keeps IPv4 as is', () => {
    expect(ipLimitKey('203.0.113.9')).toBe('203.0.113.9')
  })
  it('folds IPv4-mapped IPv6 to the IPv4 address', () => {
    expect(ipLimitKey('::ffff:203.0.113.9')).toBe('203.0.113.9')
  })
  it('reduces IPv6 to its /64, so rotating the interface id is one client', () => {
    const a = ipLimitKey('2001:db8:abcd:12:1111:2222:3333:4444')
    const b = ipLimitKey('2001:0db8:abcd:0012:ffff::1')
    expect(a).toBe('2001:db8:abcd:12::/64')
    expect(b).toBe(a)
  })
  it('expands :: compression before taking the prefix', () => {
    expect(ipLimitKey('2001:db8::1')).toBe('2001:db8:0:0::/64')
  })
})
