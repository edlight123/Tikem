/**
 * Telling a payee what happened to their MonCash withdrawal.
 *
 * ONE function for every writer that settles a `withdrawal_requests` row — the
 * organizer withdraw route, the promoter wallet, the admin approve/complete/
 * reject endpoint and the reconciliation cron — so the copy, the language and
 * the dedupe can never drift between them.
 *
 * - Transactional (policy category 'payout'): it is about the recipient's own
 *   money, so it ignores quiet hours and marketing opt-outs.
 * - Three channels: in-app (lib/notifications/helpers.createNotification), push
 *   (lib/notification-triggers.sendPushNotification — the PUSH module; the
 *   same-named helpers module only writes the bell entry) and email (Resend via
 *   lib/email.sendEmail). Each is best-effort; none throws.
 * - Deduped per (withdrawalId, outcome) by claiming
 *   `withdrawal_notices/{withdrawalId}_{outcome}` BEFORE sending (the
 *   reminder-claim convention): a cron retry or a double admin click says it once.
 * - Localized en/fr/ht from the recipient's saved `users/{uid}.language`.
 */
import { adminDb } from '@/lib/firebase/admin'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'
import { isTransactional } from '@/lib/notifications/policy'
import { escapeHtml, sendEmail } from '@/lib/email'
import { intlLocaleFor } from '@/lib/dateLocale'

export type WithdrawalOutcome =
  /** Instant transfer confirmed (synchronously or by the reconcile cron). */
  | 'completed'
  /** Manual request filed; waiting for admin review. */
  | 'submitted'
  /** Transfer sent but not yet confirmed by MonCash; money held. */
  | 'confirming'
  /** Transfer failed; reservation returned to the balance. */
  | 'failed'
  /** Admin approved a manual request and is paying it. */
  | 'approved'
  /** Admin marked a manual request paid. */
  | 'admin_completed'
  /** Admin declined a request; money returned to the balance. */
  | 'admin_rejected'

export const WITHDRAWAL_NOTICES_COLLECTION = 'withdrawal_notices'

/**
 * The policy category every send here is filed under. It must stay
 * transactional (no quiet hours, no opt-out) — asserted in the tests, so a
 * future edit that makes it discretionary fails there rather than silently
 * suppressing payout notices.
 */
export const WITHDRAWAL_NOTIFICATION_CATEGORY = 'payout' as const
export const withdrawalNoticesAreTransactional = () => isTransactional(WITHDRAWAL_NOTIFICATION_CATEGORY)

type Lang = 'en' | 'fr' | 'ht'

function langOf(raw: unknown): Lang {
  const code = String(raw || 'en').slice(0, 2).toLowerCase()
  return code === 'fr' || code === 'ht' ? code : 'en'
}

/** "1,234.50 HTG" / "1 234,50 HTG" — minor units in, the currency code after. */
export function formatWithdrawalAmount(minor: number, currency: string, lang: string): string {
  const cents = Math.max(0, Math.round(Number(minor) || 0))
  const hasFraction = cents % 100 !== 0
  const n = new Intl.NumberFormat(intlLocaleFor(lang), {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(cents / 100)
  return `${n} ${String(currency || 'HTG').toUpperCase()}`
}

function maskPhone(raw: unknown): string {
  const digits = String(raw ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : ''
}

type Copy = { title: string; body: string; cta: string }

const CTA: Record<Lang, string> = { en: 'View payouts', fr: 'Voir mes paiements', ht: 'Wè peman yo' }

function reasonSuffix(lang: Lang, reason: string | null): string {
  if (!reason) return ''
  if (lang === 'fr') return ` Motif : ${reason}`
  if (lang === 'ht') return ` Rezon: ${reason}`
  return ` Reason: ${reason}`
}

/** Pure copy table, exported for tests. */
export function withdrawalOutcomeCopy(
  outcome: WithdrawalOutcome,
  lang: Lang,
  v: { amount: string; phone: string; reason: string | null }
): Copy {
  const to = (en: string, fr: string, ht: string) => ({ en, fr, ht })[lang]
  const phone = v.phone ? ` (${v.phone})` : ''
  const cta = CTA[lang]
  switch (outcome) {
    case 'completed':
      return {
        title: to('Withdrawal sent', 'Retrait envoyé', 'Retrè voye'),
        body: to(
          `${v.amount} was sent to your MonCash${phone}.`,
          `${v.amount} a été envoyé sur votre MonCash${phone}.`,
          `Nou voye ${v.amount} sou MonCash ou${phone}.`
        ),
        cta,
      }
    case 'submitted':
      return {
        title: to('Withdrawal request received', 'Demande de retrait reçue', 'Nou resevwa demann retrè a'),
        body: to(
          `Your request for ${v.amount} to MonCash is in review. We'll let you know when it's paid.`,
          `Votre demande de ${v.amount} vers MonCash est en cours d'examen. Nous vous préviendrons dès qu'elle sera payée.`,
          `Demann ${v.amount} pou MonCash ou an ap revize. N ap fè w konnen lè li peye.`
        ),
        cta,
      }
    case 'confirming':
      return {
        title: to('Confirming your withdrawal', 'Confirmation de votre retrait', 'N ap konfime retrè w la'),
        body: to(
          `Your ${v.amount} MonCash withdrawal was sent and we're confirming it with MonCash. Please don't resubmit — the money is held for you.`,
          `Votre retrait MonCash de ${v.amount} a été envoyé et nous le confirmons avec MonCash. Ne le soumettez pas à nouveau — le montant reste réservé.`,
          `Retrè MonCash ${v.amount} ou a pati, n ap konfime l ak MonCash. Pa refè demann lan — lajan an rete rezève pou ou.`
        ),
        cta,
      }
    case 'failed':
      return {
        title: to("Withdrawal didn't go through", "Le retrait n'a pas abouti", 'Retrè a pa pase'),
        body: to(
          `Your ${v.amount} MonCash withdrawal failed and the money is back in your balance. You can try again.`,
          `Votre retrait MonCash de ${v.amount} a échoué et le montant a été remis sur votre solde. Vous pouvez réessayer.`,
          `Retrè MonCash ${v.amount} ou a pa pase, lajan an retounen nan balans ou. Ou ka eseye ankò.`
        ),
        cta,
      }
    case 'approved':
      return {
        title: to('Withdrawal approved', 'Retrait approuvé', 'Retrè apwouve'),
        body: to(
          `Your ${v.amount} MonCash withdrawal was approved and is being paid.`,
          `Votre retrait MonCash de ${v.amount} a été approuvé et est en cours de paiement.`,
          `Yo apwouve retrè MonCash ${v.amount} ou a, y ap peye l kounye a.`
        ),
        cta,
      }
    case 'admin_completed':
      return {
        title: to('Withdrawal paid', 'Retrait payé', 'Retrè peye'),
        body: to(
          `${v.amount} was paid to your MonCash${phone}.`,
          `${v.amount} a été payé sur votre MonCash${phone}.`,
          `Nou peye ${v.amount} sou MonCash ou${phone}.`
        ),
        cta,
      }
    case 'admin_rejected':
      return {
        title: to('Withdrawal declined', 'Retrait refusé', 'Yo refize retrè a'),
        body:
          to(
            `Your ${v.amount} withdrawal request was declined and the money is back in your balance.`,
            `Votre demande de retrait de ${v.amount} a été refusée et le montant a été remis sur votre solde.`,
            `Yo refize demann retrè ${v.amount} ou a, lajan an retounen nan balans ou.`
          ) + reasonSuffix(lang, v.reason),
        cta,
      }
  }
}

/** Claim the right to send this outcome for this withdrawal. Fails CLOSED. */
export async function claimWithdrawalNotice(withdrawalId: string, key: string, now = new Date()): Promise<boolean> {
  const ref = adminDb.collection(WITHDRAWAL_NOTICES_COLLECTION).doc(`${withdrawalId}_${key}`)
  try {
    return await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref)
      if (snap.exists) return false
      tx.set(ref, { withdrawalId, outcome: key, claimedAt: now })
      return true
    })
  } catch (err) {
    console.error('[withdrawal-outcome] claim failed; not sending', { withdrawalId, key, err })
    return false
  }
}

function payeeOf(row: any): { uid: string | null; isPromoter: boolean } {
  const isPromoter = row?.payee_type === 'promoter'
  const uid = isPromoter ? row?.promoter_uid || row?.organizerId : row?.organizerId
  return { uid: uid ? String(uid) : null, isPromoter }
}

/** Which figure the payee should see for this outcome. */
function amountFor(outcome: WithdrawalOutcome, row: any, lang: Lang): string {
  const returnedToBalance = outcome === 'failed' || outcome === 'admin_rejected'
  if (!returnedToBalance && Number(row?.payoutAmountHtgCents) > 0) {
    // What lands on their phone — always HTG on this rail, net of any instant fee.
    return formatWithdrawalAmount(Number(row.payoutAmountHtgCents), 'HTG', lang)
  }
  // What goes back into the balance they withdrew from, in that balance's currency.
  return formatWithdrawalAmount(Number(row?.amount) || 0, String(row?.currency || 'HTG'), lang)
}

function emailHtml(copy: Copy, url: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border-collapse:collapse;width:100%;">
<tr><td style="padding:32px 32px 8px;"><div style="font-size:20px;font-weight:800;color:#0f172a;">Tikèm</div></td></tr>
<tr><td style="padding:8px 32px;"><h1 style="margin:0 0 12px;font-size:22px;color:#0f172a;">${escapeHtml(copy.title)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(copy.body)}</p>
<a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 24px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px;">${escapeHtml(copy.cta)}</a></td></tr>
<tr><td style="padding:24px 32px 32px;font-size:12px;color:#94a3b8;">© ${new Date().getFullYear()} Tikèm</td></tr>
</table></body></html>`
}

export type NotifyWithdrawalResult = { sent: boolean; reason?: 'duplicate' | 'no_row' | 'no_payee' | 'error' }

/**
 * Tell the payee about one outcome of one withdrawal. Never throws.
 * Pass `row` when the caller already holds the data; otherwise it is read.
 */
export async function notifyWithdrawalOutcome(
  withdrawalId: string,
  outcome: WithdrawalOutcome,
  opts: { row?: any; reason?: string | null; now?: Date } = {}
): Promise<NotifyWithdrawalResult> {
  try {
    let row = opts.row
    if (!row) {
      const snap = await adminDb.collection('withdrawal_requests').doc(withdrawalId).get()
      if (!snap.exists) return { sent: false, reason: 'no_row' }
      row = snap.data()
    }
    const { uid, isPromoter } = payeeOf(row)
    if (!uid) return { sent: false, reason: 'no_payee' }

    if (!(await claimWithdrawalNotice(withdrawalId, outcome, opts.now))) {
      return { sent: false, reason: 'duplicate' }
    }

    const userSnap = await adminDb.collection('users').doc(uid).get().catch(() => null as any)
    const user = userSnap?.exists ? (userSnap.data() as any) : {}
    const lang = langOf(user?.language)

    const copy = withdrawalOutcomeCopy(outcome, lang, {
      amount: amountFor(outcome, row, lang),
      phone: maskPhone(row?.moncashNumber),
      reason: outcome === 'admin_rejected' && opts.reason ? String(opts.reason) : null,
    })
    const actionUrl = isPromoter ? '/promoter' : '/organizer/payouts'
    const meta = { withdrawalId, outcome, eventId: row?.eventId || undefined }

    try {
      await createNotification(uid, 'withdrawal_update', copy.title, copy.body, actionUrl, stripUndefined(meta))
    } catch (err) {
      console.error('[withdrawal-outcome] in-app notification failed', { withdrawalId, outcome, err })
    }

    try {
      await sendPushNotification(uid, copy.title, copy.body, actionUrl, {
        type: 'withdrawal_update',
        withdrawalId,
        outcome,
      })
    } catch (err) {
      console.error('[withdrawal-outcome] push failed', { withdrawalId, outcome, err })
    }

    const email = typeof user?.email === 'string' ? user.email : null
    if (email) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.tikem.co'
      const result = await sendEmail({ to: email, subject: copy.title, html: emailHtml(copy, `${appUrl}${actionUrl}`) })
      if (!result.success) {
        console.warn('[withdrawal-outcome] email not sent', { withdrawalId, outcome, code: result.code })
      }
    }

    return { sent: true }
  } catch (err) {
    console.error('[withdrawal-outcome] notify failed', { withdrawalId, outcome, err })
    return { sent: false, reason: 'error' }
  }
}

/**
 * Tell every admin, once per withdrawal, that an unconfirmed instant payout
 * could not be settled automatically and needs someone to check MonCash.
 */
export async function notifyAdminsWithdrawalEscalated(
  withdrawalId: string,
  row: any,
  now = new Date()
): Promise<NotifyWithdrawalResult> {
  try {
    if (!(await claimWithdrawalNotice(withdrawalId, 'escalated', now))) return { sent: false, reason: 'duplicate' }

    // Two equality queries rather than `in`, so each is a plain single-field index.
    const snaps = await Promise.all(
      ['admin', 'super_admin'].map((role) => adminDb.collection('users').where('role', '==', role).get())
    )
    const adminIds = Array.from(new Set(snaps.flatMap((s: any) => s.docs.map((d: any) => String(d.id)))))

    const amount = formatWithdrawalAmount(Number(row?.payoutAmountHtgCents || row?.amount) || 0, 'HTG', 'en')
    const who = row?.payee_type === 'promoter' ? 'promoter' : 'organizer'
    const title = 'Instant withdrawal needs manual reconciliation'
    const message = `A ${amount} ${who} MonCash withdrawal (${withdrawalId}) is still unconfirmed after repeated checks. Check MonCash for reference ${withdrawalId}, then complete or fail it.`
    const actionUrl = '/admin/money/withdrawals'

    await Promise.all(
      adminIds.map(async (adminId) => {
        try {
          await createNotification(adminId, 'withdrawal_escalated', title, message, actionUrl, { withdrawalId })
        } catch (err) {
          console.error('[withdrawal-outcome] admin in-app failed', { adminId, err })
        }
        try {
          await sendPushNotification(adminId, title, message, actionUrl, { type: 'withdrawal_escalated', withdrawalId })
        } catch (err) {
          console.error('[withdrawal-outcome] admin push failed', { adminId, err })
        }
      })
    )
    return { sent: adminIds.length > 0 }
  } catch (err) {
    console.error('[withdrawal-outcome] admin escalation notify failed', { withdrawalId, err })
    return { sent: false, reason: 'error' }
  }
}

function stripUndefined<T extends Record<string, any>>(obj: T): T {
  const out: any = {}
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v
  return out
}
