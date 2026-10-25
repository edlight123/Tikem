import { adminDb } from '@/lib/firebase/admin'
import { guestTicketStateOf, type GuestTicketState } from '@/lib/guest-list'

/**
 * The tickets behind a page of guest-list entries (their `ticket_ids`), read by
 * reference so the list shows what the door actually scanned.
 */
export async function loadGuestTicketStates(guests: Array<Record<string, any>>): Promise<GuestTicketState[]> {
  const ids = Array.from(
    new Set(
      guests.flatMap((g) => (Array.isArray(g?.ticket_ids) ? g.ticket_ids.map(String) : [])).filter(Boolean)
    )
  ) as string[]
  const out: GuestTicketState[] = []
  for (let i = 0; i < ids.length; i += 300) {
    const refs = ids.slice(i, i + 300).map((id) => adminDb.collection('tickets').doc(id))
    if (refs.length === 0) continue
    const snaps = (await adminDb.getAll(...refs)) as any[]
    for (const snap of snaps) {
      if (snap.exists) out.push(guestTicketStateOf(snap.id, snap.data()))
    }
  }
  return out
}
