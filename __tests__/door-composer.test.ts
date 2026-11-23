import { composerModeOf, canLeaveDoorMode, tierEditorPrice, doorTierSaveFields, lowestDoorPrice } from '@/lib/events/door-mode'
import { isPaidEvent } from '@/lib/events/paid-event'

describe('pay at the door in the composer', () => {
  it('opens an event in the mode it was saved in', () => {
    expect(composerModeOf({ pay_at_door: true }, [])).toBe('door')
    expect(composerModeOf({}, [{ price: 0, door_price: 10 }])).toBe('door')
    expect(composerModeOf({ is_rsvp: true }, [])).toBe('rsvp')
    expect(composerModeOf({ ticket_name: 'RSVP' }, [])).toBe('rsvp')
    expect(composerModeOf({}, [{ price: 20 }])).toBe('tickets')
    expect(composerModeOf(null, [])).toBe('tickets')
  })

  it('shows the door price in the editor and saves it as price 0 + door_price', () => {
    expect(tierEditorPrice({ price: 0, door_price: 15 })).toBe('15')
    expect(tierEditorPrice({ price: 20 })).toBe('20')
    expect(tierEditorPrice({})).toBe('0')
    expect(doorTierSaveFields('door', 15)).toEqual({ price: 0, door_price: 15 })
    expect(doorTierSaveFields('tickets', 15)).toEqual({ price: 15, door_price: null })
    expect(doorTierSaveFields('rsvp', 0)).toEqual({ price: 0, door_price: null })
  })

  it('a saved door event is never a paid event (no Stripe gate, no payout setup)', () => {
    expect(isPaidEvent({ ticket_price: 0, pay_at_door: true }, [{ price: 0, door_price: 15 }])).toBe(false)
    expect(isPaidEvent({ ticket_price: 0 }, [{ price: 20 }])).toBe(true)
  })

  it('cannot leave door mode once people have reserved', () => {
    expect(canLeaveDoorMode([{ soldQuantity: 0 }, { soldQuantity: 0 }])).toBe(true)
    expect(canLeaveDoorMode([{ soldQuantity: 2 }])).toBe(false)
    expect(canLeaveDoorMode([])).toBe(true)
  })
})

describe('lowestDoorPrice', () => {
  it('is the cheapest door price, or null', () => {
    expect(lowestDoorPrice([{ door_price: 30 }, { door_price: 10 }, { door_price: null }])).toBe(10)
    expect(lowestDoorPrice([{ door_price: null }])).toBeNull()
    expect(lowestDoorPrice([])).toBeNull()
  })
})
