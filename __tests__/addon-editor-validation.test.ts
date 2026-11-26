/**
 * The redesigned add-on sheet (web components/organizer/AddOnsEditor, app
 * mobile/components/organizer/AddOnsEditor): what blocks a save, the sales
 * window, clearing the optional end, and restricting an add-on to a ticket
 * that is not saved yet. The stored shape the checkout reads is unchanged:
 * sales_start / sales_end ISO instants or null, tier_ids = ticket_tiers doc ids.
 */
import {
  addOnsFromDrafts,
  draftProblem,
  draftsAwaitTierIds,
  draftsFromAddOns,
  emptyAddOnDraft,
  isoToLocalInputValue,
  localInputValueToIso,
  savedTierIds,
} from '@/lib/addons/editor'
import { addOnAvailability } from '@/lib/addons/addOns'
import {
  addOnProblem,
  hasDraftTierIds,
  isDraftTierKey,
  newDraftTierKey,
  remapAddOnTierIds,
  stripDraftTierIds,
} from '../mobile/lib/addOnDraft'

const draft = (p: Partial<ReturnType<typeof emptyAddOnDraft>> = {}) => ({ ...emptyAddOnDraft(), name: 'Iftar meal', price: '15', ...p })

describe('web add-on drafts', () => {
  it('needs a name and a price above 0; an untouched draft is not a problem', () => {
    expect(draftProblem(emptyAddOnDraft())).toBeNull()
    expect(draftProblem(draft({ name: '' }))).toBe('name')
    expect(draftProblem(draft({ price: '0' }))).toBe('price')
    expect(draftProblem(draft({ price: '' }))).toBe('price')
    expect(draftProblem(draft())).toBeNull()
  })

  it('sales must end after they start; either bound may be empty', () => {
    expect(draftProblem(draft({ salesStart: '2027-03-01T18:00', salesEnd: '2027-03-01T18:00' }))).toBe('window')
    expect(draftProblem(draft({ salesStart: '2027-03-01T18:00', salesEnd: '2027-03-01T17:00' }))).toBe('window')
    expect(draftProblem(draft({ salesStart: '2027-03-01T18:00', salesEnd: '2027-03-02T09:00' }))).toBeNull()
    expect(draftProblem(draft({ salesStart: '2027-03-01T18:00', salesEnd: '' }))).toBeNull()
    expect(draftProblem(draft({ salesStart: '', salesEnd: '2027-03-01T18:00' }))).toBeNull()
  })

  it('saves the same fields the checkout reads; a cleared end is null (open)', () => {
    const [a] = addOnsFromDrafts([draft({ salesStart: '2027-03-01T18:00', salesEnd: '', options: 'S, M' })])
    expect(a.sales_start).toBe(new Date('2027-03-01T18:00').toISOString())
    expect(a.sales_end).toBeNull()
    expect(a.options).toEqual(['S', 'M'])
    // Open-ended: still on sale long after the start.
    expect(addOnAvailability(a, { now: new Date('2027-06-01T00:00:00Z') })).toBe('available')
    expect(addOnAvailability(a, { now: new Date('2027-02-01T00:00:00Z') })).toBe('not_started')
  })

  it('round-trips the picker value across a DST change', () => {
    for (const v of ['2027-03-14T02:30', '2027-03-14T03:30', '2027-11-07T01:30', '2027-12-31T23:59']) {
      const iso = localInputValueToIso(v)!
      expect(iso).not.toBeNull()
      // A wall-clock time that does not exist (spring forward) moves, never vanishes.
      expect(isoToLocalInputValue(iso)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    }
    expect(isoToLocalInputValue(localInputValueToIso('2027-12-31T23:59'))).toBe('2027-12-31T23:59')
    expect(localInputValueToIso('')).toBeNull()
  })

  it('a restriction on an unsaved ticket waits for its doc id, never stores a missing one', () => {
    const d = draft({ tierIds: ['row_new', 'tier_saved'] })
    expect(draftsAwaitTierIds([d], ['tier_saved'])).toBe(true)
    // First write: only the saved ticket.
    expect(addOnsFromDrafts([d], ['tier_saved'])[0].tier_ids).toEqual(['tier_saved'])
    // After the tiers are written: the new row maps to its doc.
    expect(addOnsFromDrafts([d], ['tier_saved', 'tier_new'], { row_new: 'tier_new' })[0].tier_ids).toEqual(['tier_new', 'tier_saved'])
    expect(savedTierIds(['row_gone'], ['tier_saved'], {})).toEqual([])
    expect(draftsAwaitTierIds([draft({ tierIds: ['tier_saved'] })], ['tier_saved'])).toBe(false)
  })

  it('reads stored add-ons back unchanged (backward compatible)', () => {
    const stored = [{ id: 'ao_1', name: 'Shirt', price: 25, options: ['S', 'M'], sales_start: '2027-03-01T18:00:00.000Z', sales_end: null, tier_ids: ['t1'] }]
    const back = addOnsFromDrafts(draftsFromAddOns(stored), ['t1'])
    expect(back[0]).toMatchObject({ id: 'ao_1', name: 'Shirt', price: 25, options: ['S', 'M'], sales_start: '2027-03-01T18:00:00.000Z', sales_end: null, tier_ids: ['t1'] })
  })
})

describe('app add-on sheet', () => {
  it('needs a name, a price above 0 and an end after the start', () => {
    expect(addOnProblem({ name: '', price: '5' })).toBe('name')
    expect(addOnProblem({ name: 'Meal', price: '0' })).toBe('price')
    expect(addOnProblem({ name: 'Meal', price: '4,50' })).toBeNull()
    expect(addOnProblem({ name: 'Meal', price: '5', sales_start: '2027-03-01T18:00:00Z', sales_end: '2027-03-01T17:00:00Z' })).toBe('window')
    expect(addOnProblem({ name: 'Meal', price: '5', sales_start: '2027-03-01T18:00:00Z', sales_end: '' })).toBeNull()
  })

  it('swaps unsaved ticket keys for doc ids, and drops them when there is none', () => {
    const key = newDraftTierKey()
    expect(isDraftTierKey(key)).toBe(true)
    const list = [{ id: 'a', tier_ids: [key, 't1'] }, { id: 'b', tier_ids: [] }]
    expect(hasDraftTierIds(list)).toBe(true)
    expect(stripDraftTierIds(list)[0].tier_ids).toEqual(['t1'])
    expect(remapAddOnTierIds(list, { [key]: 't9' })[0].tier_ids).toEqual(['t9', 't1'])
    expect(remapAddOnTierIds(list, {})[0].tier_ids).toEqual(['t1'])
    expect(hasDraftTierIds(remapAddOnTierIds(list, {}))).toBe(false)
  })
})
