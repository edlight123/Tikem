/**
 * "Use my current location": the on-device nearest-area lookup (app and
 * website mirrors), the distance label by country, and the runtime guard that
 * hides the feature on app builds without the expo-location native module.
 */
const lookupMock = jest.fn()
jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: (name: string) => lookupMock(name) }), {
  virtual: true,
})

import * as app from '../mobile/lib/areaResolve'
import * as web from '@/lib/location/nearestArea'
import { METROS } from '../mobile/data/metros'
import {
  loadLocationModule,
  locationSupported,
  resetLocationModuleForTest,
  getSessionPosition,
  detectCurrentArea,
  LocationError,
} from '../mobile/lib/currentLocation'

const P = {
  petionVille: { lat: 18.5125, lng: -72.2853 },
  delmas: { lat: 18.5447, lng: -72.3025 },
  capHaitien: { lat: 19.759, lng: -72.2 },
  jacmel: { lat: 18.2343, lng: -72.5347 },
  hinche: { lat: 19.15, lng: -72.0167 },
  fortLauderdale: { lat: 26.1224, lng: -80.1373 },
  brooklyn: { lat: 40.6782, lng: -73.9442 },
  newark: { lat: 40.7357, lng: -74.1724 },
  cambridge: { lat: 42.3736, lng: -71.1097 },
  laval: { lat: 45.6066, lng: -73.7124 },
  gatineau: { lat: 45.4765, lng: -75.7013 },
  saintDenis: { lat: 48.9362, lng: 2.3574 },
  santoDomingo: { lat: 18.4861, lng: -69.9312 },
  philadelphia: { lat: 39.9526, lng: -75.1652 },
  detroit: { lat: 42.3314, lng: -83.0458 },
  marrakesh: { lat: 31.6295, lng: -7.9811 },
}

describe('nearestArea (app)', () => {
  it.each([
    ['petionVille', 'HT', 'Port-au-Prince'],
    ['delmas', 'HT', 'Port-au-Prince'],
    ['capHaitien', 'HT', 'Cap-Haïtien'],
    ['jacmel', 'HT', 'Jacmel'],
    ['fortLauderdale', 'US', 'Miami'],
    ['brooklyn', 'US', 'New York'],
    ['newark', 'US', 'New York'],
    ['cambridge', 'US', 'Boston'],
    ['laval', 'CA', 'Montreal'],
    ['gatineau', 'CA', 'Ottawa'],
    ['saintDenis', 'FR', 'Paris'],
    ['santoDomingo', 'DO', 'Santo Domingo'],
  ] as const)('%s browses %s / %s', (place, country, city) => {
    expect(app.nearestArea(P[place])).toEqual({ country, city, label: city })
  })

  it('near a market but outside every metro: the whole country', () => {
    expect(app.nearestArea(P.hinche)).toEqual({ country: 'HT', city: '', label: '' })
    expect(app.nearestArea(P.philadelphia)).toEqual({ country: 'US', city: '', label: '' })
  })

  it('far from every market: unsupported, nothing to apply', () => {
    expect(app.nearestArea(P.detroit)?.unsupported).toBe(true)
    expect(app.nearestArea(P.marrakesh)).toEqual({ country: '', city: '', label: '', unsupported: true })
  })

  it('rejects a bad position', () => {
    expect(app.nearestArea({ lat: NaN, lng: 0 })).toBeNull()
    expect(app.nearestArea({ lat: 200, lng: 0 })).toBeNull()
    expect(app.nearestArea(null)).toBeNull()
  })

  it('has a centre for every metro, with its exact label and country', () => {
    const byId = new Map(app.AREA_CENTRES.map((c) => [c.id, c]))
    expect(byId.size).toBe(app.AREA_CENTRES.length)
    for (const m of METROS) {
      const c = byId.get(m.id)
      expect(c).toBeDefined()
      expect(c!.label).toBe(m.label)
      expect(c!.country).toBe(m.country)
    }
    expect(app.AREA_CENTRES.length).toBe(METROS.length)
  })
})

describe('formatDistance', () => {
  it('miles in the US, km elsewhere', () => {
    expect(app.formatDistance(3.86, 'US')).toBe('2.4 mi')
    expect(app.formatDistance(19.3, 'US')).toBe('12 mi')
    expect(app.formatDistance(2.4, 'HT')).toBe('2.4 km')
    expect(app.formatDistance(12.4, 'FR')).toBe('12 km')
    expect(app.formatDistance(2.4, 'ca')).toBe('2.4 km')
  })

  it('decimal comma in French and Kreyòl', () => {
    expect(app.formatDistance(2.4, 'FR', 'fr')).toBe('2,4 km')
    expect(app.formatDistance(2.4, 'HT', 'ht')).toBe('2,4 km')
    expect(app.formatDistance(2.4, 'HT', 'en-US')).toBe('2.4 km')
  })

  it('nothing when too far or invalid; never "0 km"', () => {
    expect(app.formatDistance(400, 'HT')).toBe('')
    expect(app.formatDistance(NaN, 'HT')).toBe('')
    expect(app.formatDistance(-1, 'HT')).toBe('')
    expect(app.formatDistance(0.02, 'HT')).toBe('0.1 km')
  })
})

describe('website mirror (lib/location/nearestArea)', () => {
  it('same table as the app', () => {
    expect(web.AREA_CENTRES).toEqual(app.AREA_CENTRES)
    expect(web.COUNTRY_FALLBACK_KM).toBe(app.COUNTRY_FALLBACK_KM)
    expect(web.MAX_DISTANCE_KM).toBe(app.MAX_DISTANCE_KM)
  })

  it('same answers as the app', () => {
    for (const p of Object.values(P)) expect(web.nearestArea(p)).toEqual(app.nearestArea(p))
    for (const [km, c, l] of [[3.86, 'US', 'en'], [2.4, 'HT', 'fr'], [150, 'CA', 'ht'], [0.01, 'FR', 'en']] as const) {
      expect(web.formatDistance(km, c, l)).toBe(app.formatDistance(km, c, l))
    }
  })

  it("maps an area to Discover's city value", () => {
    expect(web.webCityForArea(web.nearestArea(P.fortLauderdale)!)).toBe('Miami, FL')
    expect(web.webCityForArea(web.nearestArea(P.laval)!)).toBe('Montreal, QC')
    expect(web.webCityForArea(web.nearestArea(P.petionVille)!)).toBe('Port-au-Prince')
    // Tampa is an app metro the website does not list: browse the country.
    expect(web.webCityForArea({ country: 'US', city: 'Tampa', label: 'Tampa' })).toBe('')
    expect(web.webCityForArea({ country: 'HT', city: '', label: '' })).toBe('')
  })
})

describe('runtime native-module guard (mobile/lib/currentLocation)', () => {
  beforeEach(() => {
    resetLocationModuleForTest()
    lookupMock.mockReset()
  })

  it('an older build without ExpoLocation: hidden, and expo-location is never required', () => {
    const load = jest.fn()
    expect(loadLocationModule(() => null, load)).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('locationSupported() follows the native lookup', () => {
    lookupMock.mockReturnValue(null)
    expect(locationSupported()).toBe(false)
    expect(lookupMock).toHaveBeenCalledWith('ExpoLocation')
  })

  it('a lookup or load that throws is treated as absent', () => {
    expect(loadLocationModule(() => { throw new Error('boom') })).toBeNull()
    resetLocationModuleForTest()
    expect(loadLocationModule(() => ({}), () => { throw new Error('no js') })).toBeNull()
  })

  it('detectCurrentArea refuses cleanly without the module', async () => {
    lookupMock.mockReturnValue(null)
    await expect(detectCurrentArea({ ask: false })).rejects.toBeInstanceOf(LocationError)
  })

  it('with the module: asks, reads a coarse position, keeps it in memory only', async () => {
    const Location = {
      Accuracy: { Low: 2 },
      requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
      getForegroundPermissionsAsync: jest.fn(),
      hasServicesEnabledAsync: jest.fn().mockResolvedValue(true),
      getCurrentPositionAsync: jest.fn().mockResolvedValue({ coords: { latitude: 18.5125, longitude: -72.2853 } }),
      getLastKnownPositionAsync: jest.fn(),
    }
    loadLocationModule(() => ({}), () => Location as any)
    const area = await detectCurrentArea({ ask: true })
    expect(area).toEqual({ country: 'HT', city: 'Port-au-Prince', label: 'Port-au-Prince' })
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: 2 })
    expect(getSessionPosition()).toEqual({ lat: 18.5125, lng: -72.2853 })
    // The resolved area carries no coordinates.
    expect(Object.keys(area).sort()).toEqual(['city', 'country', 'label'])
  })

  it('denied permission → LocationError("denied")', async () => {
    const Location = {
      Accuracy: { Low: 2 },
      requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
      getForegroundPermissionsAsync: jest.fn(),
    }
    loadLocationModule(() => ({}), () => Location as any)
    await expect(detectCurrentArea({ ask: true })).rejects.toMatchObject({ code: 'denied' })
  })
})
