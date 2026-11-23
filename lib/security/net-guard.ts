/**
 * Is this IP address somewhere a server-side fetch must never reach?
 * Allow-list, not deny-list: only global unicast passes. IPv4-mapped/
 * compatible, NAT64 (64:ff9b::/96, 64:ff9b:1::/48), 6to4 (2002::/16) and
 * Teredo (2001::/32) addresses are unwrapped to their embedded IPv4 or
 * refused. Anything unrecognised counts as private. Used by
 * lib/import/safe-fetch (the pinned DNS lookup).
 */
import net from 'node:net'

const PRIVATE_V4 = new net.BlockList()
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) PRIVATE_V4.addSubnet(addr, prefix, 'ipv4')

const GLOBAL_V6 = new net.BlockList()
GLOBAL_V6.addSubnet('2000::', 3, 'ipv6')
const SPECIAL_V6 = new net.BlockList()
for (const [addr, prefix] of [['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['2001:10::', 28], ['2001:20::', 28]] as const) {
  SPECIAL_V6.addSubnet(addr, prefix, 'ipv6')
}

/** Expand an IPv6 address to its eight 16-bit groups, or null. */
function groups(v6: string): number[] | null {
  let s = v6
  const v4tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (v4tail) {
    const p = v4tail[1].split('.').map(Number)
    s = s.slice(0, -v4tail[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`
  }
  const [head, tail] = s.split('::')
  const h = head ? head.split(':') : []
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : []
  if (s.split('::').length > 2) return null
  const fill = tail !== undefined ? 8 - h.length - t.length : 0
  const all = [...h, ...Array(Math.max(0, fill)).fill('0'), ...t]
  if (all.length !== 8) return null
  const out = all.map((g) => parseInt(g || '0', 16))
  return out.some((n) => !Number.isFinite(n) || n < 0 || n > 0xffff) ? null : out
}

const v4From = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`

export function isPrivateIp(ip: string): boolean {
  const v = ip.trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  if (net.isIPv4(v)) return PRIVATE_V4.check(v, 'ipv4')
  if (!net.isIPv6(v)) return true
  const g = groups(v)
  if (!g) return true
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible): judge the IPv4.
  if (g.slice(0, 5).every((n) => n === 0) && (g[5] === 0xffff || g[5] === 0) && (g[6] || g[7])) {
    return isPrivateIp(v4From(g[6], g[7]))
  }
  // NAT64: 64:ff9b::/96 and 64:ff9b:1::/48 embed an IPv4 in the last 32 bits.
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPrivateIp(v4From(g[6], g[7]))
  if (!GLOBAL_V6.check(v, 'ipv6')) return true // loopback, ULA, link-local, multicast, unspecified…
  if (SPECIAL_V6.check(v, 'ipv6')) return true // Teredo, 6to4, documentation, ORCHID
  return false
}
