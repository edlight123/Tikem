import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import { Resend } from 'resend'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { renderEmail, title, eyebrow, p, gap, button, timeline, rowsBlock, appUrl } from '@/lib/email-kit/layout'
import type { EmailLang } from '@/lib/email-kit/i18n'
import { resolveEmailLang } from '@/lib/email-kit/recipient'

const resend = new Resend(process.env.RESEND_API_KEY || '')

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { userId, idFrontUrl, idBackUrl, facePhotoUrl } = await request.json()

    if (userId !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    if (!idFrontUrl || !idBackUrl || !facePhotoUrl) {
      return NextResponse.json(
        { error: 'Missing verification images' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Create verification request with Firebase Storage URLs
    // Use userId as document ID for consistency with Firestore structure
    const { data: verificationRequest, error: requestError } = await supabase
      .from('verification_requests')
      .upsert({
        id: userId,
        userId: userId,
        id_front_url: idFrontUrl,
        id_back_url: idBackUrl,
        face_photo_url: facePhotoUrl,
        status: 'pending_review',
      })
      .select()
      .single()

    if (requestError) {
      console.error('Error creating verification request:', requestError)
      return NextResponse.json(
        { error: 'Failed to create verification request' },
        { status: 500 }
      )
    }

    // Update user verification status to pending
    const { error: updateError } = await supabase
      .from('users')
      .update({ verification_status: 'pending_review' })
      .eq('id', userId)

    if (updateError) {
      console.error('Error updating user status:', updateError)
    }

    // Mirror submission into Firestore so the admin review UI can reliably render
    // sections + proof (older flows used a SQL upsert + public URLs only).
    try {
      const verificationRef = adminDb.collection('verification_requests').doc(userId)
      const existing = await verificationRef.get()
      const now = new Date()

      const hasStructuredSteps = existing.exists && (existing.data() as any)?.steps

      if (!hasStructuredSteps) {
        await verificationRef.set(
          {
            userId,
            status: 'pending_review',
            submittedAt: FieldValue.serverTimestamp(),
            reviewedAt: null,
            reviewed_by: null,
            reviewed_at: null,
            rejection_reason: null,
            reviewNotes: null,
            createdAt: existing.exists ? (existing.data() as any)?.createdAt || now : now,
            updatedAt: FieldValue.serverTimestamp(),
            // Legacy flat URLs (still supported)
            id_front_url: idFrontUrl,
            id_back_url: idBackUrl,
            face_photo_url: facePhotoUrl,
            // New structured schema expected by the premium verification UI
            steps: {
              organizerInfo: {
                id: 'organizerInfo',
                title: 'Organizer Information',
                description: 'Basic information about you and your organization',
                status: 'incomplete',
                required: true,
                fields: {},
                missingFields: ['full_name', 'phone', 'organization_name'],
              },
              governmentId: {
                id: 'governmentId',
                title: 'Government ID Upload',
                description: 'Upload a valid government-issued ID (front and back)',
                status: 'complete',
                required: true,
                fields: {},
                missingFields: [],
              },
              selfie: {
                id: 'selfie',
                title: 'Identity Verification',
                description: 'Take a selfie holding your ID for verification',
                status: 'complete',
                required: true,
                fields: {},
              },
              businessDetails: {
                id: 'businessDetails',
                title: 'Business Details',
                description: 'Optional business registration and tax information',
                status: 'incomplete',
                required: false,
                fields: {},
              },
              payoutSetup: {
                id: 'payoutSetup',
                title: 'Payout Setup',
                description: 'Configure how you receive payments (can be set up later)',
                status: 'incomplete',
                required: false,
                fields: {},
              },
            },
            files: {
              governmentId: {
                // For this legacy flow these are public URLs, but the admin UI
                // can still display them (it supports URL-or-path).
                front: idFrontUrl,
                back: idBackUrl,
                uploadedAt: now,
              },
              selfie: {
                path: facePhotoUrl,
                uploadedAt: now,
              },
            },
          },
          { merge: true }
        )
      } else {
        // Keep existing structured payload, but ensure admin can still see proof + timing.
        await verificationRef.set(
          {
            status: 'pending_review',
            submittedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            id_front_url: idFrontUrl,
            id_back_url: idBackUrl,
            face_photo_url: facePhotoUrl,
          },
          { merge: true }
        )
      }

      // Keep Firestore user/organizer docs in sync for flows that read from Firestore.
      const nowIso = new Date().toISOString()
      await adminDb.collection('users').doc(userId).set(
        {
          is_verified: false,
          verification_status: 'pending_review',
          updated_at: nowIso,
        },
        { merge: true }
      )
      await adminDb.collection('organizers').doc(userId).set(
        {
          is_verified: false,
          verification_status: 'pending_review',
          updated_at: nowIso,
        },
        { merge: true }
      )
    } catch (firestoreError) {
      console.error('Error mirroring verification request into Firestore:', firestoreError)
      // Non-fatal: the primary submission is already stored.
    }

    // Create in-app notification
    try {
      await createNotification(
        userId,
        'verification',
        '📝 Verification Submitted',
        'Your verification request has been received. We\'ll review it within 24-48 hours.',
        '/organizer/verify',
        { status: 'pending_review' }
      )

      // Send push notification
      await sendPushNotification(
        userId,
        '📝 Verification Submitted',
        'Your request is under review. We\'ll notify you within 24-48 hours.',
        '/organizer/verify',
        { type: 'verification_submitted' }
      )
    } catch (notificationError) {
      console.error('Error creating notification:', notificationError)
    }

    // Send confirmation email to user
    try {
      const lang = await resolveEmailLang({ userId, email: user.email || null })
      const { subject, html } = verificationReceivedEmail(lang, user.user_metadata?.full_name || null)
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
          name: user.user_metadata?.full_name || 'N/A',
          email: user.email || 'N/A',
          requestId: String(verificationRequest.id),
        }),
      })
    } catch (emailError) {
      console.error('Error sending admin notification:', emailError)
    }

    return NextResponse.json({
      success: true,
      message: 'Verification request submitted successfully',
      requestId: verificationRequest.id,
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
    steps: ['Request received', 'Review by our team', 'Verified: you can publish events'],
    review: 'usually within 24 to 48 hours',
    cta: 'See verification status',
    notYou: 'If you did not submit this request, contact Tikèm support right away.',
  },
  fr: {
    subject: 'Demande de vérification reçue',
    status: 'En cours',
    head: 'Nous avons bien reçu votre demande de vérification',
    hello: (n) => (n ? `Bonjour ${n},` : 'Bonjour,'),
    body: "Merci d'avoir envoyé votre pièce d'identité. Notre équipe examine chaque demande une par une, et nous vous écrirons dès que la vôtre sera traitée.",
    steps: ['Demande reçue', 'Examen par notre équipe', 'Vérifié : vous pouvez publier des événements'],
    review: 'généralement sous 24 à 48 heures',
    cta: 'Voir le statut de la vérification',
    notYou: "Si vous n'avez pas envoyé cette demande, contactez le support Tikèm sans attendre.",
  },
  ht: {
    subject: 'Nou resevwa demann verifikasyon ou',
    status: 'An revizyon',
    head: 'Nou resevwa demann verifikasyon ou',
    hello: (n) => (n ? `Bonjou ${n},` : 'Bonjou,'),
    body: 'Mèsi paske ou voye pyès idantite ou. Ekip nou an gade chak demann youn pa youn, epi n ap ekri ou depi pa ou la fini.',
    steps: ['Nou resevwa demann lan', 'Ekip nou an ap revize l', 'Verifye: ou ka pibliye evènman'],
    review: 'anjeneral nan 24 a 48 èdtan',
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
