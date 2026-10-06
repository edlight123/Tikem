import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import { Resend } from 'resend'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { escapeHtml } from '@/lib/html'

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
      await resend.emails.send({
        from: 'Tikem <noreply@tikem.co>',
        to: user.email || '',
        subject: 'Verification Request Received',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #0F766E;">Verification Request Received</h1>
            <p>Hello ${escapeHtml(user.user_metadata?.full_name || 'there')},</p>
            <p>We've received your identity verification request for Tikèm.</p>
            <p><strong>What happens next?</strong></p>
            <ul>
              <li>Our team will review your submission within 24-48 hours</li>
              <li>You'll receive an email once your verification is complete</li>
              <li>Once verified, you'll be able to create events</li>
            </ul>
            <p>Thank you for helping us keep Tikèm safe and trustworthy!</p>
            <p style="color: #666; font-size: 12px; margin-top: 40px;">
              If you didn't request this verification, please contact support immediately.
            </p>
          </div>
        `,
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
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #0F766E;">New Verification Request</h1>
            <p>A new organizer verification request has been submitted:</p>
            <ul>
              <li><strong>Name:</strong> ${escapeHtml(user.user_metadata?.full_name || 'N/A')}</li>
              <li><strong>Email:</strong> ${escapeHtml(user.email)}</li>
              <li><strong>Request ID:</strong> ${escapeHtml(verificationRequest.id)}</li>
            </ul>
            <p>
              <a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/admin/trust"
                 style="background-color: #0F766E; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Review Request
              </a>
            </p>
          </div>
        `,
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
