/**
 * Ready-made ticket types for the composers, one tap each. A set fills a fresh
 * draft (one untouched tier) or is added after the tiers already there; new
 * rows copy the first tier's price and quantity, and every name stays editable.
 * Mirror of the web's lib/ticketTypes.ts (the app cannot import it); parity test.
 */
export type TierName = { en: string; fr: string; ht: string }

export interface TierSet {
  key: string
  names: TierName[]
}

const GENERAL: TierName = { en: 'General', fr: 'Général', ht: 'Jeneral' }
const VIP: TierName = { en: 'VIP', fr: 'VIP', ht: 'VIP' }

export const TIER_SETS: TierSet[] = [
  { key: 'general_vip', names: [GENERAL, VIP] },
  { key: 'general_vip_table', names: [GENERAL, VIP, { en: 'Table', fr: 'Table', ht: 'Tab' }] },
  {
    key: 'early_general_door',
    names: [{ en: 'Early bird', fr: 'Prévente', ht: 'Prevant' }, GENERAL, { en: 'Door', fr: 'Sur place', ht: 'Nan pòt la' }],
  },
  { key: 'students_general', names: [{ en: 'Students', fr: 'Étudiants', ht: 'Etidyan' }, GENERAL] },
  { key: 'adults_children', names: [{ en: 'Adults', fr: 'Adultes', ht: 'Granmoun' }, { en: 'Children', fr: 'Enfants', ht: 'Timoun' }] },
]

/** A tier name in the composer's language (en, fr or ht; anything else reads English). */
export function tierNameFor(name: TierName, lang: string | null | undefined): string {
  const l = String(lang || 'en').slice(0, 2)
  return l === 'fr' ? name.fr : l === 'ht' ? name.ht : name.en
}

/** The chip label for a set: its names joined with a middle dot. */
export function tierSetLabel(set: TierSet, lang: string | null | undefined): string {
  return set.names.map((n) => tierNameFor(n, lang)).join(' · ')
}

/** A fresh draft is one tier nobody has named (or named only the default) or saved yet. */
export function isUntouchedDraft(tiers: Array<{ name?: string | null; docId?: string | null; id?: string | null }>, savedKey: 'docId' | 'id' = 'docId'): boolean {
  if (tiers.length !== 1) return false
  const t = tiers[0]
  if (t[savedKey]) return false
  const name = String(t.name || '').trim()
  return !name || name === 'General Admission'
}
