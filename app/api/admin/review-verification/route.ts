import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { Resend } from 'resend'
import { adminDb } from '@/lib/firebase/admin'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'
import { FieldValue } from 'firebase-admin/firestore'
import { logAdminAction } from '@/lib/admin/audit-log'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { renderEmail, title, eyebrow, p, gap, button, lines, quote, serifHeading, appUrl } from '@/lib/email-kit/layout'
import type { EmailLang } from '@/lib/email-kit/i18n'
import { resolveEmailLang } from '@/lib/email-kit/recipient'

/** A request can only be decided while it is awaiting review. */
const REVIEWABLE_STATUSES = new Set(['pending', 'pending_review', 'in_review', 'in_progress'])

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAdmin()

    // Only allow admin users
    if (error || !user) {
      return adminError(error || 'Unauthorized', 401)
    }

    const { requestId, status, rejectionReason } = await request.json()

    console.log(`[review-verification] Received: requestId=${requestId}, status=${status}`)

    if (
      typeof requestId !== 'string' ||
      !requestId ||
      !status ||
      !['approved', 'rejected', 'changes_requested'].includes(status) ||
      (rejectionReason != null && typeof rejectionReason !== 'string')
    ) {
      return adminError('Invalid request data', 400)
    }

    // Map the legacy UI "rejected" action to the newer, resubmittable state.
    const normalizedStatus = status === 'rejected' ? 'changes_requested' : status
    console.log(`[review-verification] Normalized status: ${normalizedStatus}`)

    // Read and decide in one transaction, and only from an awaiting-review
    // state. Without this guard a second click (or a stale tab) could flip an
    // already-approved organizer back to changes_requested, or approve a
    // request the organizer has since withdrawn/reset.
    const verificationRef = adminDb.collection('verification_requests').doc(requestId)
    let verificationRequest: any
    try {
      verificationRequest = await adminDb.runTransaction(async (tx: any) => {
        const snap = await tx.get(verificationRef)
        if (!snap.exists) {
          throw Object.assign(new Error('not_found'), { code: 404 })
        }
        const data = snap.data() || {}
        const current = String(data.status || '').toLowerCase()
        if (!REVIEWABLE_STATUSES.has(current)) {
          throw Object.assign(new Error(`not_reviewable:${current || 'unknown'}`), { code: 409 })
        }
        const reason = typeof rejectionReason === 'string' ? rejectionReason.slice(0, 2000) : null
        tx.update(verificationRef, {
          status: normalizedStatus,
          // New/canonical fields
          reviewedBy: user.id,
          reviewedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          reviewNotes: normalizedStatus !== 'approved' ? reason : null,
          // Legacy fields (kept for older screens/backfills)
          reviewed_by: user.id,
          reviewed_at: new Date(),
          updated_at: new Date(),
          rejection_reason: normalizedStatus !== 'approved' ? reason : null,
        })
        return data
      })
    } catch (txError: any) {
      if (txError?.code === 404) return adminError('Verification request not found', 404)
      if (txError?.code === 409) {
        return adminError('This request has already been reviewed or is not awaiting review', 409)
      }
      throw txError
    }

    // Verify the update was successful by reading back
    const updatedDoc = await verificationRef.get()
    const updatedStatus = updatedDoc.data()?.status
    console.log(`[review-verification] Updated request ${requestId}: status is now '${updatedStatus}'`)

    if (updatedStatus !== normalizedStatus) {
      console.error(`[review-verification] WARNING: Status mismatch! Expected '${normalizedStatus}' but got '${updatedStatus}'`)
    }

    // Update user verification status
    // Handle both old format (user_id) and new format (userId or document ID)
    const userId = verificationRequest.userId || verificationRequest.user_id || requestId
    const nowIso = new Date().toISOString()

    try {
      // Keep the user/organizer docs in sync without overwriting unrelated fields.
      const approved = normalizedStatus === 'approved'
      const userVerificationStatus = normalizedStatus

      await adminDb.collection('users').doc(userId).set(
        {
          is_verified: approved,
          verification_status: userVerificationStatus,
          updated_at: nowIso,
        },
        { merge: true }
      )

      await adminDb.collection('organizers').doc(userId).set(
        {
          is_verified: approved,
          verification_status: userVerificationStatus,
          updated_at: nowIso,
        },
        { merge: true }
      )
    } catch (err) {
      console.error('Error updating user via Admin SDK:', err)
      return adminError('Failed to update user status', 500)
    }

    // Fetch user details for notifications/emails.
    const organizerDoc = await adminDb.collection('users').doc(userId).get()
    const organizer = organizerDoc.exists ? organizerDoc.data() : null

    // Create in-app notification and send push
    try {
      if (normalizedStatus === 'approved') {
        await createNotification(
          userId,
          'verification',
          '✅ Verification Approved!',
          'Congratulations! Your Tikèm account has been verified. You can now create and publish events.',
          '/organizer/verify',
          { status: 'approved' }
        )

        // Send push notification for approval
        await sendPushNotification(
          userId,
          '✅ You\'re Verified!',
          'Your account is now verified. Start creating events!',
          '/organizer/events/new',
          { type: 'verification_approved' }
        )
      } else {
        const message = rejectionReason 
          ? `Your verification was not approved. Reason: ${rejectionReason}. You can resubmit your application from the verification page.`
          : 'Your verification was not approved. You can resubmit your application from the verification page.'
        
        await createNotification(
          userId,
          'verification',
          'Verification Update',
          message,
          '/organizer/verify',
          { status: normalizedStatus, reason: rejectionReason }
        )

        // Send push notification for rejection
        await sendPushNotification(
          userId,
          'Verification Update',
          'Your verification needs attention. Please review and resubmit.',
          '/organizer/verify',
          { type: normalizedStatus === 'changes_requested' ? 'verification_changes_requested' : 'verification_rejected' }
        )
      }
    } catch (notificationError) {
      console.error('Error creating in-app notification:', notificationError)
    }

    // Send notification email to organizer
    if ((organizer as any)?.email && resend) {
      try {
        const lang = await resolveEmailLang({ userId, email: (organizer as any).email })
        const { subject, html } = verificationDecisionEmail(lang, {
          approved: normalizedStatus === 'approved',
          name: (organizer as any).full_name || null,
          reason: typeof rejectionReason === 'string' ? rejectionReason : null,
        })
        await resend.emails.send({
          from: 'Tikem <noreply@tikem.co>',
          to: (organizer as any).email,
          subject,
          html,
        })
      } catch (emailError) {
        console.error('Error sending notification email:', emailError)
      }
    }

    await logAdminAction({
      action: normalizedStatus === 'approved' ? 'verification.approve' : 'verification.reject',
      adminId: user.id,
      adminEmail: user.email || 'unknown',
      resourceId: requestId,
      resourceType: 'verification_request',
      details: {
        requestId,
        userId,
        status: normalizedStatus,
        reason: rejectionReason || null,
        userEmail: (organizer as any)?.email || null,
        userName: (organizer as any)?.full_name || null,
      },
    })

    return adminOk({
      message: `Verification ${normalizedStatus}`,
    })
  } catch (error) {
    console.error('Review verification error:', error)
    return adminError('Internal server error', 500)
  }
}


const DECISION_COPY: Record<
  EmailLang,
  {
    hello: (name: string | null) => string
    okSubject: string
    okStatus: string
    okHead: string
    okBody: string
    okLines: string[]
    okCta: string
    noSubject: string
    noStatus: string
    noHead: string
    noBody: string
    reason: string
    tipsHead: string
    tips: string[]
    noCta: string
  }
> = {
  en: {
    hello: (n) => (n ? `Hi ${n},` : 'Hi,'),
    okSubject: 'Your Tikèm account is verified',
    okStatus: 'Verified',
    okHead: 'Your account is verified',
    okBody: 'We checked your ID and approved your verification. Here is what is open to you now.',
    okLines: ['Create and publish events', 'Show a verified badge on your events', 'Use every organizer tool'],
    okCta: 'Create an event',
    noSubject: 'Tikèm verification update',
    noStatus: 'Action needed',
    noHead: 'We could not approve your verification yet',
    noBody: 'Something in your submission kept us from approving it. You can send a new request at any time.',
    reason: 'Reason',
    tipsHead: 'for your next try',
    tips: ['Take clear, well-lit photos', 'Make sure all the text on your ID can be read', 'Keep your face fully visible in the selfie'],
    noCta: 'Submit again',
  },
  fr: {
    hello: (n) => (n ? `Bonjour ${n},` : 'Bonjour,'),
    okSubject: 'Votre compte Tikèm est vérifié',
    okStatus: 'Vérifié',
    okHead: 'Votre compte est vérifié',
    okBody: "Nous avons examiné votre pièce d'identité et approuvé votre vérification. Voici ce que vous pouvez faire dès maintenant.",
    okLines: ['Créer et publier des événements', 'Afficher un badge vérifié sur vos événements', 'Utiliser tous les outils organisateur'],
    okCta: 'Créer un événement',
    noSubject: 'Mise à jour de votre vérification Tikèm',
    noStatus: 'Action requise',
    noHead: "Nous n'avons pas encore pu approuver votre vérification",
    noBody: "Un élément de votre dossier nous a empêchés de l'approuver. Vous pouvez envoyer une nouvelle demande à tout moment.",
    reason: 'Motif',
    tipsHead: 'pour votre prochaine demande',
    tips: [
      'Prenez des photos nettes et bien éclairées',
      "Vérifiez que tout le texte de votre pièce d'identité est lisible",
      'Gardez votre visage entièrement visible sur le selfie',
    ],
    noCta: 'Envoyer une nouvelle demande',
  },
  ht: {
    hello: (n) => (n ? `Bonjou ${n},` : 'Bonjou,'),
    okSubject: 'Kont Tikèm ou verifye',
    okStatus: 'Verifye',
    okHead: 'Kont ou verifye',
    okBody: 'Nou gade pyès idantite ou epi nou apwouve verifikasyon ou. Men sa ou ka fè kounye a.',
    okLines: ['Kreye epi pibliye evènman', 'Montre yon badj verifye sou evènman ou yo', 'Sèvi ak tout zouti òganizatè yo'],
    okCta: 'Kreye yon evènman',
    noSubject: 'Nouvèl sou verifikasyon Tikèm ou',
    noStatus: 'Aksyon nesesè',
    noHead: 'Nou poko ka apwouve verifikasyon ou',
    noBody: 'Gen yon bagay nan dosye ou a ki anpeche nou apwouve l. Ou ka voye yon nouvo demann nenpòt lè.',
    reason: 'Rezon',
    tipsHead: 'pou pwochen fwa a',
    tips: [
      'Pran foto ki klè, ak bon limyè',
      'Asire w tout ekriti ki sou pyès idantite a ka li',
      'Kite figi ou parèt nèt nan selfi a',
    ],
    noCta: 'Voye l ankò',
  },
}

function verificationDecisionEmail(
  lang: EmailLang,
  v: { approved: boolean; name: string | null; reason: string | null }
): { subject: string; html: string } {
  const t = DECISION_COPY[lang]
  const base = appUrl()
  if (v.approved) {
    return {
      subject: t.okSubject,
      html: renderEmail({
        lang,
        title: t.okHead,
        preheader: t.okBody,
        status: { label: t.okStatus, tone: 'teal' },
        footer: 'organizer',
        blocks: [
          title(t.okHead, 34),
          gap(14),
          p(t.hello(v.name)),
          p(t.okBody),
          gap(4),
          lines(t.okLines),
          gap(20),
          button(t.okCta, `${base}/organizer/events/new`),
        ],
      }),
    }
  }
  return {
    subject: t.noSubject,
    html: renderEmail({
      lang,
      title: t.noHead,
      preheader: t.noBody,
      status: { label: t.noStatus, tone: 'amber' },
      footer: 'organizer',
      blocks: [
        title(t.noHead, 34),
        gap(14),
        p(t.hello(v.name)),
        p(t.noBody),
        v.reason ? gap(4) : '',
        v.reason ? quote(t.reason, v.reason) : '',
        gap(28),
        serifHeading(t.tipsHead),
        lines(t.tips),
        gap(20),
        button(t.noCta, `${base}/organizer/verify`),
      ],
    }),
  }
}
