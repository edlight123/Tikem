/**
 * Server-side copy for invite notifications, in the recipient's language when
 * their profile carries one (en / fr / ht), English otherwise. Pure.
 */

import { eventZone } from '@/lib/home/feed'
import { toMs } from './policy'

export type InviteLang = 'en' | 'fr' | 'ht'

export function langOf(user: Record<string, any> | null | undefined): InviteLang {
  const raw = String(user?.language || user?.preferred_language || user?.locale || '')
    .slice(0, 2)
    .toLowerCase()
  return raw === 'fr' || raw === 'ht' ? raw : 'en'
}

const HT_WEEKDAYS = ['dimanch', 'lendi', 'madi', 'mèkredi', 'jedi', 'vandredi', 'samdi']

/** The event's weekday in the event's own zone, e.g. "Saturday" / "samedi" / "samdi". */
export function eventWeekday(event: Record<string, any> | null | undefined, lang: InviteLang): string {
  const ms = toMs(event?.start_datetime)
  if (ms === null) return ''
  const zone = eventZone(event as any)
  try {
    if (lang === 'ht') {
      const idx = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: zone }).format(new Date(ms))
      const order = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      return HT_WEEKDAYS[order.indexOf(idx)] || ''
    }
    return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'long', timeZone: zone }).format(
      new Date(ms)
    )
  } catch {
    return ''
  }
}

const COPY = {
  en: {
    inviteTitle: "You're invited",
    invite: (name: string, title: string, day: string) => `${name} invited you to ${title}${day ? `, ${day}` : ''}`,
    joinedTitle: 'Your invite worked',
    joined: (name: string) => `${name} joined Tikèm from your invite`,
    someone: 'A friend',
  },
  fr: {
    inviteTitle: 'Tu es invité',
    invite: (name: string, title: string, day: string) => `${name} t'invite à ${title}${day ? `, ${day}` : ''}`,
    joinedTitle: 'Ton invitation a marché',
    joined: (name: string) => `${name} a rejoint Tikèm grâce à ton invitation`,
    someone: 'Un ami',
  },
  ht: {
    inviteTitle: 'Yo envite w',
    invite: (name: string, title: string, day: string) => `${name} envite w nan ${title}${day ? `, ${day}` : ''}`,
    joinedTitle: 'Envitasyon ou mache',
    joined: (name: string) => `${name} vin sou Tikèm gras a envitasyon ou`,
    someone: 'Yon zanmi',
  },
} as const

export function inviteCopy(lang: InviteLang) {
  return COPY[lang]
}
