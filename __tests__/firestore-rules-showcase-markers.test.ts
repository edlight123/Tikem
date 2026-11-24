/**
 * Showcase / sample events carry `seed_batch`, written only by the seed
 * scripts on the Admin SDK (scripts/seed-*-showcase-events.mjs). Their
 * --delete / --revert modes, the feed's template filter (lib/home/feed) and the
 * post-event follow-ups (lib/postEvent) all match on it, so it must be
 * client-immutable: no client create may set it, no client update may add,
 * change or strip it.
 *
 * Reads the rules SOURCE (no emulator here), like the other rules tests.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = join(__dirname, '..')
const rules = readFileSync(join(root, 'firestore.rules'), 'utf8')

function eventsBlock(): { create: string; update: string } {
  const start = rules.indexOf('match /events/{eventId}')
  expect(start).toBeGreaterThan(-1)
  const createAt = rules.indexOf('allow create:', start)
  const updateAt = rules.indexOf('allow update:', createAt)
  const afterUpdate = rules.indexOf('allow delete:', updateAt)
  expect(createAt).toBeGreaterThan(start)
  expect(updateAt).toBeGreaterThan(createAt)
  expect(afterUpdate).toBeGreaterThan(updateAt)
  return { create: rules.slice(createAt, updateAt), update: rules.slice(updateAt, afterUpdate) }
}

describe('firestore.rules: showcase markers are server-only', () => {
  const { create, update } = eventsBlock()

  it('a client create cannot set seed_batch', () => {
    expect(create).toMatch(/request\.resource\.data\.get\('seed_batch', null\) == null/)
  })

  it('a client update cannot add, change or remove seed_batch', () => {
    expect(update).toMatch(
      /request\.resource\.data\.get\('seed_batch', null\) == resource\.data\.get\('seed_batch', null\)/
    )
  })

  it('uses .get() so legacy events without the field stay writable', () => {
    // Bare resource.data.seed_batch on a missing field would deny every write.
    expect(create + update).not.toMatch(/resource\.data\.seed_batch\b/)
  })

  it('no client bundle writes seed_batch', () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'Pods' || name === 'ios' || name === 'android' || name.startsWith('.')) continue
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p, out)
        else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(p)
      }
      return out
    }
    const clientFiles = [
      ...walk(join(root, 'mobile')),
      ...walk(join(root, 'components')),
      ...walk(join(root, 'app')).filter((f) => !relative(root, f).startsWith('app/api/')),
    ]
    const writers = clientFiles.filter((f) => /seed_batch\s*:/.test(readFileSync(f, 'utf8')))
    expect(writers.map((f) => relative(root, f))).toEqual([])
  })
})
