/**
 * @jest-environment node
 *
 * The SSRF guard behind event import (lib/security/net-guard, lib/import/safe-fetch):
 * an allow-list of global unicast addresses, mapped/NAT64 addresses judged by
 * their embedded IPv4, 6to4/Teredo refused; URLs that are https, public-looking
 * hosts only; and a DNS lookup that refuses a name when ANY answer is private.
 */
jest.mock('server-only', () => ({}), { virtual: true })

const lookupMock = jest.fn()
jest.mock('node:dns', () => ({ __esModule: true, default: { lookup: (...a: any[]) => lookupMock(...a) }, lookup: (...a: any[]) => lookupMock(...a) }))

import { isPrivateIp } from '@/lib/security/net-guard'
import { isPublicHttpsUrl } from '@/lib/import/url'
import { guardedLookup, checkImageBytes, IMAGE_MAX_BYTES } from '@/lib/import/safe-fetch'

describe('addresses a server-side fetch must never reach', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '198.18.0.1', '240.0.0.1', '255.255.255.255',
    '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::127.0.0.1', '::ffff:169.254.169.254',
    '64:ff9b::a9fe:a9fe', '64:ff9b::169.254.169.254', '64:ff9b:1::a00:1', '2002:7f00:1::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:db8::1',
    'ff02::1', 'not-an-ip', '[::1]', 'fe80::1%eth0', '',
  ])('%s is private', (ip) => expect(isPrivateIp(ip)).toBe(true))

  it.each(['8.8.8.8', '172.15.0.1', '172.32.0.1', '151.101.1.69', '2606:4700::6810:85e5', '::ffff:8.8.8.8', '64:ff9b::808:808', '2a00:1450:4001:82a::200e'])(
    '%s is public',
    (ip) => expect(isPrivateIp(ip)).toBe(false),
  )
})

describe('URLs we will fetch', () => {
  it.each(['https://www.eventbrite.com/e/123', 'https://lu.ma/abc', 'https://example.org/events?x=1'])('%s is allowed', (u) =>
    expect(isPublicHttpsUrl(u)).toBe(true),
  )
  it.each([
    'http://www.eventbrite.com/e/123',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://0x7f000001/',
    'https://2130706433/',
    'https://localhost/',
    'https://metadata.google.internal/',
    'https://printer.local/',
    'https://intranet/',
    'https://user:pass@example.org/',
    'https://example.org:8443/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
  ])('%s is refused', (u) => expect(isPublicHttpsUrl(u)).toBe(false))
})

describe('the pinned DNS lookup', () => {
  const run = (answers: Array<{ address: string; family: number }> | Error, options: any = {}) =>
    new Promise<{ err: any; address?: any; family?: any }>((resolve) => {
      lookupMock.mockImplementationOnce((_h: string, _o: any, cb: any) => (answers instanceof Error ? cb(answers) : cb(null, answers)))
      guardedLookup('event.example', options, (err: any, address?: any, family?: any) => resolve({ err, address, family }))
    })

  beforeEach(() => lookupMock.mockReset())

  it('connects to the checked public address', async () => {
    const r = await run([{ address: '151.101.1.69', family: 4 }])
    expect(r.err).toBeNull()
    expect(r.address).toBe('151.101.1.69')
    expect(r.family).toBe(4)
  })

  it('answers the all:true form with the one checked address', async () => {
    const r = await run([{ address: '2606:4700::6810:85e5', family: 6 }], { all: true })
    expect(r.err).toBeNull()
    expect(r.address).toEqual([{ address: '2606:4700::6810:85e5', family: 6 }])
  })

  it('refuses a name when any answer is private (DNS rebinding / split answers)', async () => {
    const r = await run([
      { address: '151.101.1.69', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ])
    expect(r.err?.code).toBe('EPRIVATE')
  })

  it('refuses a public name that resolves to a mapped loopback', async () => {
    expect((await run([{ address: '::ffff:127.0.0.1', family: 6 }])).err?.code).toBe('EPRIVATE')
  })

  it('refuses an empty answer and passes DNS errors through', async () => {
    expect((await run([])).err?.code).toBe('EPRIVATE')
    expect((await run(Object.assign(new Error('nx'), { code: 'ENOTFOUND' }))).err?.code).toBe('ENOTFOUND')
  })
})

describe('image limits (share-card style)', () => {
  // A 1x1 PNG.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

  it('accepts a real raster image with an image content type, typed from its bytes', async () => {
    expect(await checkImageBytes(png, 'image/jpeg')).toEqual({ mime: 'image/png', ext: 'png' })
  }, 60_000) // sharp's first load is slow

  it('refuses a non-image content type, SVG, junk bytes and oversize bodies', async () => {
    expect(await checkImageBytes(png, 'text/html')).toBeNull()
    expect(await checkImageBytes(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml')).toBeNull()
    expect(await checkImageBytes(Buffer.from('definitely not an image'), 'image/png')).toBeNull()
    expect(await checkImageBytes(Buffer.alloc(IMAGE_MAX_BYTES + 1), 'image/png')).toBeNull()
  })
})
