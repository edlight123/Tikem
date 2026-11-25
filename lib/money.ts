export function normalizeCurrency(code: string | null | undefined, fallback = 'HTG'): string {
  const normalized = String(code || '').trim().toUpperCase()
  return normalized ? normalized : fallback
}

export function formatMoneyFromCents(
  cents: number,
  currency: string = 'HTG',
  locale: string = 'en-US',
  options?: {
    currencyDisplay?: Intl.NumberFormatOptions['currencyDisplay']
  }
): string {
  const code = normalizeCurrency(currency)
  const amount = (Number.isFinite(cents) ? cents : 0) / 100

  // Gourde amounts are whole in practice: "HTG 1,500", never "HTG 1,500.00"
  // (owner, 2026-11-25). A converted amount with real cents keeps them.
  const decimals = code === 'HTG' && Math.abs(amount - Math.round(amount)) < 1e-9 ? 0 : 2
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: options?.currencyDisplay,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount)
  } catch {
    return `${code} ${amount.toFixed(decimals)}`
  }
}

/**
 * A price as the app shows it (mobile/lib/currency.ts formatCurrency, kept in
 * step by __tests__/money-format.test.ts): grouped, "$59.29" / "CA$12.50" /
 * "€5.00" with cents, and whole gourdes without them, "1,500 HTG". Major units.
 */
export function formatMoney(amount: number, currency?: string | null): string {
  const code = normalizeCurrency(currency, 'HTG')
  const value = Number.isFinite(amount) ? amount : 0
  const whole = Math.abs(value - Math.round(value)) < 1e-9
  const decimals = code === 'HTG' && whole ? 0 : 2
  const grouped = value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  if (code === 'USD') return `$${grouped}`
  if (code === 'CAD') return `CA$${grouped}`
  if (code === 'EUR') return `€${grouped}`
  if (code === 'DOP') return `RD$${grouped}`
  return `${grouped} ${code}`
}

export function formatMultiCurrencyFromCents(
  centsByCurrency: Record<string, number>,
  locale: string = 'en-US'
): string {
  const entries = Object.entries(centsByCurrency)
    .map(([currency, cents]) => [normalizeCurrency(currency), cents] as const)
    .filter(([, cents]) => Number.isFinite(cents) && cents !== 0)
    .sort(([a], [b]) => a.localeCompare(b))

  if (entries.length === 0) return 'No earnings yet'
  if (entries.length === 1) return formatMoneyFromCents(entries[0][1], entries[0][0], locale)

  return entries.map(([currency, cents]) => `${currency} ${((cents as number) / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(' + ')
}

export function formatPrimaryMoneyFromCentsByCurrency(
  centsByCurrency: Record<string, number>,
  preferredCurrency?: string | null,
  locale: string = 'en-US',
  options?: {
    currencyDisplay?: Intl.NumberFormatOptions['currencyDisplay']
  }
): string {
  const normalized: Record<string, number> = {}

  for (const [rawCurrency, rawCents] of Object.entries(centsByCurrency || {})) {
    const currency = normalizeCurrency(rawCurrency)
    const cents = Number(rawCents || 0)
    if (!Number.isFinite(cents) || cents === 0) continue
    normalized[currency] = (normalized[currency] || 0) + cents
  }

  const entries = Object.entries(normalized)
  if (entries.length === 0) return '—'

  const preferred = normalizeCurrency(preferredCurrency || '')
  if (preferred && Number.isFinite(normalized[preferred]) && normalized[preferred] !== 0) {
    return formatMoneyFromCents(normalized[preferred], preferred, locale, options)
  }

  // Fallback: show the dominant currency by absolute value.
  let bestCurrency = entries[0][0]
  let bestCents = entries[0][1]
  for (const [currency, cents] of entries) {
    if (Math.abs(cents) > Math.abs(bestCents)) {
      bestCurrency = currency
      bestCents = cents
    }
  }

  return formatMoneyFromCents(bestCents, bestCurrency, locale, options)
}
