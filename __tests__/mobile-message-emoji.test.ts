/**
 * Emoji-only messages (one to three emoji render large, without a bubble):
 * mobile/components/messages/emoji.ts.
 */
import { emojiOnlyCount, isJumboEmoji } from '../mobile/components/messages/emoji'

describe('emojiOnlyCount', () => {
  it('counts a run of emoji', () => {
    expect(emojiOnlyCount('🎊💯🤠🤩⭐')).toBe(5)
  })
  it('counts joined sequences, skin tones and flags once', () => {
    expect(emojiOnlyCount('👩‍👩‍👧')).toBe(1)
    expect(emojiOnlyCount('👍🏽')).toBe(1)
    expect(emojiOnlyCount('🇭🇹🇨🇦')).toBe(2)
    expect(emojiOnlyCount('❤️')).toBe(1)
  })
  it('ignores surrounding spaces and the Android hair space', () => {
    expect(emojiOnlyCount('  😂 😂 ')).toBe(2)
    expect(emojiOnlyCount('🔥 ')).toBe(1)
  })
  it('is 0 for text or mixed messages', () => {
    expect(emojiOnlyCount('')).toBe(0)
    expect(emojiOnlyCount(null)).toBe(0)
    expect(emojiOnlyCount('hi 👋')).toBe(0)
    expect(emojiOnlyCount('Mèsi!')).toBe(0)
    expect(emojiOnlyCount('2')).toBe(0)
  })
})

describe('isJumboEmoji', () => {
  it('is true for one to three emoji only', () => {
    expect(isJumboEmoji('🇭🇹')).toBe(true)
    expect(isJumboEmoji('🔥🔥🔥')).toBe(true)
    expect(isJumboEmoji('🔥🔥🔥🔥')).toBe(false)
    expect(isJumboEmoji('ok 🔥')).toBe(false)
    expect(isJumboEmoji('')).toBe(false)
  })
})
