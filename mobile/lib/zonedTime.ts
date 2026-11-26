/**
 * Wall-clock time in an EVENT's zone, not the organizer's device zone.
 *
 * The pickers edit a date ('yyyy-MM-dd') and a time ('HH:mm') that mean
 * "at the venue". These helpers turn that wall clock into the stored ISO
 * instant and back, in the event's IANA zone (lib/home/feed eventZone), so an
 * organizer in Toronto entering 7:00 PM for a Victoria event stores 7:00 PM
 * Pacific.
 *
 * DST rules (the same as a calendar app):
 *   - A wall time that happens twice (the fall-back hour) is the FIRST one.
 *   - A wall time that never happens (the spring-forward gap) moves forward by
 *     the gap: 2:30 AM on the change night is 3:30 AM.
 *
 * Pure and dependency-free (Intl only). Mobile copy of the web
 * lib/events/zonedTime.ts (parity-tested in __tests__/zoned-time.test.ts).
 */

const pad = (n: number) => String(n).padStart(2, '0')
const DAY = 86_400_000

const formatters = new Map<string, Intl.DateTimeFormat>()
function partsFormatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(zone, f)
  }
  return f
}

/** Whether `zone` is an IANA zone this runtime knows. */
export function isValidZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !zone.trim()) return false
  try {
    partsFormatter(zone.trim())
    return true
  } catch {
    return false
  }
}

/** The device's own zone ('UTC' when the runtime can't tell). */
export function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

interface Fields {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function fieldsAt(t: number, zone: string): Fields {
  const parts = partsFormatter(zone).formatToParts(new Date(t))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // Some engines print midnight as "24" even with h23.
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  }
}

/** The zone's UTC offset at instant `t`, in ms (Victoria in winter: -8h). */
export function zoneOffsetMs(zone: string, t: number): number {
  const whole = Math.floor(t / 1000) * 1000
  const f = fieldsAt(whole, zone)
  return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second) - whole
}

/** An instant's wall-clock date ('yyyy-MM-dd') and time ('HH:mm') in `zone`; null when unset or invalid. */
export function toZonedParts(at: Date | string | number | null | undefined, zone: string): { date: string; time: string } | null {
  if (at == null || at === '') return null
  const t = new Date(at as any).getTime()
  if (Number.isNaN(t)) return null
  const f = fieldsAt(t, zone)
  return { date: `${f.year}-${pad(f.month)}-${pad(f.day)}`, time: `${pad(f.hour)}:${pad(f.minute)}` }
}

/**
 * A wall-clock date (+ time, else midnight) in `zone` → the instant; null when
 * unset or invalid. See the DST rules above.
 */
export function fromZonedParts(date: string | null | undefined, time: string | null | undefined, zone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || '').trim())
  if (!m) return null
  const tm = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim())
  const hour = tm ? Number(tm[1]) : 0
  const minute = tm ? Number(tm[2]) : 0
  if (hour > 23 || minute > 59) return null
  // The wall clock read as if it were UTC.
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, minute)
  if (Number.isNaN(naive)) return null
  // The offsets a day either side bracket any one DST change.
  const before = zoneOffsetMs(zone, naive - DAY)
  const after = zoneOffsetMs(zone, naive + DAY)
  const fits = (off: number) => zoneOffsetMs(zone, naive - off) === off
  const a = fits(before) ? naive - before : null
  const b = fits(after) ? naive - after : null
  // Both fit: the repeated hour (or no change at all) → the earlier instant.
  if (a !== null && b !== null) return new Date(Math.min(a, b))
  if (a !== null) return new Date(a)
  if (b !== null) return new Date(b)
  // Neither fits: the spring-forward gap. Reading it with the offset from before
  // the change lands as far past the change as the wall time was.
  return new Date(naive - before)
}

/** `fromZonedParts` as an ISO string (null when unset or invalid). */
export function zonedPartsToIso(date: string | null | undefined, time: string | null | undefined, zone: string): string | null {
  const d = fromZonedParts(date, time, zone)
  return d ? d.toISOString() : null
}

/** ISO instant → a `datetime-local` value ('yyyy-MM-ddTHH:mm') in `zone`; '' when absent. */
export function isoToZonedInput(iso: unknown, zone: string): string {
  if (!iso) return ''
  const p = toZonedParts(String(iso), zone)
  return p ? `${p.date}T${p.time}` : ''
}

/** `datetime-local` value read as wall clock in `zone` → ISO instant; null when empty or invalid. */
export function zonedInputToIso(value: string | null | undefined, zone: string): string | null {
  const [date = '', time = ''] = String(value || '').split('T')
  if (!date) return null
  return zonedPartsToIso(date, time.slice(0, 5) || '00:00', zone)
}

/**
 * The same wall clock in another zone: what an instant entered for `fromZone`
 * becomes when the venue moves to `toZone` (7:00 PM stays 7:00 PM, local to
 * the new venue).
 */
export function reinterpretInZone(iso: string | null | undefined, fromZone: string, toZone: string): string | null {
  const p = toZonedParts(iso, fromZone)
  return p ? zonedPartsToIso(p.date, p.time, toZone) : null
}

/**
 * An instant as a device-local Date whose local fields read its wall clock in
 * `zone`. Native date pickers only speak device time: hand them this, and read
 * their answer back with `fromWallClockCarrier`. Never compare it with a real
 * instant.
 */
export function toWallClockCarrier(at: Date, zone: string): Date {
  const f = fieldsAt(at.getTime(), zone)
  return new Date(f.year, f.month - 1, f.day, f.hour, f.minute)
}

/** A picker's device-local Date, read as wall clock in `zone` → the real instant. */
export function fromWallClockCarrier(d: Date, zone: string): Date {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return fromZonedParts(date, `${pad(d.getHours())}:${pad(d.getMinutes())}`, zone) || d
}

/** Whole calendar days added to a wall-clock date ('yyyy-MM-dd'). */
export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const u = new Date(Date.UTC(y, m - 1, d + days))
  return `${u.getUTCFullYear()}-${pad(u.getUTCMonth() + 1)}-${pad(u.getUTCDate())}`
}

/** The zone's own name in `locale` ("Pacific Time"); falls back to a short name or the IANA id. */
export function zoneName(zone: string, locale = 'en', at: Date = new Date()): string {
  for (const style of ['longGeneric', 'long', 'shortGeneric', 'short'] as const) {
    try {
      const part = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: style as any })
        .formatToParts(at)
        .find((p) => p.type === 'timeZoneName')?.value
      // A bare "GMT-8" from a long style means the engine has no name: try the next.
      if (part && (style === 'short' || !/^(GMT|UTC)([+\-−]\d|$)/.test(part))) return part
    } catch {
      /* next style */
    }
  }
  return zone
}

/** "Pacific Time (Victoria)": the zone's name with the venue's city, when there is one. */
export function zoneLabel(zone: string, locale = 'en', city?: string | null, at?: Date): string {
  const name = zoneName(zone, locale, at)
  const place = String(city || '').replace(/,\s*[A-Z]{2,3}$/, '').trim()
  return place ? `${name} (${place})` : name
}

/** Whether two zones read the same wall clock at `at` (so no zone label is needed). */
export function sameOffset(a: string, b: string, at: number = Date.now()): boolean {
  try {
    return zoneOffsetMs(a, at) === zoneOffsetMs(b, at)
  } catch {
    return false
  }
}

/**
 * The zone's short name at `at`, the way a boarding pass prints it: "PST",
 * "HNE" (fr-CA), "MEZ" (de). Where the locale has no abbreviation Intl gives
 * "GMT+1" / "UTC−5", which is kept. '' when the zone can't be read.
 */
export function zoneAbbr(zone: string, locale = 'en-US', at: Date | string | number = new Date()): string {
  const d = new Date(at as any)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return (
      new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' })
        .formatToParts(d)
        .find((p) => p.type === 'timeZoneName')?.value || ''
    )
  } catch {
    return ''
  }
}

/**
 * Whether a viewer in `viewerZone` reads a different clock from the event's
 * zone at the event's start (so a "your time" line or a zone tag helps).
 * False when either zone is missing or unknown.
 */
export function viewerZoneDiffers(
  eventZone: string | null | undefined,
  viewerZone: string | null | undefined,
  at: Date | string | number = Date.now(),
): boolean {
  if (!eventZone || !viewerZone || eventZone === viewerZone) return false
  if (!isValidZone(eventZone) || !isValidZone(viewerZone)) return false
  const t = new Date(at as any).getTime()
  if (Number.isNaN(t)) return false
  return !sameOffset(eventZone, viewerZone, t)
}
