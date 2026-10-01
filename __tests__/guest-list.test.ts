import { parseGuestInput, serializeGuest } from '../lib/guest-list'

describe('guest list input', () => {
  it('requires name and email on create, lower-cases email, defaults plus_one', () => {
    expect(parseGuestInput({ name: '  Jane ', email: 'Jane@Example.com ' }, false)).toEqual({
      ok: true,
      value: { name: 'Jane', email: 'jane@example.com', plus_one: false },
    })
    expect(parseGuestInput({ email: 'a@b.co' }, false).ok).toBe(false)
    expect(parseGuestInput({ name: 'A' }, false).ok).toBe(false)
    expect(parseGuestInput({ name: 'A', email: 'not-an-email' }, false).ok).toBe(false)
  })

  it('ignores checked_in on create', () => {
    const r = parseGuestInput({ name: 'A', email: 'a@b.co', checked_in: true }, false)
    expect(r.ok && r.value.checked_in).toBeUndefined()
  })

  it('validates only the fields present on edit', () => {
    expect(parseGuestInput({ checked_in: true }, true)).toEqual({ ok: true, value: { checked_in: true } })
    expect(parseGuestInput({ plus_one: true }, true)).toEqual({ ok: true, value: { plus_one: true } })
    expect(parseGuestInput({ name: '' }, true).ok).toBe(false)
  })
})

describe('guest serializer', () => {
  it('matches the web page defaults', () => {
    expect(serializeGuest('g1', {})).toEqual({
      id: 'g1',
      name: '',
      email: '',
      status: 'invited',
      plus_one: false,
      invited_at: null,
      checked_in: false,
    })
  })

  it('reads a Firestore Timestamp invited_at', () => {
    const at = new Date('2026-09-30T12:00:00.000Z')
    const g = serializeGuest('g2', { invited_at: { toDate: () => at }, checked_in: true, status: 'accepted' })
    expect(g.invited_at).toBe('2026-09-30T12:00:00.000Z')
    expect(g.checked_in).toBe(true)
    expect(g.status).toBe('accepted')
  })
})
