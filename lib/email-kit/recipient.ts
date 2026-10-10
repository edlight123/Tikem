// Which language to write an email in, server-side.
//
// Order: an explicit language the caller already knows → the recipient's profile
// (`users/{uid}.language`, found by uid or by email) → the event's region (Kreyòl
// for Haiti, English elsewhere). Never throws: a lookup failure falls through to the
// event fallback, because a wrong-language email beats no email.

import { adminDb } from '@/lib/firebase/admin'
import { fallbackLangForEvent, normalizeLang, type EmailLang } from './i18n'

export async function resolveEmailLang(opts: {
  explicit?: unknown
  userId?: string | null
  email?: string | null
  event?: { country?: unknown; city?: unknown; timezone?: unknown } | null
}): Promise<EmailLang> {
  const explicit = normalizeLang(opts.explicit)
  if (explicit) return explicit

  try {
    if (opts.userId) {
      const snap = await adminDb.collection('users').doc(String(opts.userId)).get()
      const lang = normalizeLang(snap.exists ? (snap.data() as any)?.language : null)
      if (lang) return lang
    }
    const email = String(opts.email || '').trim().toLowerCase()
    if (email) {
      const q = await adminDb.collection('users').where('email', '==', email).limit(1).get()
      const lang = normalizeLang(q.empty ? null : (q.docs[0].data() as any)?.language)
      if (lang) return lang
    }
  } catch (err) {
    console.warn('[email] language lookup failed, using the event fallback', (err as any)?.message)
  }

  return fallbackLangForEvent(opts.event || null)
}
