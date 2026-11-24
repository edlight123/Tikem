/**
 * Reactions and quoted replies on conversation messages. Mirrors
 * lib/messages/threadExtras.ts on the server (a parity test keeps the
 * allow-list in step: __tests__/message-thread-extras.test.ts).
 */
import { Platform } from 'react-native';

/** The only reactions offered. */
export const REACTIONS = ['❤️', '👍', '😂', '😮', '🙏', '🔥'] as const;
export type Reaction = (typeof REACTIONS)[number];

/** Double-tapping a bubble toggles this one. */
export const QUICK_REACTION: Reaction = '❤️';

export type ReactionSummary = { emoji: Reaction; count: number; mine: boolean };

export type ReplyTo = { id: string; excerpt: string; author_role: 'attendee' | 'organizer' };

/** The strings these pieces need (messageExtras.* in the dictionaries). */
export type MessageStrings = {
  reply: string;
  copy: string;
  report: string;
  close: string;
  cancelReply: string;
  /** "{name}" filled by the caller. */
  replyingTo: string;
  /** "{emoji}" filled by the caller. */
  react: string;
  /** "{emoji}" and "{count}" filled by the caller. */
  reactionCount: string;
};

export function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

/** First non-empty line, flattened, clipped (the composer preview). */
export function firstLine(text: string, max = 120): string {
  const line = (text || '').split(/\r?\n/).find((l) => l.trim()) || '';
  const flat = line.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : flat;
}

/** Optimistic toggle, same rule as the server: same emoji again removes it. */
export function toggleLocal(current: ReactionSummary[] | undefined, emoji: Reaction): ReactionSummary[] {
  const list = (current || []).map((r) => ({ ...r }));
  const prevMine = list.find((r) => r.mine);
  if (prevMine) {
    prevMine.count -= 1;
    prevMine.mine = false;
  }
  if (prevMine?.emoji !== emoji) {
    const target = list.find((r) => r.emoji === emoji);
    if (target) {
      target.count += 1;
      target.mine = true;
    } else {
      list.push({ emoji, count: 1, mine: true });
    }
  }
  return REACTIONS.map((e) => list.find((r) => r.emoji === e && r.count > 0)).filter(
    (r): r is ReactionSummary => !!r,
  );
}

/**
 * Android (Samsung especially) measures a Text run a hair narrower than the
 * colour-emoji glyphs it then draws, so the LAST emoji of a line was clipped.
 * A trailing hair space (U+200A) makes the measured width cover the whole final
 * glyph; pair it with textBreakStrategy="simple" and a 1pt end padding. iOS
 * measures correctly and gets the text unchanged.
 */
export function emojiSafe(text: string): string {
  return Platform.OS === 'android' && text ? `${text} ` : text;
}

/**
 * Reduce Motion, live: the phone's setting or Profile > Accessibility >
 * Reduce motion "always" (lib/a11y).
 */
export { useReducedMotion } from '../../lib/a11y';
