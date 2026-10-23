jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))
import { organizerSaleCopy } from '@/lib/notifications/helpers'

describe('organizer sale notification copy', () => {
  it('a free claim says claimed, with no amount', () => {
    const c = organizerSaleCopy(1, 0, 'HTG')
    expect(c.title).toBe('🎟️ 1 Free Ticket Claimed')
    expect(c.body('Konpa Night', 'Ana')).toBe('Ana claimed a free ticket for "Konpa Night".')
    expect(c.push).toBe('A free ticket just claimed')
    expect(`${c.title} ${c.body('x')} ${c.push}`).not.toMatch(/0\.00|\$/)
  })

  it('pluralises free claims', () => {
    const c = organizerSaleCopy(3, 0)
    expect(c.title).toBe('🎟️ 3 Free Tickets Claimed')
    expect(c.push).toBe('3 free tickets just claimed')
  })

  it('a paid sale shows the amount in its own currency, not a hard-coded $', () => {
    const htg = organizerSaleCopy(2, 14000, 'HTG')
    expect(htg.push).toMatch(/^2 tickets sold for HTG\s?14,000\.00$/)
    expect(htg.push).not.toContain('$')
    expect(organizerSaleCopy(1, 59.29, 'USD').push).toBe('1 ticket sold for $59.29')
  })
})
