/**
 * Create Event drafts are saved on the phone per signed-in account and must be
 * wiped on sign-out: the composer's key prefix has to be one AuthContext clears,
 * and the plaintext access code is never written.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const read = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8')

describe('mobile Create Event draft scope', () => {
  const composer = read('mobile/screens/organizer/CreateEventFlowRefactored.tsx')
  const auth = read('mobile/contexts/AuthContext.tsx')
  const prefix = composer.match(/export const EVENT_DRAFT_PREFIX = '([^']+)'/)?.[1]

  it('declares a draft key prefix', () => {
    expect(prefix).toBeTruthy()
  })

  it('is cleared on sign-out (USER_SCOPED_PREFIXES)', () => {
    const block = auth.match(/const USER_SCOPED_PREFIXES = \[([\s\S]*?)\];/)?.[1] || ''
    expect(block).toContain(`'${prefix}'`)
  })

  it('keys drafts by account and by event, and checks the owner on restore', () => {
    expect(composer).toMatch(/\$\{EVENT_DRAFT_PREFIX\}\$\{draftOwner \|\| 'anon'\}_\$\{isEditMode \? eventId : 'new'\}/)
    expect(composer).toContain('saved?.owner === draftOwner')
  })

  it('never stores the access code and never clears all of AsyncStorage', () => {
    expect(composer).toContain("access_code: ''")
    expect(composer).not.toContain('AsyncStorage.clear(')
  })
})
