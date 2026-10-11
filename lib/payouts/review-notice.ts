/**
 * Telling the organizer what the payouts team decided about an event held for
 * review (payout_review_queue). Until this existed, the gate's refusal promised
 * "We will email you as soon as it is approved" and nothing ever did.
 *
 * In-app (bell) + push + email, transactional (it is about their own money),
 * localized en/fr/ht from users/{uid}.language. Deduped per resolution by
 * claiming payout_review_notices/{eventId}_{status}_{resolvedAt} first, so a
 * double click or a retried request says it once. Never throws.
 */
import { adminDb } from '@/lib/firebase/admin'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'
import { sendEmail } from '@/lib/email'
import { renderEmail, title as titleBlock, p, gap, button, appUrl } from '@/lib/email-kit/layout'

export type PayoutReviewOutcome = 'released' | 'dismissed' | 'refunding_buyers'

type Lang = 'en' | 'fr' | 'ht'

function langOf(raw: unknown): Lang {
  const code = String(raw || 'en').slice(0, 2).toLowerCase()
  return code === 'fr' || code === 'ht' ? code : 'en'
}

/** Pure copy, exported for tests. */
export function payoutReviewCopy(
  outcome: PayoutReviewOutcome,
  lang: Lang,
  eventTitle: string
): { title: string; body: string; cta: string; status: string } {
  const to = (en: string, fr: string, ht: string) => ({ en, fr, ht })[lang]
  const ev = eventTitle || to('your event', 'votre événement', 'evènman ou')
  const cta = to('View earnings', 'Voir les revenus', 'Gade lajan ou')
  if (outcome === 'released') {
    return {
      title: to('Payout approved', 'Paiement approuvé', 'Peman apwouve'),
      body: to(
        `The Tikèm payouts team approved the payout for ${ev}. You can request your withdrawal now.`,
        `L'équipe paiements de Tikèm a approuvé le paiement pour ${ev}. Vous pouvez demander votre retrait.`,
        `Ekip peman Tikèm apwouve peman pou ${ev}. Ou ka mande retrè w la kounye a.`
      ),
      cta,
      status: to('Approved', 'Approuvé', 'Apwouve'),
    }
  }
  if (outcome === 'refunding_buyers') {
    return {
      title: to('Event cancelled and refunded', 'Événement annulé et remboursé', 'Evènman anile epi ranbouse'),
      body: to(
        `After review, Tikèm cancelled ${ev} and is refunding its buyers from the event's earnings. Please contact support if you have questions.`,
        `Après examen, Tikèm a annulé ${ev} et rembourse les acheteurs à partir des revenus de l'événement. Contactez le support pour toute question.`,
        `Apre revizyon, Tikèm anile ${ev} epi l ap ranbouse moun ki te achte yo ak lajan evènman an. Kontakte sipò si w gen kesyon.`
      ),
      cta: to('Contact support', 'Contacter le support', 'Kontakte sipò'),
      status: to('Refunding', 'Remboursement', 'Ranbousman'),
    }
  }
  return {
    title: to('Payout not approved', 'Paiement non approuvé', 'Peman pa apwouve'),
    body: to(
      `The Tikèm payouts team reviewed ${ev} and did not approve a payout. Please contact support so we can explain the next steps.`,
      `L'équipe paiements de Tikèm a examiné ${ev} et n'a pas approuvé de paiement. Contactez le support pour connaître la suite.`,
      `Ekip peman Tikèm revize ${ev} epi li pa apwouve peman an. Kontakte sipò pou n eksplike w sa k ap vini apre.`
    ),
    cta: to('Contact support', 'Contacter le support', 'Kontakte sipò'),
    status: to('Not approved', 'Non approuvé', 'Pa apwouve'),
  }
}

async function claim(key: string): Promise<boolean> {
  const ref = adminDb.collection('payout_review_notices').doc(key)
  try {
    return await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref)
      if (snap?.exists) return false
      tx.set(ref, { key, claimedAt: new Date().toISOString() })
      return true
    })
  } catch (err) {
    console.error('[payout-review-notice] claim failed; not sending', { key, err })
    return false
  }
}

export async function notifyPayoutReviewOutcome(
  item: { eventId: string; organizerId?: string | null; resolvedAt?: string | null },
  outcome: PayoutReviewOutcome
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const eventId = String(item.eventId || '')
    let organizerId = item.organizerId ? String(item.organizerId) : ''
    const eventSnap = eventId ? await adminDb.collection('events').doc(eventId).get().catch(() => null) : null
    const event = eventSnap?.exists ? (eventSnap.data() as any) : {}
    if (!organizerId) organizerId = String(event?.organizer_id || '')
    if (!organizerId) return { sent: false, reason: 'no_organizer' }

    const key = `${eventId}_${outcome}_${String(item.resolvedAt || '').replace(/[^0-9A-Za-z]/g, '')}`
    if (!(await claim(key))) return { sent: false, reason: 'duplicate' }

    const userSnap = await adminDb.collection('users').doc(organizerId).get().catch(() => null)
    const user = userSnap?.exists ? (userSnap.data() as any) : {}
    const lang = langOf(user?.language)
    const copy = payoutReviewCopy(outcome, lang, String(event?.title || ''))
    const actionUrl = outcome === 'released' ? `/organizer/events/${eventId}/earnings` : '/support'

    try {
      await createNotification(organizerId, 'withdrawal_update', copy.title, copy.body, actionUrl, {
        eventId,
        payoutReview: outcome,
      })
    } catch (err) {
      console.error('[payout-review-notice] in-app failed', { eventId, err })
    }
    try {
      await sendPushNotification(organizerId, copy.title, copy.body, actionUrl, {
        type: 'withdrawal_update',
        eventId,
        payoutReview: outcome,
      })
    } catch (err) {
      console.error('[payout-review-notice] push failed', { eventId, err })
    }
    const email = typeof user?.email === 'string' ? user.email : null
    if (email) {
      const html = renderEmail({
        lang,
        title: copy.title,
        preheader: copy.body,
        status: { label: copy.status, tone: outcome === 'released' ? 'teal' : 'red' },
        footer: 'organizer',
        blocks: [titleBlock(copy.title, 34), gap(24), p(copy.body), gap(28), button(copy.cta, `${appUrl()}${actionUrl}`)],
      })
      const result = await sendEmail({ to: email, subject: copy.title, html })
      if (!result.success) console.warn('[payout-review-notice] email not sent', { eventId, code: (result as any).code })
    }
    return { sent: true }
  } catch (err) {
    console.error('[payout-review-notice] notify failed', { item, err })
    return { sent: false, reason: 'error' }
  }
}
