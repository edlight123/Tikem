/**
 * Catch misspelled email domains as people type ("gmaill.com", "gnail.com",
 * "gmail.con"): these never reach anyone and count as bounces against us.
 * Returns the corrected address, or null when the domain looks fine.
 *
 * Deliberately conservative: only the big providers are corrected, the name
 * and the ending are fixed separately (so hotmail.ca or yahoo.co.uk are never
 * "fixed" to .com/.fr), and real look-alikes (ymail, gmx, mail.com) are left
 * alone. A wrong suggestion is worse than none.
 *
 * Copy of lib/email/suggest.ts (the web one); keep the two in step.
 */
const PROVIDERS: Record<string, string[]> = {
  gmail: ['com'],
  yahoo: ['com', 'fr'],
  hotmail: ['com', 'fr'],
  outlook: ['com', 'fr'],
  icloud: ['com'],
  live: ['com', 'fr'],
}
// Real providers one or two letters from a name above.
const REAL_NAMES = new Set(['ymail', 'gmx', 'mail', 'email', 'love', 'aol', 'cloud'])
const COM_TYPOS = /^(con|cpm|cmo|vom|xom|om|comm|cm|co|ocm|coom)$/

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      // Swapped neighbours ("gamil") count as one slip, not two.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  return d[a.length][b.length]
}

export function suggestEmailFix(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  const at = email.lastIndexOf('@')
  if (at < 1 || at === email.length - 1) return null
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)

  // "gmailcom", "gmail" (no dot at all)
  if (!domain.includes('.')) {
    const bare = domain.replace(/com$/, '')
    return PROVIDERS[bare] ? `${local}@${bare}.com` : null
  }

  const dot = domain.indexOf('.')
  let name = domain.slice(0, dot)
  let tld = domain.slice(dot + 1)

  if (!PROVIDERS[name]) {
    if (REAL_NAMES.has(name) || name.length < 4) return null
    let best: string | null = null
    for (const p of Object.keys(PROVIDERS)) {
      const d = distance(name, p)
      if (d <= (p.length >= 6 ? 2 : 1) && (!best || d < distance(name, best))) best = p
    }
    if (!best) return null
    name = best
  }

  if (!PROVIDERS[name].includes(tld)) {
    // hotmail.ca, yahoo.co.uk: another country's real domain, not a typo.
    if (!COM_TYPOS.test(tld) || !PROVIDERS[name].includes('com')) return null
    tld = 'com'
  }

  const fixed = `${name}.${tld}`
  return fixed === domain ? null : `${local}@${fixed}`
}
