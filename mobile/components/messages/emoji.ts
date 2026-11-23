/**
 * Emoji-only messages ("jumbomoji"): one to three emoji on their own render
 * large without a bubble, like iMessage and WhatsApp. Pure, no React Native, so
 * it is testable from the root jest run.
 */

/** Code points that combine with or decorate a pictograph rather than standing alone. */
function isJoiner(cp: number): boolean {
  return (
    cp === 0x200d || // zero-width joiner (family sequences)
    cp === 0xfe0f || // emoji presentation
    cp === 0xfe0e || // text presentation
    cp === 0x20e3 || // keycap
    cp === 0x200a || // the hair space emojiSafe appends on Android
    (cp >= 0x1f3fb && cp <= 0x1f3ff) || // skin tones
    (cp >= 0xe0020 && cp <= 0xe007f) // tag sequences (flags of England, Scotland, Wales)
  );
}

/** Code points that are emoji pictographs in their own right. */
function isPictograph(cp: number): boolean {
  return (
    (cp >= 0x1f000 && cp <= 0x1faff) || // most emoji, regional indicator flags
    (cp >= 0x2600 && cp <= 0x27bf) || // misc symbols, dingbats
    (cp >= 0x2b00 && cp <= 0x2bff) || // star, arrows, heavy circle
    (cp >= 0x2300 && cp <= 0x23ff) || // watch, alarm clock, hourglass
    (cp >= 0x2190 && cp <= 0x21ff) || // arrows
    (cp >= 0x25aa && cp <= 0x25fe) || // play, squares
    (cp >= 0x2934 && cp <= 0x2935) ||
    cp === 0x00a9 ||
    cp === 0x00ae ||
    cp === 0x203c ||
    cp === 0x2049 ||
    cp === 0x2122 ||
    cp === 0x2139 ||
    cp === 0x24c2 ||
    cp === 0x3030 ||
    cp === 0x303d ||
    cp === 0x3297 ||
    cp === 0x3299
  );
}

/**
 * How many emoji a message is made of when it is ONLY emoji (and spaces),
 * else 0. A joined family, a skin-toned hand or a flag counts as one.
 */
export function emojiOnlyCount(text: string | null | undefined): number {
  const trimmed = (text || '').trim();
  if (!trimmed) return 0;
  let count = 0;
  let afterJoiner = false;
  let regionalHalf = false;
  for (const ch of trimmed) {
    const cp = ch.codePointAt(0)!;
    if (/\s/.test(ch)) {
      afterJoiner = false;
      regionalHalf = false;
      continue;
    }
    if (isJoiner(cp)) {
      afterJoiner = cp === 0x200d;
      continue;
    }
    if (!isPictograph(cp)) return 0;
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) {
      // A flag is two regional indicators: count the pair once.
      if (!regionalHalf) count += 1;
      regionalHalf = !regionalHalf;
    } else if (!afterJoiner) {
      count += 1;
      regionalHalf = false;
    }
    afterJoiner = false;
  }
  return count;
}

/** Up to this many emoji on their own render large, without a bubble. */
export const JUMBO_MAX = 3;

/** True when the message is 1 to JUMBO_MAX emoji and nothing else. */
export function isJumboEmoji(text: string | null | undefined): boolean {
  const n = emojiOnlyCount(text);
  return n >= 1 && n <= JUMBO_MAX;
}
