# Tikèm × POSH — Design Brief

> Design direction distilled from analyzing **POSH** (posh.vip), a premium nightlife/events
> ticketing app, and translated into concrete moves to level up **Tikèm** — the Haitian
> event-ticketing app (Next.js web + Expo mobile).
>
> **Tikèm's stated direction:** black canvas, bold grotesk type, poster-forward event
> imagery, teal as a *sparing* accent.
>
> This is a design north star for engineers and designers, not a spec. Where a value is
> given (radius, size, hex) treat it as a starting default to encode as a token, not gospel.

---

## 1. The core principle

**The app is a black frame; the poster art is the only color.**

POSH keeps *all* chrome pure black / white / grey. This is not minimalism for its own sake —
it is what lets wildly different user-uploaded flyers coexist and all read as premium. A stark
black-and-white flyer sits next to a neon-orange one, and neither fights the UI, because the UI
brings no color of its own to the fight. The moment the chrome introduces its own brand fills,
every poster has to compete with it and the whole grid gets muddy.

**Consequence for Tikèm — teal is a *semantic* accent, never decoration:**

- Teal is allowed on: a **verified badge**, an **active tab underline**, a **"live" / status
  chip**, a focused-field indicator, a small selected-state marker.
- Teal is **not** allowed as: a UI background fill, a primary button, a card surface, a large
  gradient (except inside the fallback poster template — see §2.8), or a header bar.
- If teal is carrying *meaning* (this is verified / this is live / this is selected), it earns
  its place. If it is just "brand color on a surface," remove it.

**Base palette (encode as tokens):**

```
canvas          #000000   pure black — the frame
surface-1       #141414   elevated card (lowest)
surface-2       #1c1c1c   elevated card / sheet (higher)
text-primary    #ffffff   titles, numerals, primary labels
text-secondary  #8a8a8a   muted grey — price, venue, meta
text-tertiary   ~#5c5c5c  lightest grey — dates, captions
accent-teal     (brand)   SEMANTIC only — see rules above
```

**Elevation, not borders.** Cards separate from the canvas by getting *lighter*
(`#141414` → `#1c1c1c`), not by drawing a 1px border. Reserve hairline borders for rare cases
(e.g. a divider inside a dense breakdown). Depth = brightness step, so the eye reads a clean
stack of surfaces rather than a wireframe of boxes.

---

## 2. Adopt — prioritized

Ordered by leverage. The top items are the ones that most define the "premium" feel and are
lowest-risk to ship.

### 2.1 Poster-forward, everywhere

The event flyer is the hero on every surface.

- **Aspect ratios:** portrait **~2:3** in grids and rails; **~4:5** for the feature/hero slot.
- **Radius:** **4px, and only 4px** (owner rule, 2026-10-22). The website has ONE corner
  radius, the same as the poster: Tailwind `rounded` (0.25rem). Cards, buttons, CTAs,
  inputs, search bars, chips, segmented controls, sheets, dialogs, toasts and email
  cards all use it; every named step (`rounded-sm` … `rounded-5xl`) is pinned to 4px in
  `tailwind.config.ts`. `rounded-full` is for **true circles only**: avatars and profile
  photos, status dots, radios, spinners, toggles, small count badges and carousel dots.
  Never a pill. Device drawings (phone mockup frames) are the one exception.
- **Full-bleed:** the image fills the card; text tiers sit *below* it, not on top of it.
- **Profile grids:** near-zero-gutter **3-column** poster grids on host/organizer profiles
  (but keep a hair of gutter on Android — see §3).
- **Enforce a consistent crop.** Every poster is coerced to the same aspect via center-crop /
  cover so a grid of mismatched uploads still reads as a tidy grid. This is non-negotiable —
  inconsistent crops are what make a UGC event app look cheap.

```
PosterCard (grid, 2:3)
┌───────────────┐
│               │
│               │  ← full-bleed flyer, cover-cropped, r=4
│   [ flyer ]   │
│               │
└───────────────┘
  Event Title        ← bold white (tier 1)
  $25 · Le Villate   ← grey price + venue (tier 2)
  Fri, Aug 15        ← lighter grey date (tier 3)
```

### 2.2 The white pill = the one primary action per screen

Exactly **one** primary action per screen, and it is always a solid **white pill**.

- Solid white background, **black** text, **~56px** tall, **4px corners** (web: no pill — see the radius rule in 2.1).
- Carries an inline **muted price sub-label** so the CTA states the commitment:
  `Achte tikè · apati $X` (Buy ticket · from $X).
- **Adaptive:** free events read `RSVP`; paid events read `Get Tickets from $X`
  (`Achte tikè · apati $X`).
- **Secondary** action = dark-grey pill. **Tertiary** = underlined text link
  (e.g. *save as draft* / *sonje kòm bouyon*).

```
WhitePillCTA (paid)
┌───────────────────────────────────────┐
│   Achte tikè                            │   ← black text on white
│   apati $25                             │   ← muted sub-label, smaller
└───────────────────────────────────────┘

variant=rsvp →  "RSVP"  (no price sub-label)
```

### 2.3 The metric-triplet, reused on every host surface

One component, everywhere an organizer sees performance.

- Tiny (**~12px**) muted **uppercase** label above a big (**~28px**) **bold white** numeral.
- **Three across**: Revenue / Tickets Sold / Page Visits.
- **Confident zero-states** — show `$0.00`, `0`, `0` with pride. The empty triplet doubles as
  the activation funnel: it tells a new organizer exactly what will light up once they publish
  and sell.

```
StatTriplet
  REVENUE          TICKETS SOLD        PAGE VISITS
  $0.00            0                   0
  ▲ ~12px upper    ▲ ~28px bold white
```

### 2.4 The inverted WHITE ticket + QR screen

Deliberately **breaks** the dark theme. This is intentional: a white ticket reads as a
*physical object* pulled out of the black app, and a white background makes the QR scan
reliably under bad lighting at a Haitian venue door.

- **White card.** Event name / date centered in **black**.
- **QR** with a small **Tikèm logo knockout** in the center.
- **Order #** below the QR.
- Then a **dark "Breakdown" card**: collapsible fee lines, **bold total** at the bottom.
- Then a **post-purchase action stack**: View event · Add to calendar · Add to Apple Wallet ·
  Get directions.

```
TicketQRCard (inverted, white)
┌───────────────────────────┐
│      SUMMER FÈT 2026       │  ← black, centered
│      Fri, Aug 15 · 9PM     │
│                            │
│      ██ ▄▄ ██ ▄  ██        │
│      ▄  ██ ▄▄ ██  ▄   [T]  │  ← QR w/ Tikèm knockout
│      ██ ▄  ██ ▄▄ ██        │
│                            │
│      Order #TKM-4821       │
└───────────────────────────┘
┌───────────────────────────┐  ← dark Breakdown card
│  Ticket        $25.00      │
│  Fees          $2.50   ⌄   │  ← collapsible
│  ─────────────────────     │
│  Total         $27.50      │  ← bold
└───────────────────────────┘
  [ View event ]
  [ Add to calendar ]
  [ Add to Apple Wallet ]
  [ Get directions ]
```

### 2.5 Oversized editorial titles + three-tier captions

- **Screen titles:** 48–64px **bold grotesk**, left-aligned. Let them **wrap 2–3 lines** rather
  than truncate — the wrap *is* the editorial look.
- **Caption hierarchy** under every card, three tiers:
  1. **bold white** — event title
  2. **grey** — price + venue
  3. **lighter grey** — date

### 2.6 Empty-state formula

One repeatable recipe for every empty surface:

```
        (outline icon)          ← centered, thin outline
     No events yet               ← bold headline
  Piblisye premye evènman ou     ← one muted explanatory line
  pou kòmanse vann tikè.

     ┌──────────────────┐
     │  Kreye yon evènman│        ← one white pill CTA
     └──────────────────┘
```

Centered outline icon → bold headline → one muted line → one white pill CTA. Never more.

### 2.7 Status-dot chips with fixed color semantics

A small dot + label chip, with a **locked** color map (so the same color never means two
things):

| Color              | Meaning              | Example label      |
| ------------------ | -------------------- | ------------------ |
| **Amber**          | Action needed        | "Needs payout info"|
| **Teal**           | Live / upcoming      | "Live" / "Upcoming"|
| **Red**            | Error / disabled     | "Sold out" / "Off" |
| **Gold or Teal**   | Verified             | "Verified"         |

Pair status chips with a `Manage >` affordance where the organizer can act.

### 2.8 Stock-flyer picker **and** a strong fallback poster template

This is the load-bearing item that keeps the whole poster-forward system from collapsing for
organizers who don't upload art.

- **Stock-flyer picker:** search a curated library + one-tap upload.
- **Fallback poster template:** if no art, auto-generate a premium poster — **bold grotesk
  title on a teal/black gradient**. (This is the one sanctioned large use of teal, because here
  teal *is* the poster art, not chrome.)

Without this, a text-only event drops an ugly gap into the poster grid and the premium feel
evaporates. Every event must have a poster, even if the organizer never uploaded one.

### 2.9 Peeking horizontal rails

- **Lowercase editorial section labels:** `pou ou` (for you), `pou dancefloor la` (for the
  dancefloor), with a `tout >` (see all) link.
- Cards **bleed off both edges** of the screen so the half-cut card signals "swipe me."

```
pou ou                                    tout >
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────
│          │ │          │ │          │ │
│  flyer   │ │  flyer   │ │  flyer   │ │  fl…   ← bleeds off edge
│          │ │          │ │          │ │
└──────────┘ └──────────┘ └──────────┘ └────
```

### 2.10 Progressive disclosure in create / ticket forms

Fits Tikèm's **publish-first-for-Haiti** flow — get organizers to a published event fast.

- **Show only the essentials:** Title / Date / Venue / Address / one Default Ticket.
- **Hide advanced** behind `Montre paramèt avanse` (show advanced settings).
- **Inline red validation** directly under the offending field (not a top-of-form banner).
- A **confirmation sheet before publishing**, with a `save as draft` (*sonje kòm bouyon*)
  escape hatch.

### 2.11 Loading `•••` placeholders for in-flight metrics

For metrics still loading, show a muted `•••` in place of the numeral — **not** a spinner and
**not** a premature `0`. A premature zero reads as bad news to an organizer; `•••` reads as
"counting."

### 2.12 (Later / bigger) Full-screen vertical swipe event feed

TikTok-style vertical feed — **For You / Following / Saved** tabs. Each event's **own blurred
poster** is the ambient, scrimmed background behind its details. Big lift; park it for a later
phase (see §5, Phase 4).

---

## 3. Deliberately avoid / adapt for Tikèm

POSH is a reference, not a template. These are the places to *not* copy it.

- **Stray iOS-system-blue.** POSH leaks the default iOS blue into date pickers and
  Confirm/Cancel text. Tint those with **teal** or keep them **white** — never ship system blue.
- **Nightlife-only imagery.** POSH's defaults assume clubs. Tikèm spans **concerts, community,
  faith, family, and sports** — curate a **broader default / placeholder / stock set** so the
  fallbacks don't all look like a night out.
- **SMS-gated urgency.** POSH leans on SMS ("30 min to claim your waitlist spot"). Hold off
  until **Haiti SMS/push deliverability is proven** — telecom friction is a known issue and a
  countdown that never delivers is worse than none.
- **Total monochrome.** Do **not** copy POSH's zero-brand-color look so completely that Tikèm's
  **teal identity disappears**. Insert teal in a few high-value semantic spots (§1, §2.7) so
  Tikèm is recognizably itself and not a POSH clone.
- **Thin, unlabeled bottom-tab icons.** For a first-time Haitian audience, cryptic icons are a
  barrier. Consider **short text labels** under tab icons.
- **Very dense zero-gutter grids on low-DPI Android** (common in Haiti). Keep **2–4px of
  gutter** and **legible tap targets** — the near-zero-gutter look must not cost usability on
  the actual devices people hold.

---

## 4. Component vocabulary to build

Prop-level starting specs. Names are suggestions; encode the shared tokens from §1 once and
have every component consume them.

### `PosterCard`
```ts
{
  image: string;                 // uploaded flyer OR fallback-template output
  title: string;                 // caption tier 1 (bold white)
  price?: string;                // caption tier 2 (grey) — omit/"Free" for RSVP
  venue?: string;                // caption tier 2 (grey)
  date: string;                  // caption tier 3 (lighter grey)
  aspect?: '2:3' | '4:5';        // 2:3 grid/rail (default), 4:5 feature
}
// full-bleed cover-crop image, r=20; text tiers render below the image
```

### `StatTriplet` / `StatRow`
```ts
{
  items: { label: string; value: string | number | null }[];  // render 3 across
}
// label: ~12px muted uppercase · value: ~28px bold white
// value === null → render "•••" (loading);  0 / "$0.00" render confidently
```

### `WhitePillCTA`
```ts
{
  label: string;                 // e.g. "Achte tikè" | "RSVP"
  subLabel?: string;             // e.g. "apati $25" (muted, paid only)
  variant: 'paid' | 'rsvp';
  onPress: () => void;
}
// solid white, black text, ~56px, 4px corners on web; one per screen
```

### `StatusChip`
```ts
{
  status: 'actionNeeded' | 'live' | 'error' | 'verified';
  label: string;
  onManage?: () => void;         // renders "Manage >" when provided
}
// dot + label; color locked by the §2.7 semantics map:
//   actionNeeded → amber · live → teal · error → red · verified → gold|teal
```

### `EmptyState`
```ts
{
  icon: ReactNode;               // thin outline icon, centered
  headline: string;              // bold
  body: string;                  // one muted explanatory line
  cta: { label: string; onPress: () => void };  // one white pill
}
```

### `TicketQRCard`
```ts
{
  eventName: string;
  eventDate: string;
  qrValue: string;               // renders QR with Tikèm logo knockout
  orderNumber: string;
  breakdown: { label: string; amount: string }[];  // collapsible lines
  total: string;
  actions: { label: string; onPress: () => void }[]; // View event, calendar, Wallet, directions
}
// INVERTED: white card, black text (breaks dark theme by design)
```

---

## 5. Phased roadmap

Each phase notes rough surface area. Ship phases in order — later phases assume the tokens and
components from earlier ones.

### Phase 1 — Foundations (low-risk)
Design tokens + canvas discipline, and the core reusable components.
- Encode the §1 palette/elevation tokens; audit chrome for stray color.
- Build `StatTriplet`, `PosterCard`, `WhitePillCTA`, `EmptyState`, `StatusChip` semantics.
- **Surface area:** shared design-token layer + a handful of leaf components; touches most
  screens lightly (swapping in the new primitives). No backend changes.

### Phase 2 — Poster-forward discovery
- Poster-forward discover **rails** (peeking, editorial labels).
- **Fallback poster template** (bold grotesk on teal/black gradient).
- **Stock-flyer picker** (search + upload).
- **Surface area:** discover/home screens + create-event image step; needs a curated stock
  library and a poster-generation path (client- or server-side render).

### Phase 3 — Ticketing polish
- **Inverted ticket / QR** screen.
- **Apple Wallet** pass generation.
- **Post-purchase action stack** (View event, calendar, Wallet, directions).
- **Surface area:** post-checkout / my-tickets screens + a Wallet pass backend endpoint and
  QR generation. Medium lift (Wallet passes require signing/certs).

### Phase 4 — Vertical swipe feed
- Full-screen **For You / Following / Saved** vertical feed with ambient blurred-poster
  backgrounds.
- **Surface area:** a new top-level feed surface + a ranking/feed data source. Largest lift;
  do last, once the poster system and rails have proven the content pipeline.

---

## Surfaces: a fill, not a hairline around nothing

**Rule (owner, repeated three times now — treat it as settled): a box does not
earn a border just for being a box. If an element needs to read as its own
surface, give it a FILL. Reach for a hairline only when a fill genuinely cannot
carry the separation.**

The failure mode this exists to stop: `border border-white/10` over a
`bg-white/[0.03]` fill so faint it reads as empty, repeated down a column, so
the whole screen looks like a wireframe of itself rather than a designed page.
It has been corrected in the composer's left column, its date and time
triggers, the guest editor sheet, and the buyer's ticket selector. Each time the
report was some version of *"not everything needs to be a border w no fill."*

The ladder, darkest to lightest — all on the `#0a0a0a` page:

| Token | Use |
|---|---|
| `bg-white/[0.03]` | a row or a card sitting on the page |
| `bg-white/[0.055]` – `bg-white/[0.07]` | a form field, a picker trigger, an inset inside a card |
| `bg-white/[0.08]` + `ring-1 ring-inset ring-brand-400/50` | that card, selected |
| `bg-white/[0.12]` – `bg-white/[0.14]` | hover on any of the above |
| `bg-white text-black` | a chosen chip or a primary button — the only pure white |

Corollaries that keep biting:

- **`bg-[#0a0a0a]` on a card is invisible.** It is the page colour. There are
  ~500 instances of this app-wide; do not add one.
- **A selected state needs more than one pixel of teal.** The ticket tiers were
  `border-brand-500` with no fill at all, so chosen and unchosen tiers differed
  by a hairline. Selection changes the FILL, and the ring is the accent on top.
- **Never a border only in the disabled state.** The promo input was
  `disabled:bg-white/[0.04]`: a fill that appeared exactly when the field
  stopped being usable.
- **No filled status pills** (separate standing rule). A status is a dot plus a
  label. Fills are for surfaces and for real toggles, not for badges that only
  report.
- **A hairline under sticky chrome reads as a seam.** If a sticky bar sits a few
  pixels below the navbar's own border, the two lines read as a crack across the
  page. Let the blur and the padding separate them.

---

*Guiding line, when in doubt: the app is a black frame; the poster is the color; teal only ever
means something.*
