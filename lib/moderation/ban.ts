/**
 * Banning an organizer: the account can no longer post, AND their published
 * events come down. The admin confirm dialog has always promised "their events
 * will be hidden", but the ban only flipped `status`/`can_create_events`, so a
 * banned organizer's events stayed live. Each event taken down here is tagged
 * `unpublished_by_ban: true` so an unban can be reviewed event by event (an
 * unban deliberately does NOT republish anything automatically).
 */
import { adminDb } from '@/lib/firebase/admin'

export async function unpublishOrganizerEvents(
  organizerId: string,
  reason = 'Organizer banned for violating the Terms of Service',
  now = new Date()
): Promise<number> {
  const snap = await adminDb
    .collection('events')
    .where('organizer_id', '==', organizerId)
    .where('is_published', '==', true)
    .get()
  if (snap.empty) return 0

  // Batches cap at 500 writes.
  const docs = snap.docs
  for (let i = 0; i < docs.length; i += 450) {
    const batch = adminDb.batch()
    for (const d of docs.slice(i, i + 450)) {
      batch.update(d.ref, {
        is_published: false,
        rejected: true,
        rejection_reason: reason,
        unpublished_by_ban: true,
        updated_at: now,
      })
    }
    await batch.commit()
  }
  return docs.length
}
