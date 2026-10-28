#!/usr/bin/env node
/**
 * Check whether email addresses exist, without sending anything: look up the
 * domain's mail server, open an SMTP session, ask RCPT TO for each mailbox and
 * hang up before DATA. Also flags misspelled big-provider domains and tests the
 * corrected address.
 *
 *   node scripts/verify-emails.mjs <in.json> <out.json>
 *
 * in.json: an array of addresses, or of objects with a `to` or `email` field.
 * out.json: [{ email, status: valid|invalid|full|unknown, reason, suggestion? }]
 *
 * "full" = the inbox is out of storage (Gmail 4.2.2, iCloud 5.2.2). The address
 * is real, but sending still bounces and counts against us.
 *
 * Only a "mailbox does not exist" answer (5.1.1, "no such user", ...) counts as
 * invalid. Any other refusal (blocked IP, policy, greylisting) is unknown, so a
 * bad day for our IP never marks real people invalid. Domains that accept any
 * mailbox (catch-all) are unknown too. Needs outbound port 25, and runs slowly
 * on purpose (PACE_MS between checks) so the checking IP isn't flagged.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { promises as dns } from 'node:dns'
import net from 'node:net'
import os from 'node:os'

const PACE_MS = Number(process.env.VERIFY_PACE_MS) || 2000
const PER_CONNECTION = Number(process.env.VERIFY_PER_CONNECTION) || 20 // RCPTs before reconnecting
const TIMEOUT_MS = 15000
const MAIL_FROM = 'verify@tikem.co'

const BIG = ['gmail.com', 'yahoo.com', 'yahoo.fr', 'hotmail.com', 'hotmail.fr', 'outlook.com', 'icloud.com', 'live.com', 'aol.com', 'msn.com']
// Real domains one or two letters away from a big provider.
const NOT_TYPOS = new Set(['mail.com', 'yahoo.ca', 'live.fr', 'me.com', 'mac.com', 'gmx.com', 'aim.com', 'joe.com'])

const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/
const INBOX_FULL = /[45]\.2\.2|out of storage|over quota|mailbox full/i
const NO_MAILBOX = /5\.1\.[01]|does not exist|no such user|user unknown|unknown user|mailbox unavailable|recipient (address )?rejected|invalid recipient|not found/i

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

export function typoFix(email) {
  const [local, domain] = email.split('@')
  if (!domain || BIG.includes(domain) || NOT_TYPOS.has(domain)) return null
  const best = BIG.map((b) => [b, lev(domain, b)]).sort((x, y) => x[1] - y[1])[0]
  return best[1] <= 2 ? `${local}@${best[0]}` : null
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))

/** A line-oriented SMTP session: send(cmd) resolves with the full reply. */
function smtpSession(host) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(25, host)
    let buf = ''
    let waiter = null
    const timer = () => setTimeout(() => sock.destroy(new Error('timeout')), TIMEOUT_MS)
    let t = timer()
    sock.setEncoding('utf8')
    sock.on('data', (chunk) => {
      buf += chunk
      // A reply is complete when its last line is "ddd " (space, not dash).
      const lines = buf.split('\r\n')
      const last = lines[lines.length - 2]
      if (last && /^\d{3} /.test(last) && waiter) {
        const reply = buf
        buf = ''
        clearTimeout(t)
        const w = waiter
        waiter = null
        w.ok(reply)
      }
    })
    sock.on('error', (e) => (waiter ? waiter.fail(e) : reject(e)))
    sock.on('close', () => waiter && waiter.fail(new Error('closed')))
    const read = () => new Promise((ok, fail) => (waiter = { ok, fail }))
    const send = (cmd) => {
      // Addresses come from sign-ups: a CR/LF in one would inject SMTP commands.
      if (/[\r\n]/.test(cmd)) return Promise.reject(new Error('control character in SMTP command'))
      clearTimeout(t)
      t = timer()
      const p = read()
      sock.write(cmd + '\r\n')
      return p
    }
    read().then(
      (banner) => resolve({ banner, send, close: () => { clearTimeout(t); sock.end('QUIT\r\n') } }),
      reject
    )
  })
}

const mxCache = new Map()
async function mxFor(domain) {
  if (!mxCache.has(domain)) {
    mxCache.set(
      domain,
      dns
        .resolveMx(domain)
        .then((r) => r.sort((a, b) => a.priority - b.priority).map((x) => x.exchange))
        .catch(async () => {
          // No MX: a domain with an A record can still take mail; no A either means nothing can.
          try { await dns.resolve4(domain); return [domain] } catch { return [] }
        })
    )
  }
  return mxCache.get(domain)
}

/** Check every address of one domain over as few connections as possible. */
async function checkDomain(domain, emails, onResult) {
  const mx = await mxFor(domain)
  if (!mx.length) {
    for (const e of emails) onResult(e, 'invalid', 'domain cannot receive mail')
    return
  }
  let catchAll = null
  let i = 0
  while (i < emails.length) {
    let s
    try {
      s = await smtpSession(mx[0])
      if (!s.banner.startsWith('220')) throw new Error(s.banner.trim())
      await s.send(`EHLO ${os.hostname()}`)
      const from = await s.send(`MAIL FROM:<${MAIL_FROM}>`)
      if (!from.startsWith('250')) throw new Error(from.trim())
      if (catchAll === null && domain !== 'gmail.com') {
        const probe = await s.send(`RCPT TO:<tikem-probe-${Date.now()}@${domain}>`)
        catchAll = probe.startsWith('250')
      }
      for (let n = 0; n < PER_CONNECTION && i < emails.length; n++, i++) {
        const e = emails[i]
        const r = (await s.send(`RCPT TO:<${e}>`)).trim().replace(/\s+/g, ' ')
        if (r.startsWith('250')) onResult(e, catchAll ? 'unknown' : 'valid', catchAll ? 'domain accepts any address' : 'mailbox exists')
        else if (INBOX_FULL.test(r)) onResult(e, 'full', r.slice(0, 120))
        else if (r.startsWith('5') && NO_MAILBOX.test(r)) onResult(e, 'invalid', r.slice(0, 120))
        else onResult(e, 'unknown', r.slice(0, 120))
        await sleep(PACE_MS)
      }
      s.close()
    } catch (err) {
      s?.close()
      // Connection-level failure: everything not yet checked on this domain is unknown.
      for (; i < emails.length; i++) onResult(emails[i], 'unknown', `server: ${String(err.message || err).slice(0, 100)}`)
    }
    await sleep(PACE_MS)
  }
}

export async function verifyEmails(emails, log = () => {}) {
  const results = new Map()
  const suggestions = new Map()
  const all = new Set(emails.map((e) => e.trim().toLowerCase()))
  for (const e of [...all]) {
    if (!EMAIL_RE.test(e)) {
      results.set(e, { email: e, status: 'invalid', reason: 'malformed address' })
      all.delete(e)
    }
  }
  for (const e of all) {
    const fix = typoFix(e)
    if (fix) suggestions.set(e, fix)
  }
  const toCheck = new Set([...all].filter((e) => !suggestions.has(e)))
  for (const fix of suggestions.values()) toCheck.add(fix)

  const byDomain = new Map()
  for (const e of toCheck) {
    const d = e.split('@')[1]
    if (!byDomain.has(d)) byDomain.set(d, [])
    byDomain.get(d).push(e)
  }
  let done = 0
  for (const [domain, list] of byDomain) {
    await checkDomain(domain, list, (e, status, reason) => {
      results.set(e, { email: e, status, reason })
      log(`${++done}/${toCheck.size} ${status.padEnd(7)} ${e}  ${reason}`)
    })
  }
  for (const [bad, fix] of suggestions) {
    const f = results.get(fix)
    results.set(bad, {
      email: bad,
      status: 'invalid',
      reason: 'misspelled domain',
      suggestion: fix,
      suggestionStatus: f?.status,
    })
    if (!all.has(fix)) results.delete(fix)
  }
  return [...results.values()]
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [inPath, outPath] = process.argv.slice(2)
  if (!inPath || !outPath) {
    console.error('usage: node scripts/verify-emails.mjs <in.json> <out.json>')
    process.exit(1)
  }
  const input = JSON.parse(readFileSync(inPath, 'utf8')).map((x) => (typeof x === 'string' ? x : x.to || x.email))
  const out = await verifyEmails(input, console.log)
  writeFileSync(outPath, JSON.stringify(out, null, 1))
  const tally = {}
  for (const r of out) tally[r.status] = (tally[r.status] || 0) + 1
  console.log('done', tally)
}
