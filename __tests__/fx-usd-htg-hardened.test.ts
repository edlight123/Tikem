/**
 * @jest-environment node
 *
 * The hardened USD→HTG rate (lib/fx/usd-htg.ts): live only when sane, else the
 * HIGHEST snapshot of the last 14 days, else refuse. Spread applied once.
 */
import {
  __resetUsdHtgRateCacheForTests,
  convertUsdToHtgAmount,
  FxRateUnavailableError,
  getUsdToHtgBaseRate,
  getUsdToHtgRateWithSpread,
  isFxRateUnavailableError,
  requestLanguage,
  usdHtgBaseRateFromSnapshot,
  type UsdHtgSnapshotPoint,
} from '@/lib/fx/usd-htg'

const NOW = Date.parse('2026-10-12T12:00:00.000Z')
const now = () => NOW
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

function okFetch(htg: number, extra: Record<string, unknown> = {}): typeof fetch {
  return jest.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ result: 'success', base_code: 'USD', rates: { HTG: htg }, ...extra }),
  })) as any
}

/** A fetch that never answers until aborted — exercises the timeout. */
const hangingFetch: typeof fetch = ((_url: string, init: any) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const err: any = new Error('aborted')
      err.name = 'AbortError'
      reject(err)
    })
  })) as any

const history = (points: Array<[number, number]>) =>
  jest.fn(async () => points.map(([rate, d]) => ({ baseRate: rate, fetchedAt: daysAgo(d), id: daysAgo(d).slice(0, 10) }) as UsdHtgSnapshotPoint))

beforeEach(() => {
  __resetUsdHtgRateCacheForTests()
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('getUsdToHtgBaseRate', () => {
  it('accepts a live rate inside the band and near the 14-day median, with the provider timestamp', async () => {
    const r = await getUsdToHtgBaseRate({
      now,
      fetchImpl: okFetch(131.2, { time_last_update_utc: 'Sun, 12 Oct 2026 00:02:31 +0000' }),
      loadSnapshots: history([[130, 1], [131, 2], [132, 3]]),
    })
    expect(r).toMatchObject({ baseRate: 131.2, source: 'live' })
    expect(r.fetchedAtIso).toBe('2026-10-12T00:02:31.000Z')
  })

  it('accepts a sane live rate when there is no history at all', async () => {
    const r = await getUsdToHtgBaseRate({ now, fetchImpl: okFetch(131), loadSnapshots: history([]) })
    expect(r.source).toBe('live')
  })

  it('times out a hanging provider and falls back to the HIGHEST snapshot of the 14 days', async () => {
    const r = await getUsdToHtgBaseRate({
      now,
      timeoutMs: 20,
      fetchImpl: hangingFetch,
      loadSnapshots: history([[130.5, 1], [133.9, 6], [131.1, 13]]),
    })
    expect(r).toMatchObject({ baseRate: 133.9, source: 'snapshot_fallback' })
    expect(r.fetchedAtIso).toBe(daysAgo(6))
    expect(r.provider).toBe(`fx_snapshots/${daysAgo(6).slice(0, 10)}`)
  })

  it('a payout fallback takes the LOWEST snapshot, so it can never overpay', async () => {
    const snaps = history([[130.5, 1], [133.9, 6], [131.1, 13]])
    const charge = await getUsdToHtgBaseRate({ now, timeoutMs: 20, fetchImpl: hangingFetch, loadSnapshots: snaps })
    expect(charge.baseRate).toBe(133.9)
    // Same process, cache warm with the charge's pick: the payout must not reuse it.
    const payout = await getUsdToHtgBaseRate({ now, timeoutMs: 20, fetchImpl: hangingFetch, loadSnapshots: snaps, fallback: 'lowest' })
    expect(payout).toMatchObject({ baseRate: 130.5, source: 'snapshot_fallback' })
  })

  it('ignores snapshots older than 14 days', async () => {
    await expect(
      getUsdToHtgBaseRate({
        now,
        fetchImpl: jest.fn(async () => ({ ok: false, status: 503, statusText: 'down' })) as any,
        loadSnapshots: history([[140, 15]]),
      })
    ).rejects.toBeInstanceOf(FxRateUnavailableError)
  })

  it('refuses a live rate more than 15% from the median and uses the fallback', async () => {
    const r = await getUsdToHtgBaseRate({
      now,
      fetchImpl: okFetch(160), // within 80–250 but +23% from ~130
      loadSnapshots: history([[129, 1], [130, 2], [131, 3]]),
    })
    expect(r).toMatchObject({ baseRate: 131, source: 'snapshot_fallback' })
  })

  it('refuses a live rate outside the absolute 80–250 band even with no history', async () => {
    await expect(
      getUsdToHtgBaseRate({ now, fetchImpl: okFetch(1), loadSnapshots: history([]) })
    ).rejects.toBeInstanceOf(FxRateUnavailableError)
    __resetUsdHtgRateCacheForTests()
    const r = await getUsdToHtgBaseRate({ now, fetchImpl: okFetch(13200), loadSnapshots: history([[132, 1]]) })
    expect(r.source).toBe('snapshot_fallback')
  })

  it('refuses with a typed error when live fails and there are no snapshots', async () => {
    const err = await getUsdToHtgBaseRate({ now, fetchImpl: hangingFetch, timeoutMs: 10, loadSnapshots: history([]) }).catch((e) => e)
    expect(isFxRateUnavailableError(err)).toBe(true)
    expect(err.code).toBe('fx_rate_unavailable')
  })

  it('treats a broken snapshot store as "no history", never as a crash', async () => {
    const r = await getUsdToHtgBaseRate({
      now,
      fetchImpl: okFetch(131),
      loadSnapshots: jest.fn(async () => {
        throw new Error('firestore down')
      }),
    })
    expect(r.source).toBe('live')
  })

  it('caches a live rate (one provider call for two lookups)', async () => {
    const f = okFetch(131)
    const loader = history([[131, 1]])
    await getUsdToHtgBaseRate({ now, fetchImpl: f, loadSnapshots: loader })
    await getUsdToHtgBaseRate({ now, fetchImpl: f, loadSnapshots: loader })
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('getUsdToHtgRateWithSpread', () => {
  it('applies the 5% spread once, on the live base', async () => {
    const r = await getUsdToHtgRateWithSpread({ now, fetchImpl: okFetch(130), loadSnapshots: history([[130, 1]]) })
    expect(r.baseRate).toBe(130)
    expect(r.effectiveRate).toBeCloseTo(136.5, 10)
    expect(r.spreadPercent).toBe(0.05)
    // A cached second lookup does not compound it.
    const again = await getUsdToHtgRateWithSpread({ now, fetchImpl: okFetch(999), loadSnapshots: history([]) })
    expect(again.effectiveRate).toBeCloseTo(136.5, 10)
  })

  it('applies the spread once on the fallback base too', async () => {
    const r = await getUsdToHtgRateWithSpread({
      now,
      fetchImpl: hangingFetch,
      timeoutMs: 10,
      loadSnapshots: history([[140, 2], [120, 1]]),
    })
    expect(r).toMatchObject({ baseRate: 140, source: 'snapshot_fallback' })
    expect(r.effectiveRate).toBeCloseTo(147, 10)
  })
})

describe('convertUsdToHtgAmount', () => {
  it('rounds to 2 decimals', () => {
    expect(convertUsdToHtgAmount(25, 136.5)).toBe(3412.5)
    expect(convertUsdToHtgAmount(19.99, 137.123456)).toBe(2741.1)
    expect(convertUsdToHtgAmount(0.5, 136.5)).toBe(68.25)
  })
  it('refuses junk inputs', () => {
    expect(() => convertUsdToHtgAmount(NaN, 136.5)).toThrow()
    expect(() => convertUsdToHtgAmount(10, 0)).toThrow()
  })
})

describe('snapshot doc shape', () => {
  it('reads baseRates.HTG, else inverts rates.HTG, else nothing', () => {
    expect(usdHtgBaseRateFromSnapshot({ baseRates: { HTG: 131.4 } })).toBe(131.4)
    expect(usdHtgBaseRateFromSnapshot({ rates: { HTG: 1 / 130 } })).toBeCloseTo(130, 6)
    expect(usdHtgBaseRateFromSnapshot({ baseRates: { HTG: 1 } })).toBeNull()
    expect(usdHtgBaseRateFromSnapshot({})).toBeNull()
  })
})

describe('requestLanguage', () => {
  it('prefers the web cookie, then Accept-Language, then English', () => {
    expect(requestLanguage(new Request('https://x', { headers: { cookie: 'a=1; i18nextLng=ht' } }))).toBe('ht')
    expect(requestLanguage(new Request('https://x', { headers: { 'accept-language': 'fr-HT,fr;q=0.9' } }))).toBe('fr')
    expect(requestLanguage(new Request('https://x'))).toBe('en')
  })
})
