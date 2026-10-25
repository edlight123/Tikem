import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { Resend } from 'resend'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'
import { adminDb, adminStorage } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { renderEmail, title, eyebrow, p, gap, button, timeline, rowsBlock, appUrl } from '@/lib/email-kit/layout'
import type { EmailLang } from '@/lib/email-kit/i18n'
import { resolveEmailLang } from '@/lib/email-kit/recipient'
import { validateStoredSubmission } from '@/lib/kyc/submission'
import { denyIfActingForAnotherOrg } from '@/lib/organizer/ownerOnly'

const resend = new Resend(process.env.RESEND_API_KEY || '')

/**
 * Submit the caller's KYC request for review.
 *
 * The documents reviewed are the ones STORED on verification_requests/{uid}
 * (`files.governmentId.front/back`, `files.selfie.path`), each of which must be
 * a Storage path under verification/{uid}/. Anything else in the body —
 * including the idFrontUrl / idBackUrl / facePhotoUrl older mobile builds still
 * send — is ignored: a client-supplied URL could point at someone else's ID,
 * and a stored permanent download URL is a public link to an identity document.
 *
 * Refused when the request is already approved (re-submitting used to drop an
 * approved organizer back to pending_review and unset is_verified), already
 * awaiting review, or rejected (a rejected request is restarted first through
 * /api/organizer/reset-verification).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Money and identity stay with the org owner (lib/organizer/ownerOnly.ts).
    const notOwner = await denyIfActingForAnotherOrg(user.id)
    if (notOwner) return notOwner

    const body = await request.json().catch(() => ({} as any))
    const userId: string = user.id
    if (body?.userId != null && body.userId !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const verificationRef = adminDb.collection('verification_requests').doc(userId)
    const existing = await verificationRef.get()
    if (!existing.exists) {
      return NextResponse.json(
        { error: 'Start your verification and upload your documents before submitting.', code: 'not_started' },
        { status: 400 }
      )
    }

    const precheck = validateStoredSubmission(existing.data() || {}, userId)
    if (!precheck.ok) return NextResponse.json({ error: precheck.error, code: precheck.code }, { status: precheck.status })

    // The stored paths must name objects that actually exist.
    try {
      const bucket = adminStorage.bucket()
      const found = await Promise.all(precheck.paths.map((path) => bucket.file(path).exists().then((r: any) => Boolean(r?.[0]))))
      if (found.some((ok) => !ok)) {
        return NextResponse.json(
          { error: 'One of your documents is missing. Please upload it again before submitting.', code: 'document_missing' },
          { status: 400 }
        )
      }
    } catch (storageError: any) {
      console.error('[submit-verification] could not confirm stored documents', { message: storageError?.message })
      return NextResponse.json({ error: 'Could not check your documents. Please try again.' }, { status: 503 })
    }

    // Decide and write in one transaction so a concurrent approval, a second
    // submit, or a file edit between the check and the write cannot slip in.
    let outcome: { ok: true } | { ok: false; status: number; error: string; code: string }
    outcome = await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(verificationRef)
      if (!snap.exists) return { ok: false as const, status: 400, error: 'Verification request not found', code: 'not_started' }
      const v = validateStoredSubmission(snap.data() || {}, userId)
      if (!v.ok) return { ok: false as const, status: v.status, error: v.error, code: v.code }
      if (v.paths.join('|') !== precheck.paths.join('|')) {
        return { ok: false as const, status: 409, error: 'Your documents changed while submitting. Please try again.', code: 'documents_changed' }
      }
      tx.update(verificationRef, {
        status: 'pending_review',
        submittedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        reviewedAt: null,
        reviewedBy: null,
        reviewNotes: null,
        reviewed_by: null,
        reviewed_at: null,
        rejection_reason: null,
        userId,
        // Legacy permanent download URLs: never stored again, and removed
        // from requests that still carry them.
        id_front_url: FieldValue.delete(),
        id_back_url: FieldValue.delete(),
        face_photo_url: FieldValue.delete(),
      })
      const nowIso = new Date().toISOString()
      const mirror = { is_verified: false, verification_status: 'pending_review', updated_at: nowIso }
      tx.set(adminDb.collection('users').doc(userId), mirror, { merge: true })
      tx.set(adminDb.collection('organizers').doc(userId), mirror, { merge: true })
      return { ok: true as const }
    })

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error, code: outcome.code }, { status: outcome.status })
    }

    // Create in-app notification
    try {
      await createNotification(
        userId,
        'verification',
        '📝 Verification Submitted',
        'Your verification request has been received. We\'ll review it, usually within 1–2 business days.',
        '/organizer/verify',
        { status: 'pending_review' }
      )

      // Send push notification
      await sendPushNotification(
        userId,
        '📝 Verification Submitted',
        'Your request is under review, usually within 1–2 business days. We\'ll notify you when it\'s done.',
        '/organizer/verify',
        { type: 'verification_submitted' }
      )
    } catch (notificationError) {
      console.error('Error creating notification:', notificationError)
    }

    // Send confirmation email to user
    try {
      const lang = await resolveEmailLang({ userId, email: user.email || null })
      const { subject, html } = verificationReceivedEmail(lang, (user as any).user_metadata?.full_name || (user as any).full_name || null)
      await resend.emails.send({
        from: 'Tikem <noreply@tikem.co>',
        to: user.email || '',
        subject,
        html,
      })
    } catch (emailError) {
      console.error('Error sending confirmation email:', emailError)
      // Don't fail the request if email fails
    }

    // Send notification to admin team
    try {
      await resend.emails.send({
        from: 'Tikem <noreply@tikem.co>',
        to: process.env.ADMIN_EMAIL || 'admin@tikem.co',
        subject: 'New Verification Request',
        html: verificationAdminEmail({
          name: (user as any).user_metadata?.full_name || (user as any).full_name || 'N/A',
          email: user.email || 'N/A',
          requestId: userId,
        }),
      })
    } catch (emailError) {
      console.error('Error sending admin notification:', emailError)
    }

    return NextResponse.json({
      success: true,
      message: 'Verification request submitted successfully',
      requestId: userId,
    })
  } catch (error) {
    console.error('Verification submission error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

const RECEIVED_COPY: Record<
  EmailLang,
  {
    subject: string
    status: string
    head: string
    hello: (name: string | null) => string
    body: string
    steps: [string, string, string]
    review: string
    cta: string
    notYou: string
  }
> = {
  en: {
    subject: 'Verification request received',
    status: 'In review',
    head: 'We got your verification request',
    hello: (n) => (n ? `Hi ${n},` : 'Hi,'),
    body: 'Thanks for sending your ID. Our team checks every request by hand, and we will email you as soon as yours is done.',
    steps: ['Request received', 'Review by our team', 'Verified: you can withdraw your earnings'],
    review: 'usually within 1–2 business days',
    cta: 'See verification status',
    notYou: 'If you did not submit this request, contact Tikèm support right away.',
  },
  fr: {
    subject: 'Demande de vérification reçue',
    status: 'En cours',
    head: 'Nous avons bien reçu votre demande de vérification',
    hello: (n) => (n ? `Bonjour ${n},` : 'Bonjour,'),
    body: "Merci d'avoir envoyé votre pièce d'identité. Notre équipe examine chaque demande une par une, et nous vous écrirons dès que la vôtre sera traitée.",
    steps: ['Demande reçue', 'Examen par notre équipe', 'Vérifié : vous pouvez retirer vos gains'],
    review: 'généralement sous 1 à 2 jours ouvrables',
    cta: 'Voir le statut de la vérification',
    notYou: "Si vous n'avez pas envoyé cette demande, contactez le support Tikèm sans attendre.",
  },
  ht: {
    subject: 'Nou resevwa demann verifikasyon ou',
    status: 'An revizyon',
    head: 'Nou resevwa demann verifikasyon ou',
    hello: (n) => (n ? `Bonjou ${n},` : 'Bonjou,'),
    body: 'Mèsi paske ou voye pyès idantite ou. Ekip nou an gade chak demann youn pa youn, epi n ap ekri ou depi pa ou la fini.',
    steps: ['Nou resevwa demann lan', 'Ekip nou an ap revize l', 'Verifye: ou ka retire lajan w'],
    review: 'anjeneral nan 1 a 2 jou ouvrab',
    cta: 'Wè kote verifikasyon an ye',
    notYou: 'Si se pa ou ki voye demann sa a, kontakte sipò Tikèm touswit.',
  },
}

function verificationReceivedEmail(lang: EmailLang, name: string | null): { subject: string; html: string } {
  const t = RECEIVED_COPY[lang]
  return {
    subject: t.subject,
    html: renderEmail({
      lang,
      title: t.head,
      preheader: t.body,
      status: { label: t.status, tone: 'grey' },
      footer: 'organizer',
      blocks: [
        title(t.head, 34),
        gap(14),
        p(t.hello(name)),
        p(t.body),
        gap(8),
        timeline([
          { label: t.steps[0], done: true },
          { label: t.steps[1], detail: t.review },
          { label: t.steps[2] },
        ]),
        gap(28),
        button(t.cta, `${appUrl()}/organizer/verify`),
        gap(24),
        p(t.notYou),
      ],
    }),
  }
}

/** Admin-only, so English. */
function verificationAdminEmail(v: { name: string; email: string; requestId: string }): string {
  return renderEmail({
    lang: 'en',
    title: 'New verification request',
    preheader: `${v.name} submitted an identity verification request.`,
    status: { label: 'Needs review', tone: 'amber' },
    footer: 'account',
    blocks: [
      eyebrow('Organizer verification'),
      title('New verification request', 34),
      gap(14),
      p('An organizer submitted their ID and selfie for review.'),
      gap(4),
      rowsBlock([
        { label: 'Name', value: v.name },
        { label: 'Email', value: v.email },
        { label: 'Request', value: v.requestId, mono: true },
      ]),
      gap(24),
      button('Review request', `${appUrl()}/admin/trust`),
    ],
  })
}
