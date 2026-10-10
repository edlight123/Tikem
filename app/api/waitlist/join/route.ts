import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import { sendEmail } from '@/lib/email'
import { renderEmail, appUrl, poster, title, meta, serifEyebrow, serifHeading, metric, steps, gap, button } from '@/lib/email-kit/layout'
import { formatEventWhen, type EmailLang } from '@/lib/email-kit/i18n'
import { resolveEmailLang } from '@/lib/email-kit/recipient'
import { eventInstantIso } from '@/lib/email-templates/reminder'

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

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { eventId } = await request.json()

    if (!eventId || typeof eventId !== 'string') {
      return Response.json({ error: 'Event ID required' }, { status: 400 })
    }

    const supabase = await createClient()

    // Check if event exists and is sold out
    const { data: event } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single()

    if (!event) {
      return Response.json({ error: 'Event not found' }, { status: 404 })
    }

    const availableTickets = (event.total_tickets || 0) - (event.tickets_sold || 0)
    
    // Check if already on waitlist
    const { data: existing } = await supabase
      .from('event_waitlist')
      .select('id, position')
      .eq('event_id', eventId)
      .eq('user_id', user.id)
      .single()

    if (existing) {
      return Response.json({ 
        message: 'Already on waitlist',
        position: existing.position 
      })
    }

    // Get current waitlist count for this event
    const { data: waitlistEntries } = await supabase
      .from('event_waitlist')
      .select('id')
      .eq('event_id', eventId)

    const position = (waitlistEntries?.length || 0) + 1

    // Add to waitlist
    const { error: insertError } = await supabase
      .from('event_waitlist')
      .insert({
        event_id: eventId,
        user_id: user.id,
        position
      })

    if (insertError) {
      console.error('Error adding to waitlist:', insertError)
      return Response.json({ error: 'Failed to join waitlist' }, { status: 500 })
    }

    // Send confirmation email. `user.email` is the Firebase Auth address (never
    // the client-writable profile copy); a phone-only account has none and is
    // skipped by sendEmail's null guard. Every organizer-typed value is escaped.
    try {
      const lang = await resolveEmailLang({ userId: user.id, email: user.email || null, event })
      const email = waitlistJoinedEmail(lang, { ...event, id: event.id || eventId }, position)
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

    const supabase = await createClient()

    // Remove from waitlist
    const { error } = await supabase
      .from('event_waitlist')
      .delete()
      .eq('event_id', eventId)
      .eq('user_id', user.id)

    if (error) {
      console.error('Error leaving waitlist:', error)
      return Response.json({ error: 'Failed to leave waitlist' }, { status: 500 })
    }

    // Reorder remaining waitlist positions
    const { data: remaining } = await supabase
      .from('event_waitlist')
      .select('id')
      .eq('event_id', eventId)
      .order('position', { ascending: true })

    if (remaining) {
      for (let i = 0; i < remaining.length; i++) {
        await supabase
          .from('event_waitlist')
          .update({ position: i + 1 })
          .eq('id', remaining[i].id)
      }
    }

    return Response.json({ success: true })
  } catch (error) {
    console.error('Error leaving waitlist:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
