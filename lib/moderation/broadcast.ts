/**
 * Moderation for an organizer's message to everyone with a ticket.
 *
 * Pure. A message reaches every holder's inbox from Tikra's sending domain, so
 * it is the most valuable thing a phisher could get from an organizer account.
 * These checks refuse the shapes abuse takes and leave ordinary updates alone:
 *   - asking for a password / card details / a login, or for money sent outside
 *     Tikra (an e-transfer to an address, gift cards, a wire, crypto) is refused
 *     whether or not the message carries a link: "e-transfer the balance to
 *     me@x.com" needs no link to steal;
 *   - links are found the way a mail client linkifies them (scheme links,
 *     www., and bare `domain.tld/path` with any TLD), and every one must be
 *     https or bare, not a shortener; at most 3 of them, with words around;
 *   - a wall of capitals is refused.
 * Text is NFKC-normalised (full-width and compatibility letters fold to plain
 * ones) and stripped of zero-width and direction-control characters before any
 * check, so `pass​word` or `ｐａｓｓｗｏｒｄ` can't slip through, and the common
 * `evil[.]xyz` / `evil(.)xyz` obfuscation is folded back to a dot. Every
 * message sent is also stored in event_updates for review.
 */

export const BROADCAST_MAX_TITLE = 120
export const BROADCAST_MAX_MESSAGE = 2000
export const BROADCAST_MAX_LINKS = 3

export type BroadcastRefusal =
  | 'empty'
  | 'too_long'
  | 'too_many_links'
  | 'insecure_link'
  | 'shortened_link'
  | 'phishing'
  | 'shouting'

const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'rb.gy', 'shorturl.at', 'ow.ly', 'buff.ly',
  'tiny.cc', 'rebrand.ly', 's.id', 'v.gd', 'lnkd.in', 'bl.ink', 'shorte.st', 'adf.ly', 'tiny.one', 'qrco.de',
  'linktr.ee', 'shorturl.com', 'x.co', 'po.st', 'soo.gd', 'clck.ru', 'urlz.fr', 'dub.sh',
])

/** Zero-width, soft hyphen, word joiner, BOM and bidi controls. */
const INVISIBLE = /[­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/g

/** What every check reads: NFKC, no invisibles, `[.]` / `(.)` / ` [dot] ` folded to a dot. */
export function normalizeForModeration(text: string): string {
  return String(text || '')
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(/\s*[[(]\s*(?:\.|dot)\s*[\])]\s*/gi, '.')
}

// Credential requests: refused anywhere in the message.
const CREDENTIALS = [
  /\bpass\s*(?:word|code|wd)s?\b/i,
  /\bmot\s+de\s+passe\b/i,
  /\b(?:log\s*-?in|sign\s*-?in)\s+(?:details|info|credentials)\b/i,
  /\b(?:verify|confirm|update|validate|unlock)\s+(?:your\s+)?(?:account|card|payment|identity|login|billing)\b/i,
  /\b(?:v[ée]rifie[rz]?|confirme[rz]?|mettez\s+[àa]\s+jour)\s+(?:votre|ton|vos)\s+(?:compte|carte|paiement|identit[ée]|informations)\b/i,
  /\b(?:card\s+number|num[ée]ro\s+de\s+(?:la\s+)?carte|cvv|cvc|security\s+code|pin\s+code|one[-\s]?time\s+code|otp)\b/i,
  /\b(?:seed\s+phrase|recovery\s+phrase|private\s+key)\b/i,
]

// Money sent outside Tikra: refused anywhere. "Interac accepted at the door"
// is fine; "send an e-transfer to me@x.com" is not.
const PAYMENT_REQUESTS = [
  /\b(?:gift\s*cards?|cartes?\s+cadeaux?|steam\s+cards?|itunes\s+cards?)\b/i,
  /\b(?:wire\s+transfer|bank\s+transfer|virement(?:\s+bancaire)?|western\s+union|moneygram)\b/i,
  /\b(?:bitcoin|btc|usdt|ethereum|crypto(?:currency)?)\s+(?:wallet|address|payment)\b/i,
  /\b(?:send|transfer|e-?transfer|pay|wire|envoye[rz]?|payez|transf[ée]re[rz]?)\b[^.!?\n]{0,50}\b(?:to|at|à|au|sur)\s+(?:\S+@\S+|me\b|us\b|moi\b|nous\b|this\s+(?:email|number|address)|ce\s+(?:courriel|num[ée]ro))/i,
  /\b(?:send|make|do|faites|envoye[rz]?)\s+(?:an?\s+|the\s+|your\s+|un\s+)?(?:interac\s+)?(?:e-?transfer|zelle|venmo|cash\s*app\s+payment|virement\s+interac)\b/i,
  /\b(?:pay|payment|deposit|paiement|payez|acompte)\b[^.!?\n]{0,40}\b(?:via|by|with|through|par|avec)\s+(?:e-?transfer|zelle|venmo|cash\s*app|paypal\s+friends|crypto|bitcoin|gift\s*card|western\s+union)\b/i,
]

const TLD = '(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59}|[\\p{L}]{2,63})'
const LABEL = '[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]{0,61}[\\p{L}\\p{N}])?'
/**
 * Scheme links (any scheme://), www. links, and bare `label.(label.)*tld` with an
 * optional port and path, the way a mail client turns text into links.
 */
const LINK_RE = new RegExp(
  `(?:\\b[a-z][a-z0-9+.-]*:\\/\\/[^\\s<>"')]+)|(?:\\bwww\\.[^\\s<>"')]+)|(?:(?<![\\p{L}\\p{N}@.-])(?:${LABEL}\\.)+${TLD}(?::\\d{2,5})?(?:\\/[^\\s<>"')]*)?(?![\\p{L}\\p{N}-]))`,
  'giu'
)

export function extractLinks(text: string): string[] {
  return Array.from(normalizeForModeration(text).matchAll(LINK_RE)).map((m) => m[0].replace(/[.,;:!?]+$/, ''))
}

function hostOf(link: string): string {
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(link) ? link : `https://${link}`
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return link.toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/:?#]/)[0].replace(/^www\./, '')
  }
}

export function checkBroadcast(input: { title?: string | null; message: string }): { ok: true } | { ok: false; code: BroadcastRefusal } {
  const rawTitle = String(input.title || '').trim()
  const rawMessage = String(input.message || '').trim()
  if (!normalizeForModeration(rawMessage).trim()) return { ok: false, code: 'empty' }
  if (rawTitle.length > BROADCAST_MAX_TITLE || rawMessage.length > BROADCAST_MAX_MESSAGE) return { ok: false, code: 'too_long' }

  const text = normalizeForModeration(`${rawTitle}\n${rawMessage}`)

  if (CREDENTIALS.some((re) => re.test(text)) || PAYMENT_REQUESTS.some((re) => re.test(text))) {
    return { ok: false, code: 'phishing' }
  }

  const links = Array.from(text.matchAll(LINK_RE)).map((m) => m[0].replace(/[.,;:!?]+$/, ''))
  if (links.length > BROADCAST_MAX_LINKS) return { ok: false, code: 'too_many_links' }
  // Only https (or a bare domain a mail client opens as https) may be sent.
  if (links.some((l) => /^[a-z][a-z0-9+.-]*:\/\//i.test(l) && !/^https:\/\//i.test(l))) return { ok: false, code: 'insecure_link' }
  if (links.some((l) => SHORTENERS.has(hostOf(l)))) return { ok: false, code: 'shortened_link' }

  // Mostly link: what's left without the links is too short to be a message.
  const withoutLinks = text.replace(LINK_RE, '').replace(/\s+/g, ' ').trim()
  if (links.length > 0 && withoutLinks.length < 12) return { ok: false, code: 'too_many_links' }

  const letters = withoutLinks.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '')
  if (letters.length >= 30 && letters.replace(/[^A-ZÀ-ÖØ-Þ]/g, '').length / letters.length > 0.7) {
    return { ok: false, code: 'shouting' }
  }
  return { ok: true }
}
