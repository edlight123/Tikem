/**
 * Static guards for the organizer / KYC / ticket-transfer trust boundary.
 *
 * Like firestore-rules-ticket-update.test.ts these read the rules SOURCE (no
 * emulator here). They pin:
 *  - organizers/{id} and payoutConfig are server-only (payoutRelease,
 *    is_verified, verification_status, Stripe ids live there and the payout
 *    engine trusts them);
 *  - verification_requests: a client may draft, never set or change status;
 *  - ticket_transfers: no client create; the sender may only cancel;
 *  - events: organizer_id / organizerId fixed on update;
 *  - no web/mobile client writes organizers docs or payoutConfig, and none
 *    creates ticket_transfers (so the closed rules break nothing).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const rules = read('firestore.rules')

function block(startMarker: string, endMarker: string): string {
  const start = rules.indexOf(startMarker)
  const end = rules.indexOf(endMarker, start + 1)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return rules.slice(start, end)
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(p)
  }
  return out
}

// Client bundles only: API routes and server-only modules use the Admin SDK.
const clientFiles = [
  ...walk(join(root, 'mobile')),
  ...walk(join(root, 'components')),
  ...walk(join(root, 'app')).filter((f) => !relative(root, f).startsWith('app/api/')),
].filter((f) => /from ['"]firebase\/firestore['"]|import\(['"]firebase\/firestore['"]\)/.test(readFileSync(f, 'utf8')))

describe('firestore.rules — organizers', () => {
  const org = block('match /organizers/{organizerId}', 'match /organizer_followers/{followId}')
  const top = org.slice(0, org.indexOf('match /payoutConfig'))

  it('the organizer doc is not client-writable', () => {
    expect(top).toMatch(/allow write: if false;/)
    expect(top).not.toMatch(/allow (write|create|update|delete): if isOwner/)
  })

  it('payoutConfig is owner-readable, server-written', () => {
    const pc = org.slice(org.indexOf('match /payoutConfig'), org.indexOf('match /payoutProfiles'))
    expect(pc).toMatch(/allow read: if isOwner\(organizerId\);/)
    expect(pc).toMatch(/allow write: if false;/)
  })

  it('no client writes an organizers doc or payoutConfig', () => {
    for (const f of clientFiles) {
      const src = readFileSync(f, 'utf8')
      const writes = src.match(/(setDoc|updateDoc|addDoc|deleteDoc)\(\s*doc\(\s*db\s*,\s*['"]organizers['"][^)]*\)/g) || []
      expect({ file: relative(root, f), writes }).toEqual({ file: relative(root, f), writes: [] })
      // A ref built then written later: flag any organizers ref in a file that writes.
      if (/doc\(\s*db\s*,\s*['"]organizers['"]/.test(src)) {
        const refLine = src.split('\n').filter((l) => /doc\(\s*db\s*,\s*['"]organizers['"]/.test(l))
        for (const l of refLine) expect(l).toMatch(/payoutConfig/) // the one known READ (mobile earnings)
      }
    }
  })
})

describe('firestore.rules — verification_requests', () => {
  const vr = block('match /verification_requests/{userId}', 'match /organizers/{organizerId}')
  const create = vr.slice(vr.indexOf('allow create'), vr.indexOf('allow update'))
  const update = vr.slice(vr.indexOf('allow update'), vr.indexOf('allow delete'))

  it('create is limited to a draft status and the creator identity', () => {
    expect(create).toMatch(/get\('status', ''\) in \['in_progress', 'pending'\]/)
    expect(create).toContain("get('userId', request.auth.uid) == request.auth.uid")
    expect(create).toContain('keys().hasOnly(')
    expect(create).not.toMatch(/'approved'|'reviewedAt'|'reviewNotes'|'reasonCodes'/)
  })

  it('update can touch only steps/files/updatedAt, never status, and not once approved', () => {
    expect(update).toContain("affectedKeys().hasOnly(['steps', 'files', 'updatedAt'])")
    expect(update).toContain("resource.data.get('status', '') != 'approved'")
  })

  it('the mobile wizard writes fit the rule', () => {
    const src = read('mobile/lib/verification.ts')
    expect(src).toMatch(/status: 'in_progress'/)
    // Every updateDoc on the request writes only steps/files + updatedAt.
    const updates = src.match(/updateDoc\(docRef, \{[\s\S]*?\}\);/g) || []
    expect(updates.length).toBeGreaterThan(0)
    for (const u of updates) {
      const keys = Array.from(u.matchAll(/^\s+([a-zA-Z_]+):/gm)).map((m) => m[1])
      for (const k of keys) expect(['steps', 'files', 'updatedAt']).toContain(k)
    }
  })
})

describe('firestore.rules — ticket_transfers', () => {
  const tt = block('match /ticket_transfers/{transferId}', 'match /organizer_messages/{messageId}')

  it('clients cannot create or delete transfers', () => {
    expect(tt).toMatch(/allow create: if false;/)
    expect(tt).toMatch(/allow delete: if false;/)
  })

  it('the only client update is the sender cancelling a pending offer', () => {
    const update = tt.slice(tt.indexOf('allow update'), tt.indexOf('allow delete'))
    expect(update).toContain('resource.data.from_user_id == request.auth.uid')
    expect(update).toContain("resource.data.status == 'pending'")
    expect(update).toContain("request.resource.data.status == 'cancelled'")
    expect(update).toContain("affectedKeys().hasOnly(['status', 'updated_at', 'responded_at'])")
    expect(update).not.toContain('to_email')
  })

  it('no client creates a ticket_transfers doc', () => {
    for (const f of clientFiles) {
      const src = readFileSync(f, 'utf8')
      expect({ file: relative(root, f), hit: /(addDoc\(\s*collection\(\s*db\s*,\s*['"]ticket_transfers|setDoc\(\s*doc\(\s*db\s*,\s*['"]ticket_transfers)/.test(src) }).toEqual({
        file: relative(root, f),
        hit: false,
      })
    }
  })
})

describe('firestore.rules — events ownership', () => {
  it('organizer_id and organizerId are fixed on update', () => {
    const ev = block('match /events/{eventId}', 'match /members/{memberId}')
    const update = ev.slice(ev.indexOf('allow update'))
    expect(update).toContain("request.resource.data.get('organizer_id', null) == resource.data.organizer_id")
    expect(update).toContain("request.resource.data.get('organizerId', null) == resource.data.get('organizerId', null)")
  })
})
