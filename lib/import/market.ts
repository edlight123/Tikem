/**
 * Which Tikèm market an imported event lands in, and in what currency.
 *
 * Tikèm sells in four markets (lib/events/composer-country): HT (HTG or USD),
 * US (USD), CA (CAD) and FR (EUR), and firestore.rules refuses any other
 * country/currency pair. An event from Eventbrite or a pasted page can be
 * anywhere and priced in anything, so:
 *
 *   - a supported venue country wins; otherwise the currency names the market
 *     (HTG → HT, CAD → CA, EUR → FR, USD → the organizer's HT or US market,
 *     else US); otherwise the organizer's own starting country;
 *   - a currency the market allows is kept; a missing one becomes the
 *     market's default;
 *   - a PAID event whose currency the market does not allow is still
 *     imported, as a draft in the market's currency, and flagged so the
 *     organizer checks every price before publishing (an amount in GBP is
 *     not the same amount in EUR);
 *   - a venue in a country Tikèm does not serve is flagged too.
 *
 * Pure: shared by the link import, the Eventbrite import and the sync.
 */
import { COMPOSER_COUNTRIES, type ComposerCountry, defaultComposerCurrency } from '@/lib/events/composer-country'
import { normalizeSupportedCountry } from '@/lib/country-support'
import { isEventCurrencyAllowedForCountry, type EventCurrency } from '@/lib/currency-policy'
import { isBelowMinPaidPrice } from '@/lib/min-paid-price'

export type ImportFlag = 'currency_unsupported' | 'country_unsupported' | 'price_below_minimum'

export interface ImportMarket {
  country: ComposerCountry
  currency: EventCurrency
  flags: ImportFlag[]
  /** The currency the source listed, when it differs from `currency`. */
  sourceCurrency: string | null
}

const asComposer = (raw: unknown): ComposerCountry | null => {
  const code = normalizeSupportedCountry(raw)
  return (COMPOSER_COUNTRIES as readonly string[]).includes(code) ? (code as ComposerCountry) : null
}

/** Long country names to ISO codes for the few spellings pages use for our markets. */
const NAME_TO_CODE: Record<string, ComposerCountry> = {
  'HAÏTI': 'HT',
  'AYITI': 'HT',
  'ÉTATS-UNIS': 'US',
  'ETATS-UNIS': 'US',
}

export function resolveImportMarket(input: {
  country?: string | null
  currency?: string | null
  /** Prices of the ticket types being imported (major units). */
  prices: number[]
  /** The organizer's starting country (declared market, then defaults). */
  fallbackCountry?: string | null
}): ImportMarket {
  const flags: ImportFlag[] = []
  const rawCountry = String(input.country || '').trim()
  const rawCurrency = String(input.currency || '').trim().toUpperCase().slice(0, 3)
  const fallback = asComposer(input.fallbackCountry) || 'HT'
  const paid = input.prices.some((p) => Number(p) > 0)

  let country = asComposer(rawCountry) || NAME_TO_CODE[rawCountry.toUpperCase()] || null
  if (!country && rawCountry) flags.push('country_unsupported')
  if (!country) {
    if (rawCurrency === 'HTG') country = 'HT'
    else if (rawCurrency === 'CAD') country = 'CA'
    else if (rawCurrency === 'EUR') country = 'FR'
    else if (rawCurrency === 'USD') country = fallback === 'HT' || fallback === 'US' ? fallback : 'US'
    else country = fallback
  }

  let currency: EventCurrency
  let sourceCurrency: string | null = null
  if (rawCurrency && isEventCurrencyAllowedForCountry(country, rawCurrency)) {
    currency = rawCurrency as EventCurrency
  } else {
    currency = defaultComposerCurrency(country)
    if (rawCurrency && rawCurrency !== currency) {
      sourceCurrency = rawCurrency
      if (paid) flags.push('currency_unsupported')
    }
  }

  if (input.prices.some((p) => isBelowMinPaidPrice(p, country))) flags.push('price_below_minimum')
  return { country, currency, flags, sourceCurrency }
}
