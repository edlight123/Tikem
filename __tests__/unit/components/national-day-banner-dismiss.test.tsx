/**
 * The web national-day banner's close button: remembered per occurrence and
 * phase (the app's semantics), so closing it in the lead days still shows it
 * once on the day itself.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import NationalDayBanner from '@/components/home/NationalDayBanner'
import { NATIONAL_DAYS, type ActiveNationalDay } from '@/lib/nationalDays'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => (opts && typeof opts.defaultValue === 'string' ? opts.defaultValue : key),
    i18n: { language: 'en' },
  }),
}))

jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: any) => <img alt={props.alt} />,
}))

const day = NATIONAL_DAYS.find((d) => d.key === 'vertieres')!
const upcoming: ActiveNationalDay = { day, phase: 'upcoming', daysUntil: 2, start: '2026-11-18', end: '2026-11-18' }
const today: ActiveNationalDay = { day, phase: 'today', daysUntil: 0, start: '2026-11-18', end: '2026-11-18' }

const banner = (active: ActiveNationalDay) => (
  <NationalDayBanner active={active} href="/discover?day=vertieres" eventCount={0} />
)

beforeEach(() => window.localStorage.clear())

it('hides on close and remembers it for that phase', () => {
  const { container, unmount } = render(banner(upcoming))
  fireEvent.click(screen.getByRole('button', { name: 'Hide this banner' }))
  expect(container.querySelector('section')).toBeNull()
  expect(window.localStorage.getItem('nationalDays.dismissed.vertieres.2026-11-18.upcoming')).toBe('1')
  unmount()

  // Next visit in the lead days: still closed.
  expect(render(banner(upcoming)).container.querySelector('section')).toBeNull()
})

it('comes back once on the day itself', () => {
  window.localStorage.setItem('nationalDays.dismissed.vertieres.2026-11-18.upcoming', '1')
  const { container } = render(banner(today))
  expect(container.querySelector('section')).not.toBeNull()
})

it('ships the pre-paint script keyed to the same id', () => {
  const { container } = render(banner(today))
  const script = container.querySelector('section > script')?.innerHTML || ''
  expect(script).toContain('nationalDays.dismissed.vertieres.2026-11-18.today')
  expect(script).toContain('try{')
})

it('still renders when storage throws', () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  const { container } = render(banner(today))
  expect(container.querySelector('section')).not.toBeNull()
  jest.restoreAllMocks()
})
