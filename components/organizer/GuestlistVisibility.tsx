'use client'

/**
 * How the guest list appears on the event page — the face pile, the count, or
 * nothing — chosen by tapping the eye on the live preview of the exact row the
 * public will see.
 *
 * The reason this is a preview and not three words: "show who's going" and
 * "show how many" sound nearly identical in a settings list, and an organizer
 * picking between them is really picking between two *pictures*. So the choice
 * is made by looking rather than by parsing.
 *
 * This started as a preview row plus three stacked option cards, one card per
 * mode. That reversed: Posh's version is a single glyph you tap, and once the
 * preview is already showing the consequence, the cards were three copies of a
 * picture the row above them was drawing better. So the radio fieldset is gone
 * and the eye moved into the preview row itself — tap it and the same row
 * re-draws in the next mode, which is the shortest path from "what does this
 * do" to seeing it done. Two things the cards used to carry had to be kept:
 * the per-mode hint (now the small line under the sentence, where the label
 * "ON YOUR EVENT PAGE" used to sit — the row is visibly a preview already) and
 * a readable mode name, which rides under the glyph so nothing depends on
 * recognising an icon.
 */

import { useTranslation } from 'react-i18next'
import { Eye, Hash, EyeOff } from 'lucide-react'
import { GUESTLIST_VISIBILITIES, type GuestlistVisibility } from '@/lib/guestlistVisibility'

/** Just enough of a guest to draw a circle. */
export interface FacePileFace {
  id: string
  name: string
  photoUrl?: string
}

const ICONS: Record<GuestlistVisibility, typeof Eye> = {
  faces: Eye,
  count: Hash,
  hidden: EyeOff,
}

/** faces -> count -> hidden -> faces. Derived so the order stays one list. */
const nextMode = (v: GuestlistVisibility): GuestlistVisibility =>
  GUESTLIST_VISIBILITIES[(GUESTLIST_VISIBILITIES.indexOf(v) + 1) % GUESTLIST_VISIBILITIES.length]

/**
 * The overlapping circles, drawn at the size WhosGoing uses on the public page.
 */
export function FacePile({
  faces,
  size = 40,
  max = 4,
  dim = false,
}: {
  faces: FacePileFace[]
  size?: number
  max?: number
  /** Greyed out, for the "not showing" mode. */
  dim?: boolean
}) {
  const shown = faces.slice(0, max)
  return (
    <span className={`flex shrink-0 ${dim ? 'opacity-30 grayscale' : ''}`} aria-hidden>
      {shown.map((f, i) => (
        <span
          key={f.id}
          className="grid place-items-center overflow-hidden rounded-full bg-white/[0.12] font-semibold text-white ring-2 ring-[#0f0f0f]"
          style={{
            width: size,
            height: size,
            fontSize: size * 0.4,
            // Manual overlap rather than -space-x-*: the ring has to draw over
            // the neighbour to its left, so later circles must sit higher.
            marginLeft: i === 0 ? 0 : -size * 0.3,
            zIndex: i,
          }}
        >
          {f.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={f.photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            (f.name || 'G').charAt(0).toUpperCase()
          )}
        </span>
      ))}
    </span>
  )
}

/**
 * Stand-in guests for an event with none added yet — see the comment at the use
 * site for why they are named. They used to be initials on a teal circle, which
 * made the faces mode look like a diagram of itself rather than the thing it
 * produces; the whole point of that mode is that the faces are the flyer, so
 * the preview has to show faces. These are the audience Tikèm actually has:
 * Haitian and diaspora, a deliberate spread of light and dark skin and of men
 * and women, everybody smiling, because that is what a guest list looks like
 * when a night is going well.
 *
 * Unsplash is the only remote image host the enforcing CSP's img-src and
 * next.config.js remotePatterns both allow, and the URL shape is the one
 * lib/flyerLibrary.ts already uses. Every id below was fetched and looked at
 * before it landed here — a 404 or a mis-cropped photo would ship broken
 * circles into the composer, which is worse than the initials it replaces. The
 * square crop is requested from the CDN so the circle never squashes anyone.
 * These never leave this control; nothing here is written to an event.
 */
const unsplashFace = (photo: string) =>
  `https://images.unsplash.com/photo-${photo}?w=96&h=96&fit=crop&q=80`

/**
 * Three women and one man (owner ask). Every id was fetched AND looked at
 * before it went in — a resolving Unsplash id can still be a landscape, a
 * silhouette or somebody's back, and two of the candidates for this list were
 * exactly that.
 */
const SAMPLE_FACES: FacePileFace[] = [
  // light-skin Black woman, curly hair, broad smile
  { id: 's1', name: 'Mika', photoUrl: unsplashFace('1662850886700-4ec19bd30d11') },
  // dark-skin Black woman, facing camera, white collar over African print
  { id: 's2', name: 'Sherlie', photoUrl: unsplashFace('1531123897727-8f129e1688ce') },
  // the one man: medium-brown skin, short locs, beard, smiling outdoors
  { id: 's3', name: 'Jonas', photoUrl: unsplashFace('1522529599102-193c0d76b5b6') },
  // dark-skin Black woman, locs, round glasses, smiling
  { id: 's4', name: 'Farah', photoUrl: unsplashFace('1507152832244-10d45c7eda57') },
]

export default function GuestlistVisibilityPicker({
  value,
  onChange,
  faces,
  /** Real attendee count when known (edit mode); a sample otherwise. */
  going,
}: {
  value: GuestlistVisibility
  onChange: (v: GuestlistVisibility) => void
  faces: FacePileFace[]
  going?: number
}) {
  const { t } = useTranslation('common')

  // With no guests added yet the preview would be an empty box, which teaches
  // nothing, so stand-ins keep the picture intact. They are named rather than
  // bare initials for a reason: with anonymous placeholders the faces preview
  // fell back to "24 going" — the exact sentence count-only prints — and the
  // two options looked identical apart from the circles. A name makes the
  // format itself visible: "Mika and 23 others going". These never leave this
  // control.
  const sample: FacePileFace[] = faces.length > 0 ? faces : SAMPLE_FACES
  const count = going ?? Math.max(sample.length, 24)
  const lead = sample[0]?.name?.split(' ')[0]
  const others = Math.max(0, count - 1)

  /** Long mode name ("Faces and names"), for the button's spoken label. */
  const label = (v: GuestlistVisibility) =>
    t(`composer.guestVis.${v}`, {
      defaultValue: v === 'faces' ? 'Faces and names' : v === 'count' ? 'Count only' : 'Not showing',
    })

  /** Short mode name ("Faces"), for the caption under the glyph. */
  const shortLabel = (v: GuestlistVisibility) =>
    t(`composer.guestVis.${v}Short`, {
      defaultValue: v === 'faces' ? 'Faces' : v === 'count' ? 'Count' : 'Hidden',
    })

  /** The one-line explanation the option cards used to carry. */
  const hint = (v: GuestlistVisibility) =>
    t(`composer.guestVis.${v}Hint`, {
      defaultValue:
        v === 'faces'
          ? 'Who is going, with photos'
          : v === 'count'
            ? 'How many, no names'
            : 'Keep attendance private',
    })

  /** The sentence the public page will print, per mode. */
  const sentence = (v: GuestlistVisibility) => {
    if (v === 'hidden') return t('composer.guestVis.previewHidden', { defaultValue: 'Nothing shown' })
    if (v === 'count')
      return t('composer.guestVis.previewCount', { count, defaultValue: '{{count}} going' })
    return lead
      ? t('composer.guestVis.previewFaces', {
          name: lead,
          count: others,
          defaultValue: '{{name}} and {{count}} others going',
        })
      : t('composer.guestVis.previewCount', { count, defaultValue: '{{count}} going' })
  }

  const Icon = ICONS[value]
  const upcoming = nextMode(value)
  const dimmed = value === 'hidden'

  return (
    // One row: the preview the event page will draw, and the eye that changes
    // it. role/aria-label stand in for the fieldset's legend now that there is
    // no fieldset. The text block is a live region so a screen reader hears the
    // new sentence after a tap, not just the button's relabelled self.
    <div
      role="group"
      aria-label={t('composer.guestVis.legend', { defaultValue: 'Who can see the guest list' })}
      className="flex items-center gap-3 rounded-xl bg-white/[0.055] p-3"
    >
      {value !== 'count' && <FacePile faces={sample} size={40} dim={dimmed} />}

      {/* No truncate: at 402px the row can get narrow enough that clipping
          would eat the count, and a wrapped sentence is still readable. */}
      <span className="min-w-0 flex-1" aria-live="polite">
        <span className="block text-[15px] font-semibold leading-tight text-white">{sentence(value)}</span>
        <span className="mt-1 block text-[11px] leading-snug text-white/45">{hint(value)}</span>
      </span>

      <button
        type="button"
        onClick={() => onChange(upcoming)}
        aria-label={t('composer.guestVis.cycleAria', {
          current: label(value),
          next: label(upcoming),
          defaultValue: 'Guest list on your event page: {{current}}. Activate to switch to {{next}}.',
        })}
        title={label(value)}
        // h-11 is the 44px minimum touch target.
        //
        // The width no longer changes when you tap it. `min-w-[56px]` was not
        // enough: the caption IS the mode name, so it went FACES → COUNT →
        // HIDDEN (and KANTITE, MASQUÉ in the other locales), the button
        // resized on every press, and the row jumped under the finger — "each
        // time i click on the eye icon, it keeps changing sizes and all".
        //
        // Every caption is now rendered into the SAME grid cell with all but
        // the live one `invisible`, so the button is permanently as wide as
        // its own widest label — measured by CSS in the real font and the real
        // locale, rather than by a magic number I would have to keep correct
        // in three languages. Same technique as <StableWidth> in
        // components/ui/DateTimePickers, for the same reason.
        className={`flex h-11 shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-2.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#141414] ${
          dimmed
            ? 'bg-white/[0.06] text-white/45 hover:bg-white/[0.12] hover:text-white/70'
            : 'bg-white/[0.11] text-white hover:bg-white/[0.18]'
        }`}
      >
        <Icon className="h-[17px] w-[17px]" aria-hidden />
        <span className="label-mono grid text-[9px] uppercase leading-none tracking-wide">
          {GUESTLIST_VISIBILITIES.map((v) => (
            <span
              key={v}
              aria-hidden={v !== value}
              className={`col-start-1 row-start-1 whitespace-nowrap ${
                v === value ? '' : 'invisible'
              }`}
            >
              {shortLabel(v)}
            </span>
          ))}
        </span>
      </button>
    </div>
  )
}
