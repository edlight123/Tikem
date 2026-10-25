import { filterEvents, isOnlineEvent } from '@/lib/filters/apply'
import { DEFAULT_FILTERS } from '@/lib/filters/types'

describe('Discover online filter', () => {
  const online = { id: 'a', is_online: true, venue_name: '', city: '' }
  const inPerson = { id: 'b', is_online: false, venue_name: 'Online Club', city: 'Port-au-Prince' }
  const legacy = { id: 'c', venue_name: 'Virtual stage' }
  const plain = { id: 'd', venue_name: 'Parc Historique' }

  it('reads is_online first, then the legacy venue guess', () => {
    expect(isOnlineEvent(online)).toBe(true)
    // A real venue whose name happens to contain "online" is in person when the flag says so.
    expect(isOnlineEvent(inPerson)).toBe(false)
    expect(isOnlineEvent(legacy)).toBe(true)
    expect(isOnlineEvent(plain)).toBe(false)
  })

  it('"online" keeps is_online events; "in-person" keeps the rest', () => {
    const all = [online, inPerson, legacy, plain]
    expect(filterEvents(all, { ...DEFAULT_FILTERS, eventType: 'online' } as any).map((e: any) => e.id)).toEqual(['a', 'c'])
    expect(filterEvents(all, { ...DEFAULT_FILTERS, eventType: 'in-person' } as any).map((e: any) => e.id)).toEqual(['b', 'd'])
  })
})
