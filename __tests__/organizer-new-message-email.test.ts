/**
 * The organizer "an attendee wrote" email (getOrganizerNewMessageEmail) in all
 * three languages, plus the reply email's new conversation link.
 */
// The alerts module (for attendeeFirstName) imports the Admin SDK at load time.
jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))
jest.mock('@/lib/notification-triggers', () => ({ sendPushNotification: jest.fn() }))

import {
  emailSubjects,
  getOrganizerNewMessageEmail,
  getOrganizerReplyEmail,
  ORGANIZER_MESSAGE_EMAIL_EXCERPT,
} from '@/lib/email'
import type { EmailLang } from '@/lib/email-kit/i18n'
import { attendeeFirstName } from '@/lib/organizer-message-alerts'

const base = {
  attendeeFirstName: 'Marie',
  eventTitle: 'Kompa Fest',
  eventId: 'ev 1',
  threadId: 't/1',
  topic: 'ticket',
  message: 'Can I bring my ticket on my phone?',
}

const EXPECT: Record<EmailLang, { lang: string; head: string; again: string; topic: string; cta: string; subject: string }> = {
  en: {
    lang: 'en',
    head: 'Marie wrote to you',
    again: 'Marie wrote again',
    topic: 'Their ticket',
    cta: 'Reply in your inbox',
    subject: 'Marie sent you a message about Kompa Fest',
  },
  fr: {
    lang: 'fr',
    head: 'Marie vous a écrit',
    again: 'Marie vous a réécrit',
    topic: 'Son billet',
    cta: 'Répondre depuis votre messagerie',
    subject: 'Marie vous a écrit à propos de Kompa Fest',
  },
  ht: {
    lang: 'ht',
    head: 'Marie ekri ou',
    again: 'Marie ekri ou ankò',
    topic: 'Tikè li',
    cta: 'Reponn nan bwat mesaj ou',
    subject: 'Marie voye yon mesaj ba ou sou Kompa Fest',
  },
}

describe.each(['en', 'fr', 'ht'] as EmailLang[])('organizer new-message email (%s)', (lang) => {
  const e = EXPECT[lang]
  const html = getOrganizerNewMessageEmail({ ...base, lang })

  it('renders the POSH Dark shell in the right language', () => {
    expect(html).toContain(`<html lang="${e.lang}"`)
    expect(html).toContain('tikèm')
    expect(html).toContain('#000') // the canvas
  })

  it('shows the first name, the topic, the message and the inbox button', () => {
    expect(html).toContain(e.head)
    expect(html).toContain(e.topic)
    expect(html).toContain('Can I bring my ticket on my phone?')
    expect(html).toContain('Kompa Fest')
    expect(html).toContain(e.cta)
    // Deep link to the event's inbox with the thread preselected, URL-encoded.
    expect(html).toContain('/organizer/events/ev%201/messages?thread=t%2F1')
  })

  it('uses the follow-up heading for a follow-up', () => {
    expect(getOrganizerNewMessageEmail({ ...base, lang, followUp: true })).toContain(e.again)
  })

  it('has a matching subject line', () => {
    expect(emailSubjects.organizerNewMessage(lang, 'Marie', 'Kompa Fest')).toBe(e.subject)
  })

  it('uses the organizer footer and no em-dashes', () => {
    expect(html).toContain('/organizer/payouts')
    expect(html).not.toContain('—')
  })
})

describe('organizer new-message email safety', () => {
  it('escapes attendee-controlled text', () => {
    const html = getOrganizerNewMessageEmail({
      ...base,
      attendeeFirstName: '<b>x</b>',
      message: '<script>alert(1)</script>',
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<b>x</b>')
  })

  it('trims a long message to an excerpt', () => {
    const html = getOrganizerNewMessageEmail({ ...base, message: 'a'.repeat(ORGANIZER_MESSAGE_EMAIL_EXCERPT + 200) })
    expect(html).not.toContain('a'.repeat(ORGANIZER_MESSAGE_EMAIL_EXCERPT))
    expect(html).toContain('a'.repeat(ORGANIZER_MESSAGE_EMAIL_EXCERPT - 1) + '…')
  })

  it('falls back to the "something else" topic for an unknown value', () => {
    expect(getOrganizerNewMessageEmail({ ...base, topic: 'weird', lang: 'fr' })).toContain('Autre chose')
  })

  it('reduces a display name to its first word and localizes the anonymous placeholder', () => {
    expect(attendeeFirstName('Marie-Claire Joseph', 'en')).toBe('Marie-Claire')
    expect(attendeeFirstName('', 'fr')).toBe('Un participant')
    expect(attendeeFirstName('An attendee', 'ht')).toBe('Yon patisipan')
  })
})

describe('attendee reply email links to the conversation', () => {
  const params = {
    attendeeName: 'Marie',
    organizerName: 'Kompa Nights',
    eventTitle: 'Kompa Fest',
    eventId: 'ev1',
    question: 'Parking?',
    reply: 'Yes',
  }

  it.each([
    ['en', 'Open the conversation'],
    ['fr', 'Ouvrir la conversation'],
    ['ht', 'Louvri konvèsasyon an'],
  ] as Array<[EmailLang, string]>)('%s: threadId switches the button to the thread', (lang, label) => {
    const html = getOrganizerReplyEmail({ ...params, lang, threadId: 'th1' })
    expect(html).toContain(label)
    expect(html).toContain('/profile?thread=th1#messages')
  })

  it('without a threadId the button still opens the event (older callers)', () => {
    const html = getOrganizerReplyEmail(params)
    expect(html).toContain('/events/ev1')
    expect(html).not.toContain('#messages')
  })
})
