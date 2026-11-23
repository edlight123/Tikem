/**
 * lib/messages/threadExtras: the pure reaction and quote helpers, and parity
 * with the app's copy of the allow-list (mobile/components/messages/types.ts).
 */
import fs from 'fs'
import path from 'path'
import {
  ALLOWED_REACTIONS,
  clipExcerpt,
  isAllowedReaction,
  readReplyToId,
  readStoredReplyTo,
  sanitizeReactionMap,
  summarizeReactions,
  toggleReaction,
} from '@/lib/messages/threadExtras'

describe('reactions', () => {
  it('accepts only the allow-list', () => {
    expect(isAllowedReaction('❤️')).toBe(true)
    expect(isAllowedReaction('💩')).toBe(false)
    expect(isAllowedReaction(1)).toBe(false)
    expect(sanitizeReactionMap({ a: '❤️', b: '💩', '': '👍', c: 3 })).toEqual({ a: '❤️' })
    expect(sanitizeReactionMap(['❤️'])).toEqual({})
  })

  it('toggles: same emoji removes, a different one replaces', () => {
    let r = toggleReaction({}, 'u1', '❤️')
    expect(r).toEqual({ reactions: { u1: '❤️' }, mine: '❤️' })
    r = toggleReaction(r.reactions, 'u1', '🔥')
    expect(r).toEqual({ reactions: { u1: '🔥' }, mine: '🔥' })
    r = toggleReaction(r.reactions, 'u1', '🔥')
    expect(r).toEqual({ reactions: {}, mine: null })
  })

  it('summarizes as counts in allow-list order, never who', () => {
    const out = summarizeReactions({ a: '🔥', b: '❤️', c: '❤️' }, 'c')
    expect(out).toEqual([
      { emoji: '❤️', count: 2, mine: true },
      { emoji: '🔥', count: 1, mine: false },
    ])
    expect(JSON.stringify(out)).not.toMatch(/"a"|"b"|"c"/)
  })

  it('matches the app copy of the allow-list', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobile/components/messages/types.ts'), 'utf8')
    const m = src.match(/REACTIONS = \[([^\]]+)\]/)
    expect(m).not.toBeNull()
    const app = m![1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
    expect(app).toEqual([...ALLOWED_REACTIONS])
  })
})

describe('quotes', () => {
  it('clips to the first non-empty line, emoji-safe', () => {
    expect(clipExcerpt('\n  Hello   there \nsecond')).toBe('Hello there')
    const long = '🎉'.repeat(200)
    const out = clipExcerpt(long, 10)
    expect(Array.from(out)).toHaveLength(10)
    expect(out.endsWith('…')).toBe(true)
  })

  it('reads the quoted id: undefined when absent, null when malformed', () => {
    expect(readReplyToId({})).toBeUndefined()
    expect(readReplyToId({ reply_to_id: '' })).toBeUndefined()
    expect(readReplyToId({ reply_to_id: 'abc_1' })).toBe('abc_1')
    expect(readReplyToId({ reply_to: { id: 'opening' } })).toBe('opening')
    expect(readReplyToId({ reply_to_id: 'a/b' })).toBeNull()
    expect(readReplyToId({ reply_to_id: 42 })).toBeNull()
  })

  it('re-validates a stored quote on read', () => {
    expect(readStoredReplyTo({ id: 'x/y', excerpt: 'a' })).toBeUndefined()
    expect(readStoredReplyTo({ id: 'r1', excerpt: 'hi', author_role: 'weird' })).toEqual({
      id: 'r1',
      excerpt: 'hi',
      author_role: 'attendee',
    })
  })
})
