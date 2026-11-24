/**
 * Static guards (rules source, no emulator) for community-shared events
 * (lib/community): the credit, source link and claim fields are Admin SDK
 * only on events, the submission and claim collections take no client access
 * (default deny), and claim proofs are a private, create-only storage folder.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COMMUNITY_LOCKED_FIELDS } from '@/lib/community/submissions'

const rules = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8')
const start = rules.indexOf('match /events/{eventId} {')
const events = rules.slice(start, rules.indexOf('\n    match /', start + 10))
const create = events.slice(events.indexOf('allow create'), events.indexOf('allow update'))
const update = events.slice(events.indexOf('allow update'))
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('community fields on events', () => {
  it('covers the fields the brief names', () => {
    for (const f of ['community_shared', 'source_url', 'claimable', 'source_name', 'claimed_by']) {
      expect(COMMUNITY_LOCKED_FIELDS).toContain(f)
    }
  })
  it.each([...COMMUNITY_LOCKED_FIELDS])('a client cannot set %s when creating an event', (f) => {
    expect(create).toMatch(new RegExp(`request\\.resource\\.data\\.get\\('${esc(f)}', (false|null)\\) == (false|null)`))
  })
  it.each([...COMMUNITY_LOCKED_FIELDS])('a client cannot change %s when updating an event', (f) => {
    expect(update).toMatch(
      new RegExp(`request\\.resource\\.data\\.get\\('${esc(f)}', (false|null)\\) == resource\\.data\\.get\\('${esc(f)}', (false|null)\\)`)
    )
  })
  it('keeps ownership and the ticket link-out server-side too', () => {
    expect(update).toContain("request.resource.data.get('organizer_id', null) == resource.data.organizer_id")
    expect(create).toContain("request.resource.data.get('external_url', null) == null")
  })
})

describe('server-only collections', () => {
  it('submissions and claims fall to the default deny', () => {
    for (const c of ['event_submissions', 'event_claims']) expect(rules).not.toContain(`match /${c}/`)
    expect(rules).toMatch(/match \/\{document=\*\*\} \{\s*allow read, write: if false;/)
  })
})

describe('storage.rules: claim proofs', () => {
  const storage = readFileSync(join(__dirname, '..', 'storage.rules'), 'utf8')
  const at = storage.indexOf('match /claim-proofs/{userId}/{fileName} {')
  const block = storage.slice(at, storage.indexOf('\n    }', at))

  it('exists and is never readable or listable by a client', () => {
    expect(at).toBeGreaterThan(-1)
    expect(block).toContain('allow read: if false;')
    expect(block).not.toMatch(/allow (get|list)/)
    expect(storage).not.toMatch(/match \/claim-proofs\/\{[^}]+\}\/\{allPaths=\*\*\}/)
  })
  it('is create-only for the signed-in owner, images or PDF, at most 10 MB', () => {
    expect(block).toContain('request.auth != null && request.auth.uid == userId')
    expect(block).toContain('resource == null')
    expect(block).toContain('request.resource.size <= 10 * 1024 * 1024')
    expect(block).toContain("matches('image/(jpeg|png|webp|heic|heif|gif)|application/pdf')")
    expect(block).not.toMatch(/svg/)
    expect(block).toContain('allow update, delete: if false;')
    expect(block).not.toMatch(/allow write/)
  })
  it('the catch-all still denies everything', () => {
    expect(storage).toMatch(/match \/\{allPaths=\*\*\} \{\s*allow read, write: if false;/)
  })
})
