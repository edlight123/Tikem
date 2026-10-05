/**
 * Security and fraud prevention utilities
 */

import { createClient } from '@/lib/firebase-db/server'
import { adminDb } from '@/lib/firebase/admin'
import { sendEmail } from '@/lib/email'
import { getAdminEmails } from '@/lib/admin'

interface PurchaseAttempt {
  userId: string | null
  eventId: string
  ipAddress: string
  quantity: number
  fingerprint?: string
}

interface SuspiciousActivity {
  userId?: string
  activityType: 'rapid_purchases' | 'duplicate_tickets' | 'unusual_location' | 'bot_behavior' | 'chargeback' | 'multiple_accounts'
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  ipAddress?: string
  metadata?: Record<string, any>
}

/**
 * Check if user/IP is blacklisted
 */
export async function isBlacklisted(
  value: string,
  type: 'user' | 'ip' | 'email'
): Promise<{ blacklisted: boolean; reason?: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('security_blacklist')
    .select('reason, expires_at')
    .eq('type', type)
    .eq('value', value)
    .single()

  if (error || !data) {
    return { blacklisted: false }
  }

  // Check if blacklist has expired
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { blacklisted: false }
  }

  return { blacklisted: true, reason: data.reason }
}

/**
 * Log a purchase attempt for rate limiting
 */
export async function logPurchaseAttempt(
  attempt: PurchaseAttempt,
  success: boolean
): Promise<void> {
  const supabase = await createClient()
  const id = `attempt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

  await supabase.from('purchase_attempts').insert({
    id,
    user_id: attempt.userId,
    event_id: attempt.eventId,
    ip_address: attempt.ipAddress,
    attempted_at: new Date().toISOString(),
    success,
    quantity: attempt.quantity,
    fingerprint: attempt.fingerprint,
  })
}

/**
 * Check if purchase should be rate limited.
 *
 * IMPORTANT (Haiti): most users buy over Digicel/Natcom mobile data behind carrier-grade NAT,
 * so hundreds of unrelated buyers can share a handful of public IPs. IP-based purchase limits
 * therefore false-block legitimate buyers during a popular on-sale. Because every purchase path
 * is authenticated, we rate-limit primarily per-USER and only fall back to a (very generous) IP
 * ceiling for anonymous requests as a botnet backstop.
 */
export async function shouldRateLimit(
  userId: string | null,
  ipAddress: string,
  eventId: string
): Promise<{ limited: boolean; reason?: string }> {
  const supabase = await createClient()
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()

  if (userId) {
    // Per-user, this event: stops one account hammering a single event, while still allowing
    // genuine retries (gateway redirects, popup re-tries, double clicks).
    const { data: userEventAttempts } = await supabase
      .from('purchase_attempts')
      .select('id')
      .eq('user_id', userId)
      .eq('event_id', eventId)
      .gte('attempted_at', fiveMinutesAgo)

    if (userEventAttempts && userEventAttempts.length >= 12) {
      return { limited: true, reason: 'Too many attempts for this event. Please wait a moment and try again.' }
    }

    // Per-user, across all events: stops a single farmed account scripting mass purchases.
    const { data: userAttempts } = await supabase
      .from('purchase_attempts')
      .select('id')
      .eq('user_id', userId)
      .gte('attempted_at', fiveMinutesAgo)

    if (userAttempts && userAttempts.length >= 25) {
      return { limited: true, reason: 'Too many purchase attempts. Please wait a moment and try again.' }
    }

    // Authenticated: deliberately DO NOT apply shared-IP limits (carrier-grade NAT would cause
    // false positives for unrelated Haitian buyers on the same mobile network).
    return { limited: false }
  }

  // Anonymous fallback (purchases normally require auth; this is defense-in-depth only). Use a
  // very generous IP ceiling so a shared NAT isn't blocked, while still catching an egregious botnet.
  const { data: ipAttempts } = await supabase
    .from('purchase_attempts')
    .select('id')
    .eq('ip_address', ipAddress)
    .gte('attempted_at', fiveMinutesAgo)

  if (ipAttempts && ipAttempts.length >= 100) {
    return { limited: true, reason: 'Too many purchase attempts from this network. Please wait before trying again.' }
  }

  return { limited: false }
}

/** Ticket statuses that hold a seat (see ticket-status vocabulary). */
const LIVE_TICKET_STATUSES = new Set(['valid', 'confirmed', 'active'])

/**
 * Check if user has exceeded per-event ticket limit
 */
export async function checkTicketLimit(
  userId: string,
  eventId: string
): Promise<{ exceeded: boolean; currentCount?: number; maxAllowed?: number }> {
  const supabase = await createClient()
  // Get event's max tickets per user
  const { data: event } = await supabase
    .from('events')
    .select('max_tickets_per_user')
    .eq('id', eventId)
    .single()

  if (!event) {
    return { exceeded: false }
  }

  const maxAllowed = event.max_tickets_per_user || 10

  // Count the user's LIVE tickets for this event. Card tickets issued by the
  // Stripe webhook historically carried only `attendee_id` (no `user_id`), so a
  // count on user_id alone missed them and the limit never bit; refunded or
  // cancelled tickets must not count against the buyer either. Two equality
  // queries (one per field) merged by id — no composite index needed.
  const ids = new Set<string>()
  for (const field of ['attendee_id', 'user_id']) {
    const snap = await adminDb
      .collection('tickets')
      .where('event_id', '==', eventId)
      .where(field, '==', userId)
      .get()
    snap.docs.forEach((d: any) => {
      const status = String(d.data()?.status ?? '').toLowerCase().trim()
      if (LIVE_TICKET_STATUSES.has(status)) ids.add(d.id)
    })
  }

  const currentCount = ids.size

  return {
    exceeded: currentCount >= maxAllowed,
    currentCount,
    maxAllowed,
  }
}

/**
 * Log suspicious activity
 */
export async function logSuspiciousActivity(activity: SuspiciousActivity): Promise<void> {
  const id = `suspicious_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

  // Firestore-first: enables admin security dashboard to transition off the legacy DB.
  // Store detected_at as ISO string for stable ordering.
  try {
    await adminDb
      .collection('suspicious_activities')
      .doc(id)
      .set({
        user_id: activity.userId || null,
        activity_type: activity.activityType,
        description: activity.description,
        severity: activity.severity,
        ip_address: activity.ipAddress || null,
        metadata: activity.metadata || null,
        detected_at: new Date().toISOString(),
        reviewed: false,
        reviewed_by: null,
        reviewed_at: null,
        action_taken: null,
      })
  } catch (err) {
    console.warn('Failed to write suspicious activity to Firestore:', err)
  }

  // Legacy fallback: keep existing behavior for deployments still relying on Supabase.
  try {
    const supabase = await createClient()
    await supabase.from('suspicious_activities').insert({
      id,
      user_id: activity.userId,
      activity_type: activity.activityType,
      description: activity.description,
      severity: activity.severity,
      ip_address: activity.ipAddress,
      metadata: activity.metadata ? JSON.stringify(activity.metadata) : null,
      detected_at: new Date().toISOString(),
    })
  } catch (err) {
    console.warn('Failed to write suspicious activity to legacy DB:', err)
  }

  // Email all configured admins for critical security events
  if (activity.severity === 'critical') {
    console.error('CRITICAL SECURITY ALERT:', activity.description, activity)
    const adminEmails = getAdminEmails()
    if (adminEmails.length > 0) {
      const subject = `[Tikèm] Critical Security Alert: ${activity.activityType}`
      const html = `<div style="font-family:sans-serif;padding:24px">
<h2 style="color:#ef4444">🚨 Critical Security Alert</h2>
<p><strong>Type:</strong> ${activity.activityType}</p>
<p><strong>Description:</strong> ${activity.description}</p>
${activity.userId ? `<p><strong>User ID:</strong> ${activity.userId}</p>` : ''}
${activity.ipAddress ? `<p><strong>IP Address:</strong> ${activity.ipAddress}</p>` : ''}
<p><strong>Detected at:</strong> ${new Date().toISOString()}</p>
${activity.metadata ? `<pre style="background:#f1f5f9;padding:12px;border-radius:8px">${JSON.stringify(activity.metadata, null, 2)}</pre>` : ''}
<p style="color:#94a3b8;font-size:12px">Tikèm Security System</p>
</div>`
      Promise.all(
        adminEmails.map(to => sendEmail({ to, subject, html }).catch(e => console.error('[security] Failed to send alert email to', to, e)))
      ).catch(() => {})
    }
  }
}

/**
 * Validate QR code and prevent duplicate scans
 */
export async function validateTicketScan(
  ticketId: string,
  scannedBy: string
): Promise<{ valid: boolean; reason?: string; ticket?: any }> {
  const supabase = await createClient()
  const { data: ticket } = await supabase
    .from('tickets')
    .select('*, events(*)')
    .eq('id', ticketId)
    .single()

  if (!ticket) {
    return { valid: false, reason: 'Ticket not found' }
  }

  // Check if ticket is flagged
  if (ticket.is_flagged) {
    await logSuspiciousActivity({
      activityType: 'duplicate_tickets',
      description: `Attempted to scan flagged ticket: ${ticketId}`,
      severity: 'high',
      metadata: { ticketId, scannedBy, flagReason: ticket.flag_reason },
    })
    return { valid: false, reason: `Ticket flagged: ${ticket.flag_reason}` }
  }

  // Check if already scanned (for single-entry events)
  if (ticket.scanned_count > 0) {
    const lastScannedMinutesAgo = ticket.last_scanned_at
      ? (Date.now() - new Date(ticket.last_scanned_at).getTime()) / 1000 / 60
      : Infinity

    // If scanned within last 5 minutes, likely duplicate scan attempt
    if (lastScannedMinutesAgo < 5) {
      await logSuspiciousActivity({
        userId: ticket.user_id,
        activityType: 'duplicate_tickets',
        description: `Duplicate scan attempt for ticket ${ticketId}`,
        severity: 'medium',
        metadata: { ticketId, scannedBy, lastScannedAt: ticket.last_scanned_at },
      })
      return { valid: false, reason: 'Ticket already scanned recently' }
    }
  }

  // Check if event has already occurred
  const eventDate = new Date(ticket.events.date)
  const eventEndDate = new Date(eventDate.getTime() + 24 * 60 * 60 * 1000) // Assume 24h event duration
  if (Date.now() > eventEndDate.getTime()) {
    return { valid: false, reason: 'Event has already ended' }
  }

  return { valid: true, ticket }
}

/**
 * Record ticket scan
 */
export async function recordTicketScan(ticketId: string, scannedBy: string): Promise<void> {
  const supabase = await createClient()
  
  // Get current ticket data
  const { data: ticket } = await supabase
    .from('tickets')
    .select('scanned_count')
    .eq('id', ticketId)
    .single()
  
  const currentCount = ticket?.scanned_count || 0
  
  await supabase
    .from('tickets')
    .update({
      scanned_count: currentCount + 1,
      last_scanned_at: new Date().toISOString(),
      last_scanned_by: scannedBy,
    })
    .eq('id', ticketId)
}

/**
 * Detect potential bot behavior
 */
export async function detectBotBehavior(
  userId: string | null,
  ipAddress: string,
  fingerprint?: string
): Promise<boolean> {
  const supabase = await createClient()
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  // Check for identical fingerprints from different IPs (botnet)
  if (fingerprint) {
    const { data: fingerprintAttempts } = await supabase
      .from('purchase_attempts')
      .select('ip_address')
      .eq('fingerprint', fingerprint)
      .gte('attempted_at', oneHourAgo)

    if (fingerprintAttempts) {
      const uniqueIps = new Set(fingerprintAttempts.map((a: any) => a.ip_address))
      if (uniqueIps.size >= 5) {
        await logSuspiciousActivity({
          userId: userId || undefined,
          activityType: 'bot_behavior',
          description: `Same fingerprint from ${uniqueIps.size} different IPs`,
          severity: 'high',
          ipAddress,
          metadata: { fingerprint, uniqueIps: Array.from(uniqueIps) },
        })
        return true
      }
    }
  }

  // Check for very rapid attempts (< 2 seconds between attempts)
  if (userId) {
    const { data: userAttempts } = await supabase
      .from('purchase_attempts')
      .select('attempted_at')
      .eq('user_id', userId)
      .gte('attempted_at', oneHourAgo)
      .order('attempted_at', { ascending: false })
      .limit(10)

    if (userAttempts && userAttempts.length >= 5) {
      const times = userAttempts.map((a: any) => new Date(a.attempted_at).getTime())
      const intervals = []
      for (let i = 1; i < times.length; i++) {
        intervals.push(times[i - 1] - times[i])
      }
      const avgInterval = intervals.reduce((a: number, b: number) => a + b, 0) / intervals.length
      if (avgInterval < 2000) {
        // Less than 2 seconds average
        await logSuspiciousActivity({
          userId,
          activityType: 'bot_behavior',
          description: `Very rapid purchase attempts (avg ${avgInterval}ms)`,
          severity: 'high',
          ipAddress,
          metadata: { intervals, avgInterval },
        })
        return true
      }
    }
  }

  return false
}

/**
 * Add user/IP to blacklist
 */
export async function addToBlacklist(
  type: 'user' | 'ip' | 'email',
  value: string,
  reason: string,
  blacklistedBy: string,
  expiresAt?: Date
): Promise<void> {
  const supabase = await createClient()
  const id = `blacklist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

  await supabase.from('security_blacklist').insert({
    id,
    type,
    value,
    reason,
    blacklisted_by: blacklistedBy,
    blacklisted_at: new Date().toISOString(),
    expires_at: expiresAt?.toISOString(),
  })

  await logSuspiciousActivity({
    activityType: 'multiple_accounts',
    description: `${type} blacklisted: ${value}`,
    severity: 'critical',
    metadata: { type, value, reason, blacklistedBy },
  })
}
