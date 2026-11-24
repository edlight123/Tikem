/**
 * The app's accessibility settings store (mobile/lib/a11y): defaults, saving
 * per device, the phone's Reduce Motion OR the in-app "always", the bolder
 * weight ladder, caption lines at large text sizes, and the copy in all three
 * languages.
 */
const store: Record<string, string> = {}
let systemReduce = false
let motionListener: ((on: boolean) => void) | null = null

jest.mock(
  '@react-native-async-storage/async-storage',
  () => ({
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => (k in store ? store[k] : null)),
      setItem: jest.fn(async (k: string, v: string) => {
        store[k] = v
      }),
    },
  }),
  { virtual: true }
)
jest.mock(
  'react-native',
  () => ({
    AccessibilityInfo: {
      isReduceMotionEnabled: jest.fn(async () => systemReduce),
      addEventListener: jest.fn((_e: string, cb: (on: boolean) => void) => {
        motionListener = cb
        return { remove: () => {} }
      }),
    },
    useWindowDimensions: () => ({ fontScale: 1, width: 390, height: 844, scale: 3 }),
  }),
  { virtual: true }
)

import {
  A11Y_DEFAULTS,
  A11Y_PREFS_KEY,
  __resetA11yForTests,
  bumpWeight,
  captionLinesFor,
  getA11yPrefs,
  isReducedMotion,
  joinA11y,
  parseA11yPrefs,
  setA11yPrefs,
} from '../mobile/lib/a11y'
import en from '../mobile/locales/en'
import fr from '../mobile/locales/fr'
import ht from '../mobile/locales/ht'

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  systemReduce = false
  motionListener = null
  __resetA11yForTests()
})

describe('a11y settings store', () => {
  it('starts with everything off and motion following the phone', async () => {
    expect(getA11yPrefs()).toEqual(A11Y_DEFAULTS)
    await flush()
    expect(isReducedMotion()).toBe(false)
  })

  it('saves changes on the device and reads them back after a restart', async () => {
    setA11yPrefs({ boldText: true, highContrast: true })
    await flush()
    expect(JSON.parse(store[A11Y_PREFS_KEY])).toEqual({ reduceMotion: 'system', boldText: true, highContrast: true })

    __resetA11yForTests()
    expect(getA11yPrefs().boldText).toBe(false) // not loaded yet
    await flush()
    expect(getA11yPrefs()).toEqual({ reduceMotion: 'system', boldText: true, highContrast: true })
  })

  it('reduces motion when the phone asks, or when set to always', async () => {
    getA11yPrefs()
    await flush()
    expect(isReducedMotion()).toBe(false)
    motionListener?.(true)
    expect(isReducedMotion()).toBe(true)
    motionListener?.(false)
    setA11yPrefs({ reduceMotion: 'always' })
    expect(isReducedMotion()).toBe(true)
  })

  it('reads the phone setting at start-up', async () => {
    systemReduce = true
    getA11yPrefs()
    await flush()
    expect(isReducedMotion()).toBe(true)
  })

  it('ignores corrupt or unexpected stored values', () => {
    expect(parseA11yPrefs('not json')).toEqual(A11Y_DEFAULTS)
    expect(parseA11yPrefs('null')).toEqual(A11Y_DEFAULTS)
    expect(parseA11yPrefs('{"reduceMotion":"sometimes","boldText":"yes","highContrast":1}')).toEqual(A11Y_DEFAULTS)
    expect(parseA11yPrefs('{"reduceMotion":"always"}')).toEqual({ ...A11Y_DEFAULTS, reduceMotion: 'always' })
  })
})

describe('helpers', () => {
  it('bolder text goes one weight step heavier', () => {
    expect(bumpWeight('400')).toBe('600')
    expect(bumpWeight(undefined)).toBe('600')
    expect(bumpWeight('600')).toBe('700')
    expect(bumpWeight('700')).toBe('800')
    expect(bumpWeight('900')).toBe('900')
    expect(bumpWeight('bold')).toBe('800')
  })

  it('captions get a second line only at large text sizes', () => {
    expect(captionLinesFor(1)).toBe(1)
    expect(captionLinesFor(1.3)).toBe(1)
    expect(captionLinesFor(1.6)).toBe(2)
    expect(captionLinesFor(2, 2)).toBe(3)
  })

  it('joins spoken labels without empty parts', () => {
    expect(joinA11y('Konpa Ball', '', null, undefined, false, 'Sat 28 Nov', 0)).toBe('Konpa Ball, Sat 28 Nov, 0')
  })
})

describe('copy', () => {
  it.each([
    ['en', en],
    ['fr', fr],
    ['ht', ht],
  ])('%s has every accessibility string, non-empty', (_l, locale) => {
    const keys = Object.keys((en as any).a11y)
    for (const k of keys) {
      expect(typeof (locale as any).a11y[k]).toBe('string')
      expect((locale as any).a11y[k].trim()).not.toBe('')
    }
    expect((locale as any).a11y.posterColour).toContain('{n}')
  })
})
