/**
 * @jest-environment node
 *
 * Community sharing and claims, through the routes:
 *  - POST /api/community/submissions: signed in, not banned, our own upload,
 *    per-account and per-IP daily budgets, source links cleaned.
 *  - POST /api/events/:id/claim: signed in, claimable events only, a proof
 *    that matches its method, an uploaded proof only from the caller's own
 *    private folder and only if it exists.
 *  - Admin decisions: only admins; publish makes a credited, claimable
 *    community event; merge points at an existing event; an approved claim
 *    transfers the event and upgrades an attendee claimant to organizer.
 */
const db: Record<string, Record<string, any>> = {}
let user: any = { id: 'u1', email: 'a@b.c', full_name: 'Ana' }
let admin = false
let orgCtx: any = null
let proofExists = true
const limited: Record<string, boolean> = {}
const rateKeys: string[] = []
const notified: any[] = []
const roleUpdates: any[] = []

jest.mock('server-only', () => ({}))
jest.mock('@/lib/auth', () => ({
  getCurrentUser: jest.fn(async () => user),
  requireAdmin: jest.fn(async () => ({ user: admin ? user : null })),
}))
jest.mock('@/lib/rate-limit', () => ({
  clientIp: () => '203.0.113.9', clientIpKey: () => '203.0.113.9',
  consumeRateLimit: jest.fn(async (o: any) => {
    rateKeys.push(o.key)
    return { limited: !!limited[o.key.split(':').slice(0, 2).join(':')] }
  }),
}))
jest.mock('@/lib/posters/hosts', () => ({
  isOwnPoster: (u: string) => typeof u === 'string' && u.startsWith('https://firebasestorage.googleapis.com/v0/b/bucket/'),
}))
jest.mock('@/lib/organizer/context', () => ({
  getOrgContext: jest.fn(async () => orgCtx),
  orgDisplayName: jest.fn(async (id: string) => (id === 'org9' ? 'Kompa Nights' : '')),
}))
jest.mock('@/lib/community/claim-proofs', () => ({
  ...jest.requireActual('@/lib/community/claim-proofs'),
  claimProofExists: jest.fn(async () => proofExists),
}))
jest.mock('@/lib/community/notify', () => ({
  notifyAdminsOfCommunity: jest.fn(async (p: any) => notified.push({ admin: true, ...p })),
  notifyCommunityMember: jest.fn(async (p: any) => notified.push(p)),
}))
jest.mock('@/lib/community/org', () => ({ ensureCommunityOrg: jest.fn(async () => 'tikem-community') }))
jest.mock('@/lib/firestore/user-profile-server', () => ({
  updateUserRole: jest.fn(async (uid: string, role: string) => {
    roleUpdates.push({ uid, role })
    return { success: true }
  }),
}))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { delete: () => '__DELETE__' } }))
jest.mock('@/lib/firebase/admin', () => {
  let n = 0
  const apply = (col: string, id: string, d: any) => {
    const cur = { ...(db[col]?.[id] || {}) }
    for (const [k, v] of Object.entries(d)) {
      if (v === '__DELETE__') delete cur[k]
      else cur[k] = v
    }
    ;(db[col] ||= {})[id] = cur
  }
  const ref = (col: string, id: string) => ({
    id,
    get: async () => ({ exists: !!db[col]?.[id], data: () => db[col]?.[id] }),
    set: async (d: any) => {
      ;(db[col] ||= {})[id] = d
    },
    update: async (d: any) => apply(col, id, d),
  })
  const query = (col: string, filters: Array<[string, any]>): any => ({
    where: (f: string, _op: string, v: any) => query(col, [...filters, [f, v]]),
    limit: () => query(col, filters),
    get: async () => ({
      docs: Object.entries(db[col] || {})
        .filter(([, d]) => filters.every(([f, v]) => d[f] === v))
        .map(([id, d]) => ({ id, ref: ref(col, id), data: () => d })),
    }),
  })
  return {
    adminDb: {
      collection: (col: string) => ({
        doc: (id?: string) => ref(col, id || `${col}-${++n}`),
        where: (f: string, op: string, v: any) => query(col, []).where(f, op, v),
      }),
      batch: () => {
        const ops: Array<() => Promise<void>> = []
        return {
          set: (r: any, d: any) => ops.push(() => r.set(d)),
          update: (r: any, d: any) => ops.push(() => r.update(d)),
          commit: async () => {
            for (const o of ops) await o()
          },
        }
      },
    },
  }
})

import { POST as submit } from '@/app/api/community/submissions/route'
import { POST as claim, GET as claimStatus } from '@/app/api/events/[id]/claim/route'
import { POST as decideSubmission } from '@/app/api/admin/community/submissions/[id]/route'
import { POST as decideClaim } from '@/app/api/admin/community/claims/[id]/route'

const OURS = 'https://firebasestorage.googleapis.com/v0/b/bucket/o/event-images%2Fu1_a.jpg?alt=media'
const req = (body: any) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) })
const p = (id: string) => ({ params: Promise.resolve({ id }) })
const fields = { title: 'Kompa sou plaj', date: '2027-01-16', start_time: '21:00', city: 'Port-au-Prince', country: 'HT', organizer_name: 'Kompa Nights', organizer_handle: 'kompa.nights', source_url: 'https://instagram.com/p/1' }

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k]
  for (const k of Object.keys(limited)) delete limited[k]
  rateKeys.length = 0
  notified.length = 0
  roleUpdates.length = 0
  user = { id: 'u1', email: 'a@b.c', full_name: 'Ana' }
  admin = false
  orgCtx = null
  proofExists = true
})

describe('POST /api/community/submissions', () => {
  it('takes a share from a signed-in member, pending review, and pages admins', async () => {
    const res = await submit(req({ image_url: OURS, organizer_name: 'Kompa Nights', source_url: 'https://instagram.com/p/1', details: { title: 'Kompa', free: true } }))
    expect(res.status).toBe(201)
    const [doc] = Object.values(db.event_submissions)
    expect(doc).toMatchObject({ status: 'pending', image_url: OURS, source_url: 'https://instagram.com/p/1', submitted_by: 'u1', details: { title: 'Kompa', free: true } })
    expect(rateKeys).toEqual(['community-submit:user:u1', 'community-submit:ip:203.0.113.9'])
    expect(notified).toEqual([expect.objectContaining({ admin: true, kind: 'submission' })])
  })

  it('drops a non-http(s) source link instead of storing it', async () => {
    await submit(req({ image_url: OURS, source_url: 'javascript:alert(1)' }))
    expect(Object.values(db.event_submissions)[0].source_url).toBeNull()
  })

  it('refuses signed-out people, other hosts, and banned accounts', async () => {
    expect((await submit(req({ image_url: 'https://evil.example.com/x.jpg' }))).status).toBe(400)
    db.users = { u1: { status: 'banned' } }
    expect((await submit(req({ image_url: OURS }))).status).toBe(403)
    user = null
    expect((await submit(req({ image_url: OURS }))).status).toBe(401)
    expect(db.event_submissions).toBeUndefined()
  })

  it('rate-limits per account and per IP', async () => {
    limited['community-submit:user'] = true
    const a = await submit(req({ image_url: OURS }))
    expect(a.status).toBe(429)
    delete limited['community-submit:user']
    limited['community-submit:ip'] = true
    const b = await submit(req({ image_url: OURS }))
    expect(b.status).toBe(429)
    expect((await b.json()).code).toBe('rate_limited')
    expect(db.event_submissions).toBeUndefined()
  })
})

describe('POST /api/events/:id/claim', () => {
  beforeEach(() => {
    db.events = { e1: { title: 'Kompa sou plaj', claimable: true, community_shared: true, organizer_id: 'tikem-community', source_name: 'Kompa Nights', source_handle: 'kompa.nights' } }
  })

  it('records a claim for the caller, with the handle check for the admin', async () => {
    const res = await claim(req({ method: 'instagram', instagram_handle: '@Kompa.Nights', message: 'It is ours' }), p('e1'))
    expect(res.status).toBe(201)
    expect(db.event_claims['e1__u1']).toMatchObject({ status: 'pending', org_id: 'u1', requested_by: 'u1', method: 'instagram', handle_matches: true })
    expect(notified).toEqual([expect.objectContaining({ admin: true, kind: 'claim' })])
    // Asking again while pending is a no-op.
    expect(await (await claim(req({ method: 'instagram', instagram_handle: 'x' }), p('e1'))).json()).toEqual({ ok: true, already: true })
    expect(await (await claimStatus(new Request('http://x'), p('e1'))).json()).toEqual({ claimable: true, claim: { status: 'pending' } })
  })

  it('claims for the acting org when the caller manages its events', async () => {
    orgCtx = { orgId: 'org9', role: 'manager' }
    await claim(req({ method: 'link', proof_url: 'https://kompanights.ht' }), p('e1'))
    expect(db.event_claims['e1__org9']).toMatchObject({ org_id: 'org9', org_name: 'Kompa Nights', requested_by: 'u1' })
  })

  it('takes an uploaded proof only from the caller’s own private folder, and only if it exists', async () => {
    expect((await claim(req({ method: 'upload', proof_path: 'claim-proofs/u2/proof_1.jpg' }), p('e1'))).status).toBe(400)
    expect((await claim(req({ method: 'upload', proof_path: 'https://firebasestorage.googleapis.com/x.jpg' }), p('e1'))).status).toBe(400)
    proofExists = false
    expect((await claim(req({ method: 'upload', proof_path: 'claim-proofs/u1/proof_1.jpg' }), p('e1'))).status).toBe(400)
    proofExists = true
    expect((await claim(req({ method: 'upload', proof_path: 'claim-proofs/u1/proof_1.jpg' }), p('e1'))).status).toBe(201)
    expect(db.event_claims['e1__u1'].proof_path).toBe('claim-proofs/u1/proof_1.jpg')
  })

  it('refuses ordinary events, missing proofs, signed-out people and banned accounts', async () => {
    db.events.e2 = { title: 'Mine', organizer_id: 'orgX' }
    expect((await claim(req({ method: 'instagram', instagram_handle: 'me' }), p('e2'))).status).toBe(409)
    expect((await claim(req({ method: 'link', proof_url: 'javascript:x' }), p('e1'))).status).toBe(400)
    expect((await claim(req({ method: 'instagram', instagram_handle: 'me' }), p('nope'))).status).toBe(404)
    db.users = { u1: { banned: true } }
    expect((await claim(req({ method: 'instagram', instagram_handle: 'me' }), p('e1'))).status).toBe(403)
    user = null
    expect((await claim(req({ method: 'instagram', instagram_handle: 'me' }), p('e1'))).status).toBe(401)
    expect(db.event_claims).toBeUndefined()
  })

  it('rate-limits claims per account', async () => {
    limited['community-claim:user'] = true
    expect((await claim(req({ method: 'instagram', instagram_handle: 'me' }), p('e1'))).status).toBe(429)
  })
})

describe('admin: shares', () => {
  beforeEach(() => {
    db.event_submissions = { s1: { status: 'pending', image_url: OURS, submitted_by: 'u7' } }
  })

  it('only admins decide', async () => {
    expect((await decideSubmission(req({ action: 'approve', fields }), p('s1'))).status).toBe(403)
    expect((await decideSubmission(req({ action: 'reject' }), p('s1'))).status).toBe(403)
    expect(db.event_submissions.s1.status).toBe('pending')
  })

  it('publishes it credited, claimable, owned by the community account, and tells the member', async () => {
    admin = true
    const res = await decideSubmission(req({ action: 'approve', fields }), p('s1'))
    expect(res.status).toBe(200)
    const { eventId } = await res.json()
    expect(db.events[eventId]).toMatchObject({
      title: 'Kompa sou plaj',
      organizer_id: 'tikem-community',
      organizer_name: 'Tikèm Community',
      source_name: 'Kompa Nights',
      community_shared: true,
      claimable: true,
      is_published: true,
      rejected: false,
      reports_count: 0,
      banner_image_url: OURS,
    })
    expect(db.event_submissions.s1).toMatchObject({ status: 'approved', event_id: eventId })
    expect(notified).toEqual([expect.objectContaining({ userId: 'u7', outcome: 'published', eventId })])
    expect((await decideSubmission(req({ action: 'approve', fields }), p('s1'))).status).toBe(409)
  })

  it('refuses bad edits, and merges a duplicate into an existing event', async () => {
    admin = true
    expect((await decideSubmission(req({ action: 'approve', fields: { ...fields, title: '' } }), p('s1'))).status).toBe(400)
    expect((await decideSubmission(req({ action: 'merge', event_id: 'missing' }), p('s1'))).status).toBe(404)
    db.events = { e5: { title: 'Kompa sou plaj' } }
    expect((await decideSubmission(req({ action: 'merge', event_id: 'e5' }), p('s1'))).status).toBe(200)
    expect(db.event_submissions.s1).toMatchObject({ status: 'merged', merged_into: 'e5' })
    expect(notified).toEqual([expect.objectContaining({ userId: 'u7', outcome: 'merged', eventId: 'e5' })])
  })
})

describe('admin: claims and the transfer', () => {
  beforeEach(() => {
    db.events = {
      e1: {
        title: 'Kompa sou plaj',
        claimable: true,
        community_shared: true,
        organizer_id: 'tikem-community',
        organizer_name: 'Tikèm Community',
        source_name: 'Kompa Nights',
        source_handle: 'kompa.nights',
        source_url: 'https://instagram.com/p/1',
        external_url: 'https://tickets.example.com',
        community_free: false,
      },
    }
    db.users = { u1: { role: 'attendee' } }
    db.event_claims = {
      e1__u1: { status: 'pending', event_id: 'e1', event_title: 'Kompa sou plaj', org_id: 'u1', org_name: 'Ana', requested_by: 'u1' },
      e1__org3: { status: 'pending', event_id: 'e1', event_title: 'Kompa sou plaj', org_id: 'org3', requested_by: 'u3' },
    }
  })

  it('only admins decide', async () => {
    expect((await decideClaim(req({ action: 'approve' }), p('e1__u1'))).status).toBe(403)
    expect(db.events.e1.organizer_id).toBe('tikem-community')
  })

  it('moves the event to the claimant, drops the credit, upgrades them, and closes rival claims', async () => {
    admin = true
    expect((await decideClaim(req({ action: 'approve' }), p('e1__u1'))).status).toBe(200)
    const e = db.events.e1
    expect(e).toMatchObject({ organizer_id: 'u1', organizer_name: 'Ana', community_shared: false, claimable: false, claimed_by: 'u1' })
    for (const f of ['source_name', 'source_handle', 'source_url', 'external_url', 'community_free']) expect(e).not.toHaveProperty(f)
    expect(roleUpdates).toEqual([{ uid: 'u1', role: 'organizer' }])
    expect(db.event_claims.e1__u1.status).toBe('approved')
    expect(db.event_claims.e1__org3.status).toBe('superseded')
    expect(notified).toEqual([expect.objectContaining({ userId: 'u1', outcome: 'claim_approved', eventId: 'e1' })])
    // The event is no longer claimable.
    db.event_claims.e1__org3.status = 'pending'
    expect((await decideClaim(req({ action: 'approve' }), p('e1__org3'))).status).toBe(409)
  })

  it('rejects without touching the event', async () => {
    admin = true
    expect((await decideClaim(req({ action: 'reject' }), p('e1__u1'))).status).toBe(200)
    expect(db.events.e1.organizer_id).toBe('tikem-community')
    expect(db.event_claims.e1__u1.status).toBe('rejected')
    expect(notified).toEqual([expect.objectContaining({ outcome: 'claim_rejected' })])
  })
})
