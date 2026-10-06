import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { requireAuth } from '@/lib/auth'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'
import { resolveEventCountry } from '@/lib/event-country'
import { normalizeCountryCode } from '@/lib/payment-provider'
import { checkPaidPublishGate } from '@/lib/events/publish-gate'
import { isAdmin as isAdminEmail } from '@/lib/admin'
import { isEventCancelled, publishBlockReason, PUBLISH_BLOCK_MESSAGES } from '@/lib/events/publishGuard'

async function isPaidEvent(eventId: string, eventData: any): Promise<boolean> {
  if ((eventData?.ticket_price || 0) > 0) return true

  const tiersSnapshot = await adminDb
    .collection('ticket_tiers')
    .where('event_id', '==', eventId)
    .limit(25)
    .get()

  return tiersSnapshot.docs.some((d: any) => (d.data()?.price || 0) > 0)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error } = await requireAuth()
    
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { is_published } = body

    // Only a real boolean. A truthy non-boolean used to skip the paid-publish gate
    // below (which ran on `=== true`) while still writing status 'published'.
    if (typeof is_published !== 'boolean') {
      return NextResponse.json({ error: 'is_published must be a boolean' }, { status: 400 })
    }

    // Non-blocking advisories returned alongside a SUCCESSFUL publish. Nothing
    // here may ever stop a publish — the hard gates are the 403s below.
    const warnings: Array<Record<string, any>> = []
    let clearPayoutBlock = false

    // Verify event ownership
    const eventDoc = await adminDb.collection('events').doc(id).get()
    
    if (!eventDoc.exists) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const eventData = eventDoc.data()!

    const admin =
      (user as any).role === 'admin' ||
      (user as any).role === 'super_admin' ||
      isAdminEmail((user as any).email_verified ? user.email : null)

    if (eventData.organizer_id !== user.id && !admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Everything below acts for the EVENT's organizer (an admin may be the caller).
    const organizerId = String(eventData.organizer_id || user.id)
    const organizerDoc = await adminDb.collection('users').doc(organizerId).get()
    const organizerData = organizerDoc.exists ? organizerDoc.data() : null

    // Cancelled, rejected, auto-hidden or frozen events, and banned organizers:
    // only an admin may put them (back) on sale. Unpublishing is always allowed.
    if (is_published && !admin) {
      const blocked = publishBlockReason(eventData, organizerData)
      if (blocked) {
        return NextResponse.json({ error: PUBLISH_BLOCK_MESSAGES[blocked], code: blocked }, { status: 403 })
      }
    }

    // Launch policy — "verify at the money, not at the door":
    // Haiti (HT) organizers may publish PAID events WITHOUT identity verification
    // and without an active payout profile. Identity/KYC is instead enforced at
    // disbursement time by the withdrawal/payout routes, so funds can only ever be
    // paid out to a verified organizer with a valid payout profile. This lets HT
    // organizers list and sell first, then complete KYC before cashing out.
    //
    // Stripe Connect markets (US/CA/FR) keep the full pre-publish gate: destination charges require
    // completed Connect onboarding (identity + charges/payouts enabled) before any
    // money can be collected, so those checks must pass before publishing.
    if (is_published) {
      const paid = await isPaidEvent(id, eventData)
      if (paid) {
        const resolvedCountry = await resolveEventCountry(eventData)
        const gate = await checkPaidPublishGate({
          organizerId,
          country: resolvedCountry || eventData?.country,
        })

        if (!gate.ok) {
          return NextResponse.json({ error: gate.error, code: gate.code }, { status: gate.status })
        }

        warnings.push(...gate.warnings)

        // This event has just re-passed the gate, so any block the health sweep
        // recorded is stale. Clear it here: an auto-unpublished event leaves the
        // sweep's `is_published == true` query and could never clear its own marker.
        if (eventData.payout_blocked) {
          clearPayoutBlock = true
        }
      }
    }

    // Update publish status
    const resolvedCountry = await resolveEventCountry(eventData)
    const existingCountry = normalizeCountryCode(eventData?.country)
    // Unpublishing a cancelled event must not overwrite 'cancelled' with 'draft'.
    const nextStatus = is_published ? 'published' : isEventCancelled(eventData) ? 'cancelled' : 'draft'
    const updatePayload: Record<string, any> = {
      is_published,
      status: nextStatus,
      updated_at: new Date(),
      ...(clearPayoutBlock
        ? {
            payout_blocked: false,
            payout_blocked_code: null,
            payout_blocked_reason: null,
            payout_blocked_at: null,
          }
        : {}),
    }

    // Persist a normalized country code when we can determine it.
    if (resolvedCountry && resolvedCountry !== existingCountry) {
      updatePayload.country = resolvedCountry
    }

    // Stamp the denormalized organizer display name so event cards render the
    // organizer correctly WITHOUT an extra profile read. The organization brand
    // name wins over the personal full name (falls back to it when unset).
    const organizerName = String(
      organizerData?.organization_name || organizerData?.full_name || ''
    ).trim()
    if (organizerName) updatePayload.organizer_name = organizerName

    await adminDb.collection('events').doc(id).update(updatePayload)

    // If publishing for the first time, notify followers
    if (is_published && !eventData.is_published) {
      try {
        // Get organizer followers from Firestore
        const followersSnapshot = await adminDb
          .collection('organizer_follows')
          .where('organizer_id', '==', organizerId)
          .get()

        const allFollowerIds: string[] = followersSnapshot.docs.map((doc: any) => doc.data().follower_id).filter(Boolean)
        // Defense in depth: blocking removes the follow, but never notify a
        // follower who has this organizer blocked (lib/moderation/blocks.ts).
        const blockSnaps = allFollowerIds.length
          ? await adminDb.getAll(
              ...allFollowerIds.map((fid) =>
                adminDb.collection('users').doc(fid).collection('blocked_organizers').doc(organizerId)
              )
            )
          : []
        const followerIds = allFollowerIds.filter((_fid, i) => !blockSnaps[i]?.exists)

        if (followerIds.length > 0) {
          // Notify each follower
          const notifications = followerIds.map(async (followerId: string) => {
            // Create in-app notification
            await createNotification(
              followerId,
              'event_updated',
              `New Event: ${eventData.title}`,
              `${eventData.organizer_name || 'An organizer you follow'} just published a new event!`,
              `/events/${id}`,
              { eventId: id, organizerId }
            )

            // Send push notification
            await sendPushNotification(
              followerId,
              `📅 New Event from ${eventData.organizer_name || 'Organizer'}`,
              eventData.title,
              `/events/${id}`,
              {
                type: 'new_event',
                eventId: id,
                organizerId,
              }
            )
          })

          await Promise.all(notifications)
          console.log(`Notified ${followerIds.length} followers about new event: ${eventData.title}`)
        }
      } catch (notifyError) {
        console.error('Error notifying followers:', notifyError)
        // Don't fail the publish operation if notifications fail
      }
    }

    return NextResponse.json({ success: true, is_published, warnings })
  } catch (error) {
    console.error('Error toggling publish status:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
