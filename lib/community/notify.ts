import 'server-only'
/**
 * Community notifications (lib/community).
 *
 *  - The member who shared an event hears when it goes live, when it was
 *    already on Tikèm (merged), and the claimant hears how their claim went.
 *    TRANSACTIONAL (lib/notifications/policy.ts): they asked for it by
 *    sending, so it is never suppressed by marketing preferences. In-app via
 *    lib/notifications/helpers createNotification, plus a push.
 *  - Admins hear about a new share or claim the same way they hear about a
 *    report (lib/moderation/notify-admins): bell + push to every admin.
 *
 * Best-effort throughout: never throws, so a notification fault cannot fail
 * the write that already happened.
 */
import { adminDb } from '@/lib/firebase/admin'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'

type Lang = 'en' | 'fr' | 'ht'
const langOf = (v: unknown): Lang => {
  const s = String(v || '').slice(0, 2).toLowerCase()
  return s === 'fr' || s === 'ht' ? s : 'en'
}

export type SubmitterOutcome = 'published' | 'merged' | 'claim_approved' | 'claim_rejected'

const COPY: Record<SubmitterOutcome, Record<Lang, { title: string; message: (t: string) => string }>> = {
  published: {
    en: { title: 'Your shared event is live', message: (t) => `Thanks for sharing. "${t}" is now on Tikèm.` },
    fr: { title: 'Votre événement partagé est en ligne', message: (t) => `Merci du partage. « ${t} » est maintenant sur Tikèm.` },
    ht: { title: 'Evènman ou pataje a sou Tikèm', message: (t) => `Mèsi paske w pataje l. « ${t} » sou Tikèm kounye a.` },
  },
  merged: {
    en: { title: 'That event is already on Tikèm', message: (t) => `Thanks for sharing. "${t}" was already listed, so we kept that page.` },
    fr: { title: 'Cet événement est déjà sur Tikèm', message: (t) => `Merci du partage. « ${t} » était déjà en ligne, nous gardons cette page.` },
    ht: { title: 'Evènman sa a te deja sou Tikèm', message: (t) => `Mèsi paske w pataje l. « ${t} » te deja la, nou kenbe paj sa a.` },
  },
  claim_approved: {
    en: { title: 'Your event is yours', message: (t) => `"${t}" is now in your organizer account. You can edit it and sell tickets.` },
    fr: { title: 'Votre événement vous appartient', message: (t) => `« ${t} » est maintenant dans votre compte organisateur. Vous pouvez le modifier et vendre des billets.` },
    ht: { title: 'Evènman an se pou ou', message: (t) => `« ${t} » nan kont òganizatè w kounye a. Ou ka modifye l epi vann tikè.` },
  },
  claim_rejected: {
    en: { title: 'We could not confirm your claim', message: (t) => `We could not confirm that "${t}" is yours. Reply to support with more proof.` },
    fr: { title: 'Nous n’avons pas pu confirmer votre demande', message: (t) => `Nous n’avons pas pu confirmer que « ${t} » est à vous. Écrivez au support avec plus de preuves.` },
    ht: { title: 'Nou pa t ka konfime demann ou', message: (t) => `Nou pa t ka konfime « ${t} » se pou ou. Ekri sipò a ak plis prèv.` },
  },
}

export function submitterCopy(outcome: SubmitterOutcome, lang: unknown, eventTitle: string): { title: string; message: string } {
  const c = COPY[outcome][langOf(lang)]
  return { title: c.title, message: c.message(eventTitle) }
}

/** Tell one member how their share or claim went (transactional). */
export async function notifyCommunityMember(p: {
  userId: string | null | undefined
  outcome: SubmitterOutcome
  eventId: string
  eventTitle: string
}): Promise<void> {
  if (!p.userId) return
  try {
    const snap = await adminDb.collection('users').doc(p.userId).get()
    if (!snap.exists) return
    const { title, message } = submitterCopy(p.outcome, (snap.data() as any)?.language, p.eventTitle)
    const type = p.outcome.startsWith('claim') ? 'community_claim_decided' : 'community_event_published'
    const actionUrl = p.outcome === 'claim_approved' ? `/organizer/events/${p.eventId}/edit` : `/events/${p.eventId}`
    const meta = { eventId: p.eventId, outcome: p.outcome }
    try {
      await createNotification(p.userId, type, title, message, actionUrl, meta)
    } catch (err) {
      console.error('[community] in-app failed', { userId: p.userId, err })
    }
    try {
      await sendPushNotification(p.userId, title, message, actionUrl, { type, ...meta })
    } catch (err) {
      console.error('[community] push failed', { userId: p.userId, err })
    }
  } catch (err) {
    console.error('[community] member notify failed', err)
  }
}

/** Page every admin about a new share or claim (bell + push), like a report. */
export async function notifyAdminsOfCommunity(p: { kind: 'submission' | 'claim'; title: string }): Promise<void> {
  try {
    const title = p.kind === 'submission' ? 'New shared event to review' : 'New event claim to review'
    const message = p.title ? `"${p.title}" is waiting in Community.` : 'A community item is waiting in Community.'
    const actionUrl = '/admin/community'
    const snaps = await Promise.all(
      ['admin', 'super_admin'].map((role) => adminDb.collection('users').where('role', '==', role).get())
    )
    const adminIds = Array.from(new Set(snaps.flatMap((s: any) => s.docs.map((d: any) => String(d.id)))))
    await Promise.all(
      adminIds.map(async (adminId) => {
        try {
          await createNotification(adminId, 'community_review', title, message, actionUrl, { kind: p.kind })
        } catch (err) {
          console.error('[community] admin in-app failed', { adminId, err })
        }
        try {
          await sendPushNotification(adminId, title, message, actionUrl, { type: 'community_review', kind: p.kind })
        } catch (err) {
          console.error('[community] admin push failed', { adminId, err })
        }
      })
    )
  } catch (err) {
    console.error('[community] admin notify failed', err)
  }
}
