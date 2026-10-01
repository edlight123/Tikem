// Organizer guest list: the events/{eventId}/guests sub-collection.
//
// One shape, read by the web page (app/organizer/events/[id]/guest-list) and the
// API that both the web drawer and the mobile screen write through. Keep the
// field names here in step with the page's own serializer.

export interface GuestRecord {
  id: string
  name: string
  email: string
  status: string
  plus_one: boolean
  invited_at: string | null
  checked_in: boolean
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function serializeGuest(id: string, d: any): GuestRecord {
  const invited = d?.invited_at
  return {
    id,
    name: typeof d?.name === 'string' ? d.name : '',
    email: typeof d?.email === 'string' ? d.email : '',
    status: typeof d?.status === 'string' && d.status ? d.status : 'invited',
    plus_one: d?.plus_one === true,
    invited_at:
      invited?.toDate?.()?.toISOString?.() ??
      (typeof invited === 'string' ? invited : null),
    checked_in: d?.checked_in === true,
  }
}

export type GuestInputResult =
  | { ok: true; value: { name?: string; email?: string; plus_one?: boolean; checked_in?: boolean } }
  | { ok: false; error: string }

/**
 * Validate a create (`partial = false`: name + email required) or an edit
 * (`partial = true`: only the fields present are checked). Email is stored
 * lower-cased so the per-event duplicate check is case-blind.
 */
export function parseGuestInput(body: any, partial: boolean): GuestInputResult {
  const out: { name?: string; email?: string; plus_one?: boolean; checked_in?: boolean } = {}

  if (!partial || body?.name !== undefined) {
    const name = String(body?.name ?? '').trim()
    if (!name) return { ok: false, error: 'Name is required' }
    if (name.length > 120) return { ok: false, error: 'Name is too long' }
    out.name = name
  }
  if (!partial || body?.email !== undefined) {
    const email = String(body?.email ?? '').trim().toLowerCase()
    if (!email) return { ok: false, error: 'Email is required' }
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return { ok: false, error: 'Enter a valid email address' }
    }
    out.email = email
  }
  if (body?.plus_one !== undefined) out.plus_one = body.plus_one === true
  else if (!partial) out.plus_one = false
  if (partial && body?.checked_in !== undefined) out.checked_in = body.checked_in === true

  return { ok: true, value: out }
}
