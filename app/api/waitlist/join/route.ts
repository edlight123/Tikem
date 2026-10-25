import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { sendEmail } from '@/lib/email'
import { renderEmail, appUrl, poster, title, meta, serifEyebrow, serifHeading, metric, steps, gap, button } from '@/lib/email-kit/layout'
import { formatEventWhen, type EmailLang } from '@/lib/email-kit/i18n'
import { resolveEmailLang } from '@/lib/email-kit/recipient'
import { eventInstantIso } from '@/lib/email-templates/reminder'
import { WAITLIST_COLLECTION, isEventClosedForWaitlist, isWaitlistEnabled, seatsLeftNow } from '@/lib/waitlist'

const WAITLIST_COPY = {
  en: {
    fallbackTitle: 'this event',
    subject: (e: string) => `You're on the waitlist for ${e}`,
    preheader: (e: string, n: number) => `You're number ${n} on the waitlist for ${e}.`,
    status: 'Waitlist',
    eyebrow: "you're on the list",
    position: 'Your place',
    next: 'what happens next',
    steps: [
      'If tickets open up, we email you right away with a link to buy.',
      'Freed-up tickets go to whoever buys first, so act quickly when that email comes.',
    ],
    view: 'View the event',
  },
  fr: {
    fallbackTitle: 'cet événement',
    subject: (e: string) => `Vous êtes sur la liste d'attente pour ${e}`,
    preheader: (e: string, n: number) => `Vous êtes numéro ${n} sur la liste d'attente pour ${e}.`,
    status: "Liste d'attente",
    eyebrow: 'vous êtes sur la liste',
    position: 'Votre place',
    next: 'la suite',
    steps: [
      'Si des billets se libèrent, on vous envoie tout de suite un e-mail avec un lien pour acheter.',
      'Les billets libérés vont à la première personne qui achète : ne tardez pas quand cet e-mail arrive.',
    ],
    view: "Voir l'événement",
  },
  ht: {
    fallbackTitle: 'evènman sa a',
    subject: (e: string) => `Ou sou lis datant pou ${e}`,
    preheader: (e: string, n: number) => `Ou se nimewo ${n} sou lis datant pou ${e}.`,
    status: 'Lis datant',
    eyebrow: 'ou sou lis la',
    position: 'Plas ou',
    next: 'sa k ap vini apre',
    steps: [
      'Si gen tikè ki libere, n ap voye yon imèl ba ou touswit ak yon lyen pou achte.',
      'Se moun ki achte an premye ki pran tikè ki libere yo, kidonk aji vit lè imèl la rive.',
    ],
    view: 'Wè evènman an',
  },
} satisfies Record<EmailLang, unknown>

function waitlistJoinedEmail(lang: EmailLang, event: Record<string, any>, position: number) {
  const t = WAITLIST_COPY[lang]
  const eventTitle = String(event?.title || '').replace(/[\r\n]+/g, ' ').trim() || t.fallbackTitle
  const posterUrl = String(event?.banner_image_url || '').trim() || null
  const when = formatEventWhen(eventInstantIso(event?.start_datetime), lang, event)
  const metaLine = [when?.line, [event?.venue_name, event?.city].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
  const html = renderEmail({
    lang,
    title: eventTitle,
    preheader: t.preheader(eventTitle, position),
    status: { label: t.status, tone: 'grey' },
    footer: 'attendee',
    blocks: [
      poster(posterUrl, eventTitle),
      posterUrl ? gap(28) : '',
      serifEyebrow(t.eyebrow),
      title(eventTitle),
      metaLine ? meta(metaLine) : '',
      gap(28),
      metric(t.position, `#${position}`),
      button(t.view, `${appUrl()}/events/${encodeURIComponent(String(event?.id || ''))}`),
      gap(40),
      serifHeading(t.next),
      steps(t.steps),
    ],
  })
  return { subject: t.subject(eventTitle), html }
}

async function myEntry(eventId: string, userId: string) {
  const snap = await adminDb
    .collection(WAITLIST_COLLECTION)
    .where('event_id', '==', eventId)
    .where('user_id', '==', userId)
    .limit(1)
    .get()
  return snap.empty ? null : snap.docs[0]
}

/**
 * Am I on this event's waitlist? The web button reads this (client rules do
 * not expose event_waitlist).
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return Response.json({ onWaitlist: false })
    const eventId = new URL(request.url).searchParams.get('eventId')
    if (!eventId) return Response.json({ error: 'Event ID required' }, { status: 400 })
    const entry = await myEntry(eventId, user.id)
    const data = entry?.data() || null
    const live = !!data && String(data.status || 'waiting') === 'waiting'
    return Response.json({ onWaitlist: live, position: live ? Number(data?.position || 0) || null : null })
  } catch (error) {
    console.error('Error reading waitlist status:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { eventId } = await request.json().catch(() => ({}))

    if (!eventId || typeof eventId !== 'string') {
      return Response.json({ error: 'Event ID required' }, { status: 400 })
    }

    const eventSnap = await adminDb.collection('events').doc(eventId).get()
    if (!eventSnap.exists) {
      return Response.json({ error: 'Event not found' }, { status: 404 })
    }
    const event = { id: eventId, ...(eventSnap.data() || {}) } as Record<string, any>

    // The organizer must have turned the waitlist on. This route used to
    // accept anyone for any event, so people joined lists nobody would ever
    // act on.
    if (!isWaitlistEnabled(event)) {
      return Response.json(
        { error: 'This event does not have a waitlist.', code: 'waitlist_disabled' },
        { status: 409 }
      )
    }
    if (isEventClosedForWaitlist(event, Date.now())) {
      return Response.json(
        { error: 'This event is no longer taking a waitlist.', code: 'event_closed' },
        { status: 409 }
      )
    }
    // Only a sold-out event has a waitlist: if a seat can be bought, buy it.
    const left = await seatsLeftNow(eventId, event)
    if (left == null || left > 0) {
      return Response.json(
        { error: 'Tickets are still available for this event.', code: 'tickets_available' },
        { status: 409 }
      )
    }

    const existing = await myEntry(eventId, user.id)
    if (existing) {
      const data = existing.data() || {}
      if (String(data.status || 'waiting') !== 'waiting') {
        // Rejoining after a closed/purchased entry: back in line.
        await existing.ref.update({ status: 'waiting', email: user.email || data.email || null })
      }
      return Response.json({
        message: 'Already on waitlist',
        position: data.position,
      })
    }

    const waitlistEntries = await adminDb.collection(WAITLIST_COLLECTION).where('event_id', '==', eventId).get()
    const position = (waitlistEntries.size || 0) + 1

    try {
      await adminDb.collection(WAITLIST_COLLECTION).add({
        event_id: eventId,
        user_id: user.id,
        // Firebase Auth address (never the client-writable profile copy), so
        // the "tickets are available" email (lib/waitlist.ts) has somewhere to go.
        email: user.email || null,
        position,
        status: 'waiting',
        created_at: new Date().toISOString(),
      })
    } catch (insertError) {
      console.error('Error adding to waitlist:', insertError)
      return Response.json({ error: 'Failed to join waitlist' }, { status: 500 })
    }

    // Send confirmation email. `user.email` is the Firebase Auth address (never
    // the client-writable profile copy); a phone-only account has none and is
    // skipped by sendEmail's null guard. Every organizer-typed value is escaped.
    try {
      const lang = await resolveEmailLang({ userId: user.id, email: user.email || null, event })
      const email = waitlistJoinedEmail(lang, event, position)
      await sendEmail({
        to: user.email || null,
        subject: email.subject,
        html: email.html,
      })
    } catch (emailError) {
      console.error('Error sending waitlist email:', emailError)
      // Don't fail the request if email fails
    }

    return Response.json({
      success: true,
      position,
      message: `You're #${position} on the waitlist`
    })
  } catch (error) {
    console.error('Error joining waitlist:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Leave waitlist
export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const eventId = searchParams.get('eventId')

    if (!eventId) {
      return Response.json({ error: 'Event ID required' }, { status: 400 })
    }

    const mine = await adminDb
      .collection(WAITLIST_COLLECTION)
      .where('event_id', '==', eventId)
      .where('user_id', '==', user.id)
      .get()
    await Promise.all(mine.docs.map((d: any) => d.ref.delete()))

    // Reorder remaining waitlist positions
    const remaining = await adminDb.collection(WAITLIST_COLLECTION).where('event_id', '==', eventId).get()
    const ordered = [...remaining.docs].sort(
      (a: any, b: any) => Number(a.data()?.position || 0) - Number(b.data()?.position || 0)
    )
    for (let i = 0; i < ordered.length; i++) {
      if (Number(ordered[i].data()?.position || 0) !== i + 1) {
        await ordered[i].ref.update({ position: i + 1 })
      }
    }

    return Response.json({ success: true })
  } catch (error) {
    console.error('Error leaving waitlist:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
