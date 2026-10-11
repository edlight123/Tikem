/**
 * @jest-environment node
 *
 * KYC (organizer identity verification) trust boundary:
 *  - web submit/restart go through the server routes (status is server-owned);
 *  - submit reviews the STORED Storage paths, never client URLs, and is refused
 *    once approved / already under review;
 *  - restart works from changes_requested (and rejected), never from approved;
 *  - review-verification: no approving drafts, no approving yourself;
 *  - ONE identity definition (lib/kyc/identity.ts) — flags alone never verify,
 *    an explicit is_verified:false revokes;
 *  - a first Haiti payout destination saved AFTER KYC needs the email step-up
 *    and starts the 24h hold;
 *  - the MonCash OTP verdict only vouches for the number it was checked on;
 *  - storage.rules: KYC uploads are create-only with an explicit type list.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type Doc = Record<string, any>
const store: Record<string, Doc | undefined> = {}
const objects = new Set<string>()
const deleted: string[] = []
const session: { user: any } = { user: null }

jest.mock('@/lib/firebase/admin', () => {
  const ref = (path: string): any => ({
    path,
    id: path.split('/').pop(),
    get: async () => ({ exists: store[path] !== undefined, data: () => store[path] }),
    set: async (data: Doc, opts?: any) => {
      store[path] = opts?.merge ? { ...(store[path] || {}), ...data } : { ...data }
    },
    update: async (data: Doc) => {
      store[path] = { ...(store[path] || {}), ...data }
    },
    collection: (sub: string) => coll(`${path}/${sub}`),
  })
  const coll = (name: string): any => ({
    doc: (id: string) => ref(`${name}/${id}`),
    where: (field: string, _op: string, value: any) => ({
      limit: () => ({
        get: async () => {
          const docs = Object.entries(store)
            .filter(([k, v]) => k.startsWith(`${name}/`) && k.split('/').length === name.split('/').length + 1 && v?.[field] === value)
            .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v }))
          return { empty: docs.length === 0, docs }
        },
      }),
    }),
    get: async () => {
      const docs = Object.entries(store)
        .filter(([k]) => k.startsWith(`${name}/`) && k.split('/').length === name.split('/').length + 1)
        .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v }))
      return { empty: docs.length === 0, docs }
    },
  })
  return {
    adminDb: {
      collection: (name: string) => coll(name),
      runTransaction: async (fn: any) => {
        const writes: Array<() => Promise<void>> = []
        const tx = {
          get: (r: any) => r.get(),
          set: (r: any, data: Doc, opts?: any) => writes.push(() => r.set(data, opts)),
          update: (r: any, data: Doc) => writes.push(() => r.update(data)),
        }
        const out = await fn(tx)
        for (const w of writes) await w()
        return out
      },
    },
    adminStorage: {
      bucket: () => ({
        file: (p: string) => ({
          exists: async () => [objects.has(p)],
          delete: async () => {
            deleted.push(p)
            objects.delete(p)
          },
        }),
      }),
    },
    adminAuth: {},
  }
})
jest.mock('@/lib/auth', () => ({
  getCurrentUser: async () => session.user,
  requireAdmin: async () => (session.user ? { user: session.user, error: null } : { user: null, error: 'Unauthorized' }),
}))
jest.mock('@/lib/notifications/helpers', () => ({ createNotification: jest.fn(async () => undefined) }))
jest.mock('@/lib/notification-triggers', () => ({ sendPushNotification: jest.fn(async () => undefined) }))
jest.mock('@/lib/email-kit/recipient', () => ({ resolveEmailLang: async () => 'en' }))
jest.mock('@/lib/admin/audit-log', () => ({ logAdminAction: jest.fn(async () => undefined) }))
jest.mock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: jest.fn(async () => ({})) } })) }))
jest.mock('@/lib/firestore/payout-destinations', () => ({ upsertPrimaryBankDestinationFromPayoutSettings: jest.fn(async () => undefined) }))
jest.mock('@/lib/moncash', () => ({}))

// Web client SDK, for lib/verification.ts.
const clientDocs: Record<string, Doc | undefined> = {}
jest.mock('firebase/firestore', () => ({
  doc: (_db: any, coll: string, id: string) => ({ path: `${coll}/${id}` }),
  getDoc: async (r: any) => ({ exists: () => clientDocs[r.path] !== undefined, data: () => clientDocs[r.path] }),
  updateDoc: jest.fn(async () => {
    throw new Error('client updateDoc must not be used for submit/restart')
  }),
  setDoc: jest.fn(async () => undefined),
  serverTimestamp: () => 'ts',
}))
jest.mock('@/lib/firebase/client', () => ({
  auth: { currentUser: { uid: 'org1', getIdToken: async () => 'id-token' } },
  db: {},
  storage: {},
}))

import { POST as submitRoute } from '@/app/api/organizer/submit-verification/route'
import { POST as resetRoute } from '@/app/api/organizer/reset-verification/route'
import { POST as reviewRoute } from '@/app/api/admin/review-verification/route'
import { POST as verifyOrganizerRoute } from '@/app/api/admin/verify-organizer/route'
import { decideIdentityStatus, getIdentityStatus, isOwnedVerificationPath } from '@/lib/kyc/identity'
import { validateStoredSubmission } from '@/lib/kyc/submission'
import { isMobileMoneyNumberOtpVerified, updatePayoutProfileConfig } from '@/lib/firestore/payout'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import { submitVerificationForReview, restartVerification } from '@/lib/verification'
import { blankVerificationSteps } from '@/lib/kyc/request-template'

const UID = 'org1'
const FRONT = `verification/${UID}/id_front_1_a.jpg`
const BACK = `verification/${UID}/id_back_1_a.jpg`
const SELFIE = `verification/${UID}/selfie_1_a.jpg`

function req(body: any = {}) {
  return { json: async () => body } as any
}
function seedRequest(status: string, files?: Doc) {
  store[`verification_requests/${UID}`] = {
    userId: UID,
    status,
    steps: blankVerificationSteps(),
    files: files ?? { governmentId: { front: FRONT, back: BACK }, selfie: { path: SELFIE } },
  }
  ;[FRONT, BACK, SELFIE].forEach((p) => objects.add(p))
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  for (const k of Object.keys(clientDocs)) delete clientDocs[k]
  objects.clear()
  deleted.length = 0
  session.user = { id: UID, email: 'org@example.com' }
})

describe('submit-verification route', () => {
  it('submits the STORED paths, ignores client URLs, and mirrors pending_review', async () => {
    seedRequest('in_progress')
    const res = await submitRoute(req({ userId: UID, idFrontUrl: 'https://evil.example/other-id.jpg' }))
    expect(res.status).toBe(200)
    const doc = store[`verification_requests/${UID}`]!
    expect(doc.status).toBe('pending_review')
    expect(doc.files.governmentId.front).toBe(FRONT)
    expect(JSON.stringify(doc)).not.toContain('evil.example')
    expect(store[`users/${UID}`]).toMatchObject({ is_verified: false, verification_status: 'pending_review' })
  })

  it('accepts a resubmission from changes_requested', async () => {
    seedRequest('changes_requested')
    expect((await submitRoute(req())).status).toBe(200)
    expect(store[`verification_requests/${UID}`]!.status).toBe('pending_review')
  })

  it('is refused once approved (L3: no silent downgrade, is_verified untouched)', async () => {
    seedRequest('approved')
    store[`users/${UID}`] = { is_verified: true, verification_status: 'approved' }
    const res = await submitRoute(req())
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('already_verified')
    expect(store[`verification_requests/${UID}`]!.status).toBe('approved')
    expect(store[`users/${UID}`]!.is_verified).toBe(true)
  })

  it('is refused while already under review, and for a rejected request', async () => {
    seedRequest('pending_review')
    expect((await submitRoute(req())).status).toBe(409)
    seedRequest('rejected')
    expect((await (await submitRoute(req())).json()).code).toBe('restart_required')
  })

  it('refuses a stored path outside verification/{uid}/ and a missing object', async () => {
    seedRequest('in_progress', {
      governmentId: { front: 'verification/someone-else/id.jpg', back: BACK },
      selfie: { path: SELFIE },
    })
    expect((await (await submitRoute(req())).json()).code).toBe('invalid_document_path')

    seedRequest('in_progress')
    objects.delete(SELFIE)
    expect((await (await submitRoute(req())).json()).code).toBe('document_missing')
  })

  it('refuses another user id in the body', async () => {
    seedRequest('in_progress')
    expect((await submitRoute(req({ userId: 'someone-else' }))).status).toBe(401)
  })
})

describe('validateStoredSubmission', () => {
  it('a passport needs no back; any other ID does (L11)', () => {
    const passport = { status: 'in_progress', files: { governmentId: { front: FRONT, documentType: 'passport' }, selfie: { path: SELFIE } } }
    expect(validateStoredSubmission(passport, UID)).toMatchObject({ ok: true })
    const nationalId = { status: 'in_progress', files: { governmentId: { front: FRONT, documentType: 'national_id' }, selfie: { path: SELFIE } } }
    expect(validateStoredSubmission(nationalId, UID)).toMatchObject({ ok: false, code: 'documents_required' })
  })

  it('isOwnedVerificationPath accepts only verification/{uid}/{file}', () => {
    expect(isOwnedVerificationPath(FRONT, UID)).toBe(true)
    expect(isOwnedVerificationPath(`verification/${UID}/../x/y.jpg`, UID)).toBe(false)
    expect(isOwnedVerificationPath(`verification/${UID}/a/b.jpg`, UID)).toBe(false)
    expect(isOwnedVerificationPath('https://firebasestorage.googleapis.com/x', UID)).toBe(false)
    expect(isOwnedVerificationPath('verification/other/x.jpg', UID)).toBe(false)
  })
})

describe('reset-verification route (restart)', () => {
  it('restarts from changes_requested: blank draft, old uploads removed server-side', async () => {
    seedRequest('changes_requested')
    store[`verification_requests/${UID}`]!.reviewNotes = 'blurry'
    const res = await resetRoute(req())
    expect(res.status).toBe(200)
    const doc = store[`verification_requests/${UID}`]!
    expect(doc.status).toBe('in_progress')
    expect(doc.files).toEqual({})
    expect(doc.reviewNotes).toBeNull()
    expect(doc.restartedFrom).toBe('changes_requested')
    expect(deleted.sort()).toEqual([BACK, FRONT, SELFIE].sort())
  })

  it('restarts from rejected', async () => {
    seedRequest('rejected')
    expect((await resetRoute(req())).status).toBe(200)
    expect(store[`verification_requests/${UID}`]!.status).toBe('in_progress')
  })

  it('never restarts an approved request or one under review', async () => {
    seedRequest('approved')
    expect((await resetRoute(req())).status).toBe(409)
    seedRequest('pending_review')
    expect((await resetRoute(req())).status).toBe(409)
    expect(deleted).toEqual([])
  })
})

describe('web lib/verification.ts', () => {
  const fetchMock = jest.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) })
    ;(global as any).fetch = fetchMock
  })

  it('submit POSTs to /api/organizer/submit-verification with the ID token (no client status write)', async () => {
    const steps = blankVerificationSteps() as any
    for (const k of ['organizerInfo', 'governmentId', 'selfie']) steps[k].status = 'complete'
    clientDocs[`verification_requests/${UID}`] = { userId: UID, status: 'in_progress', steps, files: {} }

    await submitVerificationForReview(UID)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/organizer/submit-verification')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer id-token')
    expect(JSON.parse(init.body)).toEqual({ userId: UID })
  })

  it('submit does not call the server while required steps are incomplete', async () => {
    clientDocs[`verification_requests/${UID}`] = { userId: UID, status: 'in_progress', steps: blankVerificationSteps(), files: {} }
    await expect(submitVerificationForReview(UID)).rejects.toThrow(/required steps/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces the server refusal (e.g. already verified)', async () => {
    const steps = blankVerificationSteps() as any
    for (const k of ['organizerInfo', 'governmentId', 'selfie']) steps[k].status = 'complete'
    clientDocs[`verification_requests/${UID}`] = { userId: UID, status: 'approved', steps, files: {} }
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'Your identity is already verified.', code: 'already_verified' }) })
    await expect(submitVerificationForReview(UID)).rejects.toMatchObject({ code: 'already_verified' })
  })

  it('restart POSTs to /api/organizer/reset-verification', async () => {
    await restartVerification(UID)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/organizer/reset-verification')
  })
})

describe('review-verification route', () => {
  const ADMIN = { id: 'admin1', email: 'admin@example.com' }

  it('cannot approve a draft (in_progress)', async () => {
    seedRequest('in_progress')
    session.user = ADMIN
    const res = await reviewRoute(req({ requestId: UID, status: 'approved' }))
    expect(res.status).toBe(409)
    expect(store[`verification_requests/${UID}`]!.status).toBe('in_progress')
  })

  it('an admin cannot approve their own verification', async () => {
    seedRequest('pending_review')
    session.user = { id: UID, email: 'org@example.com' }
    const res = await reviewRoute(req({ requestId: UID, status: 'approved' }))
    expect(res.status).toBe(403)
    expect(store[`verification_requests/${UID}`]!.status).toBe('pending_review')
  })

  it('approves a submitted request and moves the flags in the same decision', async () => {
    seedRequest('pending_review')
    session.user = ADMIN
    const res = await reviewRoute(req({ requestId: UID, status: 'approved' }))
    expect(res.status).toBe(200)
    expect(store[`users/${UID}`]).toMatchObject({ is_verified: true, verification_status: 'approved' })
    expect(store[`organizers/${UID}`]).toMatchObject({ is_verified: true })
    expect(await getIdentityStatus(UID)).toBe('verified')
  })
})

describe('identity definition (lib/kyc/identity.ts)', () => {
  it('decideIdentityStatus', () => {
    expect(decideIdentityStatus({ request: { status: 'approved' }, user: { is_verified: true }, organizer: null })).toBe('verified')
    expect(decideIdentityStatus({ request: { status: 'approved' }, user: { is_verified: false }, organizer: null })).toBe('none')
    expect(decideIdentityStatus({ request: { status: 'approved' }, user: null, organizer: { is_verified: false } })).toBe('none')
    expect(decideIdentityStatus({ request: null, user: { is_verified: true, verification_status: 'approved' }, organizer: { is_verified: true } })).toBe('none')
    expect(decideIdentityStatus({ request: { status: 'pending_review' }, user: null, organizer: null })).toBe('pending')
    expect(decideIdentityStatus({ request: { status: 'changes_requested' }, user: null, organizer: null })).toBe('changes_requested')
    expect(decideIdentityStatus({ request: { status: 'rejected' }, user: null, organizer: null })).toBe('rejected')
    expect(decideIdentityStatus({ request: { status: 'in_progress' }, user: null, organizer: null })).toBe('none')
  })

  it('a verificationDocuments/identity doc no longer verifies anyone', async () => {
    store[`organizers/${UID}/verificationDocuments/identity`] = { status: 'verified' }
    store[`users/${UID}`] = { is_verified: true }
    store[`organizers/${UID}/payoutProfiles/haiti`] = { method: 'mobile_money', mobileMoneyDetails: { phoneNumber: '****7294' } }
    expect(await getIdentityStatus(UID)).toBe('none')
    const profile = await getPayoutProfile(UID, 'haiti')
    expect(profile?.verificationStatus?.identity).toBe('pending')
    expect(profile?.status).toBe('pending_verification')
  })

  it('finds a legacy request whose doc id is not the uid', async () => {
    store['verification_requests/legacy-doc'] = { user_id: UID, status: 'approved' }
    expect(await getIdentityStatus(UID)).toBe('verified')
  })

  it('after an admin un-verifies, payouts stop being active', async () => {
    seedRequest('approved')
    store[`users/${UID}`] = { is_verified: true, role: 'organizer', verification_status: 'approved' }
    store[`organizers/${UID}`] = { is_verified: true }
    store[`organizers/${UID}/payoutProfiles/haiti`] = { method: 'mobile_money', mobileMoneyDetails: { phoneNumber: '****7294' } }
    expect((await getPayoutProfile(UID, 'haiti'))?.status).toBe('active')

    session.user = { id: 'admin1', email: 'admin@example.com' }
    const res = await verifyOrganizerRoute(req({ organizerId: UID, isVerified: false }))
    expect(res.status).toBe(200)
    expect(await getIdentityStatus(UID)).not.toBe('verified')
    expect((await getPayoutProfile(UID, 'haiti'))?.status).toBe('pending_verification')

    // Re-instating is possible only because the reviewed evidence is unchanged.
    expect((await verifyOrganizerRoute(req({ organizerId: UID, isVerified: true }))).status).toBe(200)
    expect(await getIdentityStatus(UID)).toBe('verified')
  })

  it('verify-organizer cannot verify someone with no approved request with documents', async () => {
    store[`users/${UID}`] = { role: 'organizer' }
    session.user = { id: 'admin1', email: 'admin@example.com' }
    const res = await verifyOrganizerRoute(req({ organizerId: UID, isVerified: true }))
    expect(res.status).toBe(409)
    expect(await getIdentityStatus(UID)).toBe('none')
    expect(store[`users/${UID}`]!.is_verified).not.toBe(true)
  })
})

describe('first Haiti payout destination after KYC (M4)', () => {
  const MM = { method: 'mobile_money' as const, mobileMoneyDetails: { provider: 'moncash', phoneNumber: '37007294', accountName: 'Jean Pierre' } }

  it('requires the email step-up and starts the 24h hold for a verified organizer', async () => {
    seedRequest('approved')
    store[`users/${UID}`] = { is_verified: true }

    const refused = await updatePayoutProfileConfig(UID, 'haiti', MM)
    expect(refused.success).toBe(false)
    expect(refused.error).toContain('PAYOUT_CHANGE_VERIFICATION_REQUIRED')
    expect(store[`organizers/${UID}/payoutProfiles/haiti`]).toBeUndefined()

    store[`organizers/${UID}/security/payoutDetailsChangeVerification`] = {
      verifiedUntil: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }
    const ok = await updatePayoutProfileConfig(UID, 'haiti', MM)
    expect(ok.success).toBe(true)
    const saved = store[`organizers/${UID}/payoutProfiles/haiti`]!
    expect(saved.status).toBe('on_hold')
    const holdMs = Date.parse(saved.payoutHoldUntil) - Date.now()
    expect(holdMs).toBeGreaterThan(23 * 3600 * 1000)
    // The step-up token is consumed.
    expect(store[`organizers/${UID}/security/payoutDetailsChangeVerification`]!.verifiedUntil).toBeNull()
  })

  it('stays frictionless before KYC (no withdrawal is possible yet)', async () => {
    const ok = await updatePayoutProfileConfig(UID, 'haiti', MM)
    expect(ok.success).toBe(true)
    expect(store[`organizers/${UID}/payoutProfiles/haiti`]!.status).toBeUndefined()
  })
})

describe('MonCash OTP verdict (mobileMoneyOtpVerified)', () => {
  const profile = { mobileMoneyDetails: { phoneNumberFingerprint: 'fp', phoneNumberFingerprintSetAt: '2026-10-01T00:00:00.000Z' } } as any

  it('true only for a code confirmed after the current number was saved', () => {
    expect(isMobileMoneyNumberOtpVerified(profile, { status: 'verified', verifiedAt: '2026-10-02T00:00:00.000Z' })).toBe(true)
    expect(isMobileMoneyNumberOtpVerified(profile, { status: 'verified', verifiedAt: '2026-09-30T00:00:00.000Z' })).toBe(false)
    expect(isMobileMoneyNumberOtpVerified(profile, { status: 'pending' })).toBe(false)
    expect(isMobileMoneyNumberOtpVerified({ mobileMoneyDetails: {} } as any, { status: 'verified', verifiedAt: '2026-10-02T00:00:00.000Z' })).toBe(false)
  })

  it('changing the number resets a verified phone doc and getPayoutProfile reports it', async () => {
    store[`organizers/${UID}/payoutProfiles/haiti`] = {
      method: 'mobile_money',
      mobileMoneyDetails: { phoneNumber: '****7294', phoneNumberFingerprint: 'old', phoneNumberFingerprintSetAt: '2026-01-01T00:00:00.000Z' },
    }
    store[`organizers/${UID}/verificationDocuments/phone`] = { status: 'verified', verifiedAt: '2026-02-01T00:00:00.000Z' }
    expect((await getPayoutProfile(UID, 'haiti'))?.mobileMoneyOtpVerified).toBe(true)

    store[`organizers/${UID}/security/payoutDetailsChangeVerification`] = {
      verifiedUntil: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }
    const ok = await updatePayoutProfileConfig(UID, 'haiti', {
      mobileMoneyDetails: { provider: 'moncash', phoneNumber: '38117294', accountName: 'Jean Pierre' },
    })
    expect(ok.success).toBe(true)
    expect(store[`organizers/${UID}/verificationDocuments/phone`]!.status).toBe('pending')
    expect((await getPayoutProfile(UID, 'haiti'))?.mobileMoneyOtpVerified).toBe(false)
  })

  it('a client cannot send mobileMoneyOtpVerified', async () => {
    await updatePayoutProfileConfig(UID, 'haiti', { mobileMoneyOtpVerified: true } as any)
    expect(store[`organizers/${UID}/payoutProfiles/haiti`]?.mobileMoneyOtpVerified).toBeUndefined()
  })
})

describe('storage.rules — KYC uploads (static)', () => {
  const rules = readFileSync(join(__dirname, '..', 'storage.rules'), 'utf8')
  const start = rules.indexOf('match /verification/{userId}/{fileName}')
  const block = rules.slice(start, rules.indexOf('// User profile images', start))

  it('is create-only: no client overwrite or delete', () => {
    expect(start).toBeGreaterThan(-1)
    expect(block).toContain('allow create:')
    expect(block).toContain('allow update, delete: if false;')
    const all = rules.slice(rules.indexOf('match /verification/{userId}/{allPaths=**}'), start)
    expect(all).not.toMatch(/allow (write|create|update|delete)/)
  })

  it('allows only listed image types (no SVG) and the liveness video types', () => {
    expect(block).toContain("matches('image/(jpeg|png|webp|heic|heif)')")
    expect(block).toContain("matches('video/(mp4|quicktime)')")
    expect(block).not.toMatch(/image\/\.\*|video\/\.\*|svg|application\/pdf/)
    expect(block).toContain("fileName.matches('liveness_[^/]+')")
  })
})
