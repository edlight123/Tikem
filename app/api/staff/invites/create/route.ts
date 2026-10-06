import { NextRequest, NextResponse, after } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { sendEmail } from '@/lib/email'
import { escapeHtml } from '@/lib/html'
import { clientIp, consumeRateLimit } from '@/lib/rate-limit'
import { sendSms } from '@/lib/sms'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'
import {
  assertEventOwner,
  expiresIn48h,
  InviteMethod,
  inviteDeepLinkFor,
  inviteUrlFor,
  normalizePermissions,
  randomToken,
  sha256Hex,
  serverTimestamp,
} from '@/app/api/staff/_utils'

async function resolveExistingUserId(params: {
  method: InviteMethod
  targetEmail?: string
  targetPhone?: string
}): Promise<string | null> {
  const { method, targetEmail, targetPhone } = params

  if (method === 'email' && targetEmail) {
    // Prefer Auth lookup.
    try {
      const record = await adminAuth.getUserByEmail(targetEmail)
      if (record?.uid) return record.uid
    } catch {
      // fall through
    }

    // Fallback to users collection.
    try {
      const snap = await adminDb.collection('users').where('email', '==', targetEmail).limit(1).get()
      if (!snap.empty) return snap.docs[0].id
    } catch {
      // ignore
    }
  }

  if (method === 'phone' && targetPhone) {
    const raw = String(targetPhone).trim()
    const digits = raw.replace(/[^0-9]/g, '')

    // Try a few common representations (raw, E.164-ish Haiti).
    const candidates = Array.from(
      new Set(
        [
          raw,
          digits,
          digits.length === 8 ? `+509${digits}` : null,
          digits.length === 11 && digits.startsWith('509') ? `+${digits}` : null,
          raw.startsWith('+') ? raw : null,
        ].filter(Boolean) as string[]
      )
    )

    for (const candidate of candidates) {
      try {
        const record = await adminAuth.getUserByPhoneNumber(candidate)
        if (record?.uid) return record.uid
      } catch {
        // try next
      }
    }

    // Fallback to users collection.
    try {
      const phoneCandidates = Array.from(new Set([raw, digits, ...candidates]))
      for (const phone of phoneCandidates) {
        const snap = await adminDb.collection('users').where('phone_number', '==', phone).limit(1).get()
        if (!snap.empty) return snap.docs[0].id
      }
    } catch {
      // ignore
    }
  }

  return null
}

function normalizeInvitePhoneE164(rawPhone: string): string | null {
  const raw = String(rawPhone || '').trim()
  if (!raw) return null
  if (raw.startsWith('+')) return raw

  const digits = raw.replace(/[^0-9]/g, '')
  if (!digits) return null

  // Haiti local numbers are often 8 digits.
  if (digits.length === 8) return `+509${digits}`
  // Already has country code.
  if (digits.length === 11 && digits.startsWith('509')) return `+${digits}`
  // Fallback: best-effort, prefix '+' if it looks like E.164.
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`
  return null
}

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAuth()
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.role !== 'organizer' && user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const eventId = String(body?.eventId || '')
    const method = String(body?.method || '') as InviteMethod
    const targetEmail = body?.targetEmail ? String(body.targetEmail).toLowerCase() : undefined
    const targetPhone = body?.targetPhone ? String(body.targetPhone) : undefined

    if (!eventId) return NextResponse.json({ error: 'eventId is required' }, { status: 400 })
    if (method !== 'email' && method !== 'phone' && method !== 'link') {
      return NextResponse.json({ error: 'Invalid method' }, { status: 400 })
    }
    if (method === 'email' && !targetEmail) {
      return NextResponse.json({ error: 'targetEmail is required for email invites' }, { status: 400 })
    }
    if (method === 'phone' && !targetPhone) {
      return NextResponse.json({ error: 'targetPhone is required for phone invites' }, { status: 400 })
    }

    if (user.role !== 'admin') {
      await assertEventOwner({ eventId, uid: user.id })
    }

    // Each email/phone invite sends a message to an address the caller typed.
    // Without limits this route is an open relay for Tikèm-branded email/SMS
    // (and SMS costs money). Limit per caller, per IP, and per recipient.
    const HOUR = 60 * 60 * 1000
    const contactKey =
      method === 'email' ? targetEmail : method === 'phone' ? normalizeInvitePhoneE164(targetPhone || '') || targetPhone : null
    const checks = await Promise.all([
      consumeRateLimit({ key: `staff-invite:uid:${user.id}`, limit: 30, windowMs: HOUR }),
      consumeRateLimit({ key: `staff-invite:ip:${clientIp(request)}`, limit: 60, windowMs: HOUR }),
      contactKey
        ? consumeRateLimit({ key: `staff-invite:contact:${contactKey}`, limit: 5, windowMs: 24 * HOUR })
        : Promise.resolve({ limited: false }),
    ])
    if (checks.some((c) => c.limited)) {
      return NextResponse.json({ error: 'Too many invites. Please try again later.' }, { status: 429 })
    }

    const token = randomToken(32)
    const tokenHash = sha256Hex(token)

    const expiresAt = expiresIn48h()
    const inviteRef = adminDb.collection('events').doc(eventId).collection('invites').doc()

    await inviteRef.set({
      tokenHash,
      method,
      targetEmail: method === 'email' ? targetEmail : null,
      targetPhone: method === 'phone' ? targetPhone : null,
      role: 'staff',
      permissions: normalizePermissions(body?.permissions),
      expiresAt,
      revokedAt: null,
      usedAt: null,
      usedBy: null,
      createdAt: serverTimestamp(),
      createdBy: user.id,
    })

    const inviteUrl = inviteUrlFor(eventId, token)
    const inviteDeepLink = inviteDeepLinkFor(eventId, token)

    // Delivery (email/SMS/notification/push) runs after the response is sent:
    // the caller's latency no longer reveals whether the contact is an existing
    // account, and a slow provider cannot time the request out.
    after(async () => {
      // Always send delivery message for email/phone invites.
      if (method === 'email' && targetEmail) {
        try {
          const eventSnap = await adminDb.collection('events').doc(eventId).get()
          const eventTitle = eventSnap.exists
            ? String((eventSnap.data() as any)?.title || (eventSnap.data() as any)?.name || 'an event')
            : 'an event'

          const subject = `You're invited to be staff: ${eventTitle.replace(/[\r\n]+/g, ' ')}`
          const html = `
            <!doctype html>
            <html>
              <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
                <h2>Tikèm staff invitation</h2>
                <p>You have been invited to join <strong>${escapeHtml(eventTitle)}</strong> as staff.</p>
                <p><a href="${escapeHtml(inviteDeepLink)}">Open in the Tikèm app</a></p>
                <p><a href="${escapeHtml(inviteUrl)}">Accept your invite</a></p>
                <p style="color:#6b7280;font-size:12px;">This invite expires in 48 hours.</p>
              </body>
            </html>
          `.trim()

          await sendEmail({ to: targetEmail, subject, html })
        } catch (emailError) {
          console.error('Failed to send staff invite email:', emailError)
        }
      }

      if (method === 'phone' && targetPhone) {
        try {
          const to = normalizeInvitePhoneE164(targetPhone)
          if (to) {
            const eventSnap = await adminDb.collection('events').doc(eventId).get()
            const eventTitle = eventSnap.exists
              ? String((eventSnap.data() as any)?.title || (eventSnap.data() as any)?.name || 'an event')
              : 'an event'

            const message = `Tikèm staff invite: ${eventTitle}. Open in app: ${inviteDeepLink} (or web: ${inviteUrl})`
            await sendSms({ to, message })
          }
        } catch (smsError) {
          console.error('Failed to send staff invite SMS:', smsError)
        }
      }

      // If the invited email/phone already belongs to an existing user, also surface the invite
      // in their in-app Notifications so they can accept from there.
      if (method === 'email' || method === 'phone') {
        try {
          const existingUserId = await resolveExistingUserId({ method, targetEmail, targetPhone })

          if (existingUserId) {
            const eventSnap = await adminDb.collection('events').doc(eventId).get()
            const eventTitle = eventSnap.exists
              ? String((eventSnap.data() as any)?.title || (eventSnap.data() as any)?.name || 'an event')
              : 'an event'

            const actionUrl = `/invite?eventId=${encodeURIComponent(eventId)}&token=${encodeURIComponent(token)}`

            await createNotification(
              existingUserId,
              'staff_invite',
              'Staff invitation',
              `You have been invited to join "${eventTitle}" as staff.`,
              actionUrl,
              {
                eventId,
                inviteId: inviteRef.id,
                token,
                method,
                role: 'staff',
                permissions: normalizePermissions(body?.permissions),
                eventTitle,
              }
            )

            // Best-effort push (mobile + web)
            await sendPushNotification(
              existingUserId,
              'Staff invitation',
              `You have been invited to join "${eventTitle}" as staff.`,
              inviteUrl,
              { type: 'staff_invite', eventId, inviteId: inviteRef.id, deepLink: inviteDeepLink }
            )
          }
        } catch (notificationError) {
          console.error('Failed to create staff invite notification:', notificationError)
        }
      }
    })

    return NextResponse.json({
      inviteId: inviteRef.id,
      inviteUrl,
      expiresAt: expiresAt.toDate().toISOString(),
    })
  } catch (err: any) {
    const message = err?.message || 'Failed to create invite'
    const status = message === 'Event not found' ? 404 : message.includes('Only the event owner') ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
