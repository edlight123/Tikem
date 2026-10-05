/**
 * The mobile art library (mobile/lib/artLibrary.ts) picks a bundled screenprint
 * for a world, a category tile, the flyer picker and the empty states. The
 * picks must be deterministic (the same event always wears the same art),
 * fall back instead of crashing, and never come back undefined.
 */
import fs from 'fs'
import path from 'path'
import {
  ART,
  WORLDS,
  allArt,
  artByKey,
  artForCategory,
  artForPicker,
  artForPlace,
  artForWorld,
  artInWorld,
  generalArt,
  searchArt,
  tileArtForCategory,
  worldForCategory,
} from '../mobile/lib/artLibrary'
import { isDeviceOnlyImageUri } from '../mobile/lib/localImageUri'
import { CULTURAL_CATEGORIES } from '@/lib/categories'

describe('art manifest', () => {
  it('has unique keys and a file on disk for every piece', () => {
    const keys = ART.map((a) => a.key)
    expect(new Set(keys).size).toBe(keys.length)
    const src = fs.readFileSync(path.join(__dirname, '../mobile/lib/artLibrary.ts'), 'utf8')
    for (const key of keys) {
      const m = new RegExp(`key: '${key}',\\s*source: require\\('\\.\\./assets/art/([^']+)'\\)`).exec(src)
      expect(m).not.toBeNull()
      expect(fs.existsSync(path.join(__dirname, '../mobile/assets/art', m![1]))).toBe(true)
    }
  })

  it('mirrors the web cultural worlds', () => {
    expect(WORLDS.map((w) => w.key)).toEqual(CULTURAL_CATEGORIES.map((c) => c.key))
    expect(WORLDS.map((w) => w.label)).toEqual(CULTURAL_CATEGORIES.map((c) => c.label))
  })

  it('only tags pieces with real worlds and gives every world art', () => {
    const worldKeys = new Set<string>(WORLDS.map((w) => w.key))
    for (const a of ART) for (const w of a.worlds) expect(worldKeys.has(w)).toBe(true)
    for (const w of WORLDS) expect(artInWorld(w.key).length).toBeGreaterThan(0)
  })

  it('allArt returns a copy of every piece', () => {
    const all = allArt()
    expect(all).toHaveLength(ART.length)
    all.pop()
    expect(allArt()).toHaveLength(ART.length)
  })
})

describe('artForWorld', () => {
  it('is deterministic for the same seed', () => {
    for (const w of WORLDS) {
      for (const seed of ['evt_1', 'evt_2', 'abcXYZ', 42]) {
        expect(artForWorld(w.key, seed).key).toBe(artForWorld(w.key, seed).key)
      }
    }
  })

  it('stays inside the world when the world has art', () => {
    for (const w of WORLDS) {
      for (let i = 0; i < 25; i++) {
        expect(artForWorld(w.key, `seed-${i}`).worlds).toContain(w.key)
      }
    }
  })

  it('spreads different seeds across a multi-piece world', () => {
    const picked = new Set(Array.from({ length: 40 }, (_, i) => artForWorld('mizik', `e${i}`).key))
    expect(picked.size).toBeGreaterThan(1)
  })

  it('falls back to the general pool and never returns undefined', () => {
    const general = new Set(generalArt().map((a) => a.key))
    for (const world of [null, undefined, '', 'not-a-world', 'MIZIK']) {
      for (const seed of [null, undefined, '', 'x', 0, 123456789]) {
        const piece = artForWorld(world as any, seed as any)
        expect(piece).toBeDefined()
        expect(piece.source).toBeDefined()
        expect(general.has(piece.key)).toBe(true)
      }
    }
  })
})

describe('category → world', () => {
  it('maps web canonical, mobile composer and legacy categories', () => {
    expect(worldForCategory('Concert')).toBe('mizik')
    expect(worldForCategory('Music')).toBe('mizik')
    expect(worldForCategory('Party')).toBe('lavi-lannwit')
    expect(worldForCategory('Theater')).toBe('kilti')
    expect(worldForCategory('Arts & Culture')).toBe('kilti')
    expect(worldForCategory('Sports')).toBe('espo')
    expect(worldForCategory('Food & Drink')).toBe('gastronomi')
    expect(worldForCategory('Tech')).toBe('biznis')
    expect(worldForCategory('Community')).toBe('fanmi')
    expect(worldForCategory('Other')).toBe('eksperyans')
    expect(worldForCategory('something new')).toBe('eksperyans')
    expect(worldForCategory('Religious')).toBeNull()
  })

  it('agrees with the web taxonomy for every web canonical category', () => {
    for (const world of CULTURAL_CATEGORIES) {
      for (const cat of world.categories) expect(worldForCategory(cat)).toBe(world.key)
    }
  })

  it('tile art is world art, or null for a category with no world', () => {
    expect(tileArtForCategory('Music')!.worlds).toContain('mizik')
    expect(tileArtForCategory('Religious')).toBeNull()
    expect(artForCategory('Religious', 'evt')).toBeDefined()
  })
})

describe('flyer picker ordering and search', () => {
  it("leads with the event's world, then the rest, with no duplicates", () => {
    const list = artForPicker('Food & Drink')
    expect(list[0].key).toBe('table')
    expect(list).toHaveLength(ART.length)
    expect(new Set(list.map((a) => a.key)).size).toBe(ART.length)
  })

  it('searches keys, descriptions and accented world labels', () => {
    expect(searchArt(ART, 'espò').map((a) => a.key)).toContain('espo')
    expect(searchArt(ART, 'KANAVAL').map((a) => a.key)).toEqual(['kanaval'])
    expect(searchArt(ART, '')).toHaveLength(ART.length)
    expect(artByKey('nope')).toBeUndefined()
  })
})

describe('isDeviceOnlyImageUri (what the poster upload must upload)', () => {
  it('uploads device files and dev-server assets', () => {
    expect(isDeviceOnlyImageUri('file:///var/mobile/x.jpg')).toBe(true)
    expect(isDeviceOnlyImageUri('content://media/1')).toBe(true)
    expect(isDeviceOnlyImageUri('http://localhost:8081/assets/art/konpa.jpg')).toBe(true)
    expect(isDeviceOnlyImageUri('http://192.168.1.4:8081/assets/art/konpa.jpg')).toBe(true)
  })

  it('keeps public URLs and empty values', () => {
    expect(isDeviceOnlyImageUri('https://firebasestorage.googleapis.com/v0/b/x')).toBe(false)
    expect(isDeviceOnlyImageUri('https://images.unsplash.com/photo-1')).toBe(false)
    expect(isDeviceOnlyImageUri('http://example.com/a.jpg')).toBe(false)
    expect(isDeviceOnlyImageUri('')).toBe(false)
    expect(isDeviceOnlyImageUri(undefined)).toBe(false)
  })
})

describe('artForPlace', () => {
  const { findMetro } = require('../mobile/data/metros')
  const PAP = ['champdemars', 'tour2004']
  it('gives each city its landmark', () => {
    expect(PAP).toContain(artForPlace(findMetro('Port-au-Prince', 'HT')).key)
    expect(artForPlace(findMetro('Cap-Haïtien', 'HT')).key).toBe('citadelle')
    expect(artForPlace(findMetro('Jacmel', 'HT')).key).toBe('jacmel')
    expect(artForPlace(findMetro('Les Cayes', 'HT')).key).toBe('portsalut')
    expect(['diaspora', 'flatbush']).toContain(artForPlace(findMetro('Brooklyn', 'US')).key)
  })
  it('lets the town beat its metro', () => {
    const pap = findMetro('Port-au-Prince', 'HT')
    expect(artForPlace(pap, 'Pétion-Ville').key).toBe('saintpierre')
    expect(artForPlace(pap, 'Delmas 33').key).toBe('viaducdelmas')
    expect(['fortjacques', 'fortalexandre']).toContain(artForPlace(pap, 'Kenscoff').key)
  })
  it('rotates a list by day, stably within a day', () => {
    const pap = findMetro('Port-au-Prince', 'HT')
    const seen = new Set(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'].map((d) => artForPlace(pap, null, d).key))
    expect(seen).toEqual(new Set(PAP))
    expect(artForPlace(pap, null, '2026-10-04').key).toBe(artForPlace(pap, null, '2026-10-04').key)
  })
  it('matches loose strings and aliases', () => {
    expect(artForPlace('Okap').key).toBe('citadelle')
    expect(artForPlace('PETION-VILLE, Ouest').key).toBe('saintpierre')
    expect(artForPlace('Milot').key).toBe('sanssouci')
    expect(artForPlace("Saut-d'Eau").key).toBe('sautdeau')
    expect(artForPlace('Labadee').key).toBe('labadeenight')
  })
  it('gives other Haitian towns the lakou and names no wrong landmark abroad', () => {
    expect(artForPlace(findMetro('Gonaïves', 'HT')).key).toBe('lakou')
    for (const c of ['Atlanta, GA', 'Toronto', 'Chicago']) {
      expect(artForPlace(c).key).toBe('dyaspora')
    }
    expect(artForPlace(findMetro('Miami', 'US')).key).toBe('miami')
    expect(artForPlace(findMetro('Boston', 'US')).key).toBe('boston')
    expect(artForPlace('Montréal').key).toBe('montreal')
    expect(artForPlace('Saint-Denis').key).toBe('paris')
    expect(artForPlace(null, 'Flatbush').key).toBe('flatbush')
    expect(artForPlace(null).key).toBe('citadelle')
    expect(artForPlace('').key).toBe('citadelle')
  })
  it('captions every landmark piece and ships every file', () => {
    for (const k of ['champdemars', 'tour2004', 'viaducdelmas', 'saintpierre', 'fortjacques', 'fortalexandre', 'sautdeau', 'foretdespins', 'sanssouci', 'jacmel', 'portsalut', 'labadeenight', 'bassinbleunight']) {
      expect(artByKey(k)?.place).toBeTruthy()
    }
  })
})

describe('heroes', () => {
  it('are captioned, live in kilti and stay out of the general pool', () => {
    for (const k of ['vertieres', 'toussaint', 'dessalines', 'catherineflon', 'christophe']) {
      const a = artByKey(k)
      expect(a?.place).toBeTruthy()
      expect(a?.worlds).toContain('kilti')
      expect(generalArt().map((g) => g.key)).not.toContain(k)
    }
  })
})
