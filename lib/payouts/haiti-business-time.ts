/**
 * Haiti wall-clock and business-day arithmetic, for the MonCash prefunding
 * planner (lib/payouts/prefunding-plan.ts) and its crons.
 *
 * Haiti is America/Port-au-Prince, which OBSERVES daylight saving (EST, UTC-5
 * in winter; EDT, UTC-4 from March to November). A fixed offset is wrong for
 * half the year, so every conversion here goes through Intl with the zone name.
 *
 * Digicel processes a prefunding request sent before 4 PM Haiti time the same
 * business day, otherwise the next business day. A business day is Monday to
 * Friday, not a Haitian public holiday (haitiPublicHolidays, built in) and
 * not in the configured extra-holiday list (YYYY-MM-DD Haiti days).
 *
 * Pure: no Firestore, no network. `now` is always passed in.
 */

export const HAITI_TZ = 'America/Port-au-Prince'

/** A calendar day in Haiti, YYYY-MM-DD. */
export type HaitiDay = string

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: HAITI_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
})

/** The Haiti wall-clock reading of an instant. */
export function haitiParts(at: Date): Parts {
  const out: Record<string, string> = {}
  for (const p of formatter.formatToParts(at)) out[p.type] = p.value
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday] ?? 0,
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The Haiti calendar day an instant falls on. */
export function haitiDay(at: Date): HaitiDay {
  const p = haitiParts(at)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** Day of week (0 = Sunday) of a Haiti calendar day. */
export function weekdayOf(day: HaitiDay): number {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** The Haiti calendar day `n` days after `day` (n may be negative). */
export function addDays(day: HaitiDay, n: number): HaitiDay {
  const [y, m, d] = day.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + n))
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
}

/**
 * The instant at which Haiti's wall clock reads `day` `hour:minute`. Solved by
 * guessing UTC and correcting by the zone offset at the guess, twice (the
 * second pass settles the DST-transition days).
 */
export function haitiWallTime(day: HaitiDay, hour = 0, minute = 0, second = 0): Date {
  const [y, m, d] = day.split('-').map(Number)
  const target = Date.UTC(y, m - 1, d, hour, minute, second)
  let guess = target
  for (let i = 0; i < 3; i++) {
    const p = haitiParts(new Date(guess))
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    const diff = target - seen
    if (diff === 0) break
    guess += diff
  }
  return new Date(guess)
}

/** The last instant (23:59:59.999) of a Haiti calendar day. */
export function endOfHaitiDay(day: HaitiDay): Date {
  return new Date(haitiWallTime(addDays(day, 1)).getTime() - 1)
}

/** Western (Gregorian) Easter Sunday, Anonymous Gregorian algorithm. */
export function easterSunday(year: number): HaitiDay {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${pad(month)}-${pad(day)}`
}

/**
 * Haiti's official public holidays (jours fériés) for a year: the fixed ones
 * plus the four that move with Easter (Carnival Monday and Tuesday, Good
 * Friday, Corpus Christi). Banks and Digicel's finance team are closed, so a
 * prefunding request can't be processed on them.
 */
export function haitiPublicHolidays(year: number): HaitiDay[] {
  const fixed = ['01-01', '01-02', '05-01', '05-18', '08-15', '10-17', '11-01', '11-02', '11-18', '12-25'].map(
    (md) => `${year}-${md}`
  )
  const easter = easterSunday(year)
  const moving = [
    addDays(easter, -48), // Lundi gras (Carnival Monday)
    addDays(easter, -47), // Mardi gras (Carnival Tuesday)
    addDays(easter, -2), // Vendredi saint (Good Friday)
    addDays(easter, 60), // Fête-Dieu (Corpus Christi)
  ]
  return [...fixed, ...moving].sort()
}

const holidayCache = new Map<number, Set<string>>()
function isHaitiPublicHoliday(day: HaitiDay): boolean {
  const year = Number(day.slice(0, 4))
  let set = holidayCache.get(year)
  if (!set) {
    set = new Set(haitiPublicHolidays(year))
    holidayCache.set(year, set)
  }
  return set.has(day)
}

export function isBusinessDay(day: HaitiDay, holidays: readonly string[] = []): boolean {
  const wd = weekdayOf(day)
  if (wd === 0 || wd === 6) return false
  if (isHaitiPublicHoliday(day)) return false
  return !holidays.includes(day)
}

/** The first business day strictly after `day`. */
export function nextBusinessDay(day: HaitiDay, holidays: readonly string[] = []): HaitiDay {
  let d = addDays(day, 1)
  for (let i = 0; i < 30 && !isBusinessDay(d, holidays); i++) d = addDays(d, 1)
  return d
}

/** The last business day strictly before `day`. */
export function previousBusinessDay(day: HaitiDay, holidays: readonly string[] = []): HaitiDay {
  let d = addDays(day, -1)
  for (let i = 0; i < 30 && !isBusinessDay(d, holidays); i++) d = addDays(d, -1)
  return d
}

export type DigicelCutoff = {
  /** The Haiti day a request sent at `now` is processed on. */
  processingDay: HaitiDay
  /** That day's cutoff instant (4 PM Haiti by default), ISO. */
  cutoffAt: string
  /** True when the request lands today (a business day, before the cutoff). */
  sameDay: boolean
  /** "today 4 PM" / "tomorrow 4 PM" / "Monday 4 PM" / "Mon 3 Nov 4 PM". */
  label: string
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function hourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12} ${hour < 12 ? 'AM' : 'PM'}`
}

/**
 * The next Digicel cutoff from `now`: today's, when today is a business day and
 * it is not yet the cutoff hour in Haiti; otherwise the next business day's.
 */
export function nextDigicelCutoff(now: Date, cutoffHour = 16, holidays: readonly string[] = []): DigicelCutoff {
  const today = haitiDay(now)
  const todayCutoff = haitiWallTime(today, cutoffHour)
  const sameDay = isBusinessDay(today, holidays) && now.getTime() < todayCutoff.getTime()
  const processingDay = sameDay ? today : nextBusinessDay(today, holidays)
  const cutoffAt = sameDay ? todayCutoff : haitiWallTime(processingDay, cutoffHour)

  const gap = daysBetween(today, processingDay)
  let dayWord: string
  if (gap === 0) dayWord = 'today'
  else if (gap === 1) dayWord = 'tomorrow'
  else if (gap < 7) dayWord = DAY_NAMES[weekdayOf(processingDay)]
  else dayWord = processingDay
  return { processingDay, cutoffAt: cutoffAt.toISOString(), sameDay, label: `${dayWord} ${hourLabel(cutoffHour)}` }
}

/** Whole calendar days from `a` to `b` (Haiti days). */
export function daysBetween(a: HaitiDay, b: HaitiDay): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/**
 * The end of the `n`th business day AFTER today (Haiti). With n = 2 on a
 * Friday this is the end of Tuesday; on a Saturday, also Tuesday.
 */
export function endOfNthBusinessDayAfter(now: Date, n: number, holidays: readonly string[] = []): Date {
  let d = haitiDay(now)
  for (let i = 0; i < Math.max(0, n); i++) d = nextBusinessDay(d, holidays)
  return endOfHaitiDay(d)
}

/** The end of the Haiti day `n` calendar days from today. */
export function endOfHaitiDayAfter(now: Date, n: number): Date {
  return endOfHaitiDay(addDays(haitiDay(now), Math.max(0, n)))
}

/**
 * The latest moment a request must be SENT so that money becoming withdrawable
 * at `dueAt` is already in the pool: the cutoff on the last business day whose
 * Haiti day is strictly before `dueAt`'s day. A same-day request may land any
 * time that afternoon, so it is not trusted to beat a release on that day.
 */
export function sendByFor(dueAt: Date, cutoffHour = 16, holidays: readonly string[] = []): Date {
  const day = previousBusinessDay(haitiDay(dueAt), holidays)
  return haitiWallTime(day, cutoffHour)
}
