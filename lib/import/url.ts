/** Pure (no Node imports): safe in the browser, the app's tests and the server. */

/** Only public https hosts: never an IP literal, localhost, a port or an internal name. */
export function isPublicHttpsUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false
    const h = u.hostname.toLowerCase()
    if (!h.includes('.') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return false
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || /^\d+$/.test(h.replace(/\./g, '')) || h.includes(':') || h.startsWith('[')) return false
    return true
  } catch {
    return false
  }
}
