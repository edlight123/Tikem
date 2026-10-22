/**
 * /vision loading skeleton.
 *
 * There wasn't one. `app/vision/` held only `page.tsx`, so every navigation to
 * /vision fell through to the nearest ancestor boundary — `app/loading.tsx`,
 * the HOMEPAGE skeleton. The reader got the giant SAK / PASE? hero and a film
 * strip of poster cards, and then the whole thing was replaced by a page of
 * editorial prose. Not a missing skeleton: a skeleton for a different page.
 *
 * Built from measurements of the live page rather than from memory, so nothing
 * moves when the real page lands. The section containers below are the REAL
 * page's classes (same `border-t`, same `py-14 sm:py-20`, same `max-w-6xl
 * px-4`), and only the text is replaced by bars of the measured line heights —
 * which is why the section totals come out on the nose.
 *
 * Measured, 402px — navbar 57 (h-14 + the 1px bottom rule; /vision does NOT
 *   pass `flush` to Navbar) · hero 428 at y57 · problem 418 at y485 ·
 *   principles 1420 at y903 (ol 1246: five items 257/257/257/236/235) ·
 *   cities 288 at y2323 · closing 343 at y2611 · footer at y2954.
 * Measured, 1280px — navbar 65 · hero 630 at y65 · problem 461 at y695 ·
 *   principles 1359 at y1156 (ol 1141) · cities 384 at y2514 ·
 *   closing 448 at y2898 · footer at y3347.
 *
 * Two repo-specific traps are baked into the numbers above, so don't "correct"
 * them from the page source:
 *
 * 1. `.mobile-typography` (app/globals.css, max-width 640px) forces h3 to
 *    text-base and p/li to text-sm. /vision's `!important` clamps (h1, the
 *    section h2s, the hero sub) survive it; its plain arbitrary sizes do not.
 *    So under 640px the eyebrow renders at 14px/21 and not text-[11px], the
 *    principle headings at 16px/20 and not text-[19px], and the city names at
 *    14px/21 and not clamp(20px,3.4vw,34px). The bars follow the measurement.
 * 2. `pb-mobile-nav` reserves `--mobile-nav-h`, which is 0 unless
 *    `body[data-mobile-nav]` is set and the viewport is under 768px. The real
 *    page carries the same class, so the skeleton reserves exactly what the
 *    page will — nothing at all for a signed-out reader.
 */

import type { CSSProperties } from 'react'

function Bar({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <div className={`skeleton rounded ${className}`} style={style} />
}

/**
 * A paragraph as skeleton lines. `n` is the phone's line count and `sm` the
 * count from 640px up: the same copy reflows hard between the two (a problem
 * paragraph goes 4 lines → 2, a principle body 7 → 4), and a stack that kept
 * the phone's count on desktop would shove everything under it down the page.
 *
 * The invariant, both sides: bar + gap === one line box, so a block of n lines
 * is exactly n × line-height. n bars carry (n-1) gaps between them, so the
 * container adds the last line's leading back as padding — which is also what
 * stops the trailing margin from collapsing out through the container.
 *
 * The phone's line boxes are fractional (27.625 for the lead paragraph, 24.375
 * for the rest), so its heights and gaps are computed and set inline rather
 * than named as Tailwind arbitrary values. That is safe here precisely because
 * the two branches are separate elements — an inline height cannot be
 * media-queried, and the phone branch is `sm:hidden`.
 *
 * `lead` is the one oversized paragraph on the page: the first of the problem
 * section, which is text-[17px]/sm:text-[19px] against everything else's 15.
 */
function Lines({ n, sm, lead = false }: { n: number; sm: number; lead?: boolean }) {
  const lh = lead ? 27.625 : 24.375
  const gap = 5
  return (
    <>
      <div className="sm:hidden" style={{ paddingBottom: gap }}>
        {Array.from({ length: n }).map((_, i) => (
          <Bar
            key={i}
            className={i === n - 1 ? 'w-1/2' : 'w-full'}
            style={{ height: lh - gap, marginTop: i === 0 ? 0 : gap }}
          />
        ))}
      </div>
      <div
        className={
          lead
            ? 'hidden space-y-1.5 pb-1.5 sm:block'
            : 'hidden space-y-[5px] pb-[5px] sm:block'
        }
      >
        {Array.from({ length: sm }).map((_, i) => (
          <Bar
            key={i}
            className={`${lead ? 'h-[25px]' : 'h-[19px]'} ${
              i === sm - 1 ? 'w-1/3' : 'w-full'
            }`}
          />
        ))}
      </div>
    </>
  )
}

/**
 * Per principle: body line counts (phone then sm — 7/4, 7/4, 7/4, 7/4, 6/3),
 * the measured phone widths of the Kreyòl heading's line boxes (the third
 * heading is the one that wraps, so it has two), and the phone width of the
 * English gloss beneath it. Widths stay literal class strings so Tailwind's
 * scanner still sees them in this file.
 */
const PRINCIPLES: { n: number; sm: number; head: string[]; gloss: string }[] = [
  { n: 7, sm: 4, head: ['w-[256px]'], gloss: 'w-[125px]' },
  { n: 7, sm: 4, head: ['w-[217px]'], gloss: 'w-[125px]' },
  { n: 7, sm: 4, head: ['w-[270px]', 'w-[50px]'], gloss: 'w-[175px]' },
  { n: 7, sm: 4, head: ['w-[254px]'], gloss: 'w-[173px]' },
  { n: 6, sm: 3, head: ['w-[169px]'], gloss: 'w-[123px]' },
]

/** City name widths, measured — phone (20px type) then 1280 (34px). */
const CITIES: [string, string][] = [
  ['w-[152px]', 'sm:w-[258px]'],
  ['w-[113px]', 'sm:w-[191px]'],
  ['w-[56px]', 'sm:w-[95px]'],
  ['w-[94px]', 'sm:w-[159px]'],
  ['w-[100px]', 'sm:w-[169px]'],
  ['w-[51px]', 'sm:w-[87px]'],
]

export default function Loading() {
  return (
    <div className="surface-dark min-h-screen pb-mobile-nav">
      {/* Navbar — h-14 / sm:h-16 WITH the bottom rule, because /vision renders
          <Navbar> without `flush`. The homepage skeleton has no rule here; this
          page does. */}
      <div className="sticky top-0 z-50 border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between sm:h-16">
            <div className="flex items-center gap-8">
              <Bar className="h-7 w-24" />
              <div className="hidden gap-6 md:flex">
                <Bar className="h-4 w-16" />
                <Bar className="h-4 w-16" />
                <Bar className="h-4 w-24" />
              </div>
            </div>
            <Bar className="h-9 w-20 rounded" />
          </div>
        </div>
      </div>

      {/* ── HERO ── 423 tall at 402px, 630 at 1280. ─────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 pb-14 pt-16 sm:px-6 sm:pb-20 sm:pt-24 lg:px-8">
        {/* eyebrow — 11px/16.5 at every width; 80 wide on a phone */}
        <Bar className="h-[16.5px] w-20 sm:h-[17px] sm:w-20" />
        {/* The hairline under the eyebrow. It is the page's one spot of teal;
            the skeleton keeps its 12+1px of space but not its colour. */}
        <div className="mt-3 h-px w-10 bg-white/10" />
        {/* h1, clamp(38px,7vw,84px): three lines, 186/352/77 wide at 402 and
            412/779/171 at 1280. Bar+gap tracks the line box — 33+8 → 115 at
            402, 74+16 → 254 at 1280. */}
        <div className="mt-6 max-w-4xl space-y-2 lg:space-y-3 xl:space-y-4">
          <Bar className="h-[33px] w-[186px] max-w-full sm:h-[39px] sm:w-[46%] lg:h-[62px] xl:h-[74px]" />
          <Bar className="h-[33px] w-[352px] max-w-full sm:h-[39px] sm:w-[87%] lg:h-[62px] xl:h-[74px]" />
          <Bar className="h-[33px] w-[77px] sm:h-[39px] sm:w-[19%] lg:h-[62px] xl:h-[74px]" />
        </div>
        {/* the Kreyòl line, clamp(18px,2.6vw,26px) — 18px/24.75 and 189 wide
            on a phone; from sm it goes back to tracking the container. */}
        <Bar className="mt-6 h-[24.75px] w-[189px] sm:h-[25px] sm:w-[68%] sm:max-w-sm md:h-[28px] lg:h-[36px] lg:max-w-md" />
        {/* Two CTAs. The bordered one is 46 tall and sets the row height. */}
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Bar className="h-[46px] w-[141px] rounded-xl" />
          <Bar className="h-[46px] w-[153px] rounded-xl" />
        </div>
      </section>

      {/* ── THE PROBLEM ── 489 at 402px, 461 at 1280. ───────────────────── */}
      <section className="border-t border-white/10">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
          {/* serif h2, clamp(26px,4vw,40px), one line: 167 wide at 402 */}
          <Bar className="h-[27.3px] w-[167px] max-w-full sm:h-[27px] sm:w-[257px] md:h-[32px] lg:h-[42px]" />
          <div className="mt-7 max-w-[62ch] space-y-5">
            <Lines n={4} sm={3} lead />
            <Lines n={4} sm={2} />
            <Lines n={3} sm={2} />
          </div>
        </div>
      </section>

      {/* ── THE PRINCIPLES ── 1601 at 402px, 1359 at 1280. Five numbered rows
             in one filled, rounded slab — a fill, not a bordered empty box. ── */}
      <section className="border-t border-white/10">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
          <Bar className="h-[16.5px] w-[129px] sm:h-[17px] sm:w-20" />
          <div className="mt-10 space-y-px overflow-hidden rounded-2xl bg-white/[0.03]">
            {PRINCIPLES.map(({ n, sm, head, gloss }, i) => (
              <div
                key={i}
                className="border-b border-white/[0.06] p-6 last:border-b-0 sm:p-8"
              >
                <div className="flex gap-5 sm:gap-8">
                  {/* the 01…05 counter — 14px wide, mono */}
                  <Bar className="mt-1 h-[18px] w-3.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    {/* Kreyòl name: 19px/23.75 on a phone, where the third of
                        the five wraps onto a second line, and 22px/27.5 from
                        sm, where none of them do. 19 + 4.75 is one line box. */}
                    <div className="pb-[4.75px] sm:hidden">
                      {head.map((w, j) => (
                        <Bar
                          key={j}
                          className={`h-[19px] max-w-full ${w} ${j > 0 ? 'mt-[4.75px]' : ''}`}
                        />
                      ))}
                    </div>
                    <Bar className="hidden h-7 w-[297px] max-w-full sm:block" />
                    {/* the English gloss under it */}
                    <Bar className={`mt-1 h-[22.5px] ${gloss} sm:h-[23px] sm:w-[125px]`} />
                    <div className="mt-4 max-w-[60ch]">
                      <Lines n={n} sm={sm} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHERE ── 325 at 402px, 384 at 1280. ─────────────────────────── */}
      <section className="border-t border-white/10">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
          <Bar className="h-[27.3px] w-[109px] max-w-full sm:h-[27px] sm:w-[168px] md:h-[32px] lg:h-[42px]" />
          <div className="mt-4 max-w-[58ch]">
            <Lines n={2} sm={2} />
          </div>
          {/* Six city names, set large. The measured widths wrap 2+3+1 at 402
              and 5+1 at 1280, which is how the real list breaks. */}
          <div className="mt-9 flex flex-wrap gap-x-8 gap-y-3">
            {CITIES.map(([w, smW], i) => (
              <Bar key={i} className={`h-[20px] ${w} sm:h-[22px] ${smW} lg:h-[34px]`} />
            ))}
          </div>
        </div>
      </section>

      {/* ── CLOSING ── 378 at 402px, 448 at 1280. ───────────────────────── */}
      <section className="border-t border-white/10">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          {/* "Nou wè aswè a." — clamp(30px,5.5vw,60px) */}
          <Bar className="h-[30.6px] w-[224px] max-w-full sm:h-[36px] sm:w-[449px] md:h-[43px] lg:h-[57px] xl:h-[61px]" />
          <Bar className="mt-3 h-[25.5px] w-[84px] sm:h-[26px] sm:w-[84px]" />
          <div className="mt-7 max-w-[56ch]">
            <Lines n={3} sm={2} />
          </div>
          <Bar className="mt-9 h-11 w-[152px] rounded-xl" />
        </div>
      </section>
    </div>
  )
}
