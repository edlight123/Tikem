'use client'

import { useState, useEffect } from 'react'
import { DEFAULT_MARKET_FEES, FEE_MARKETS, fixedFeeMinorFor, type FeeMarket, type LocationFeeConfig, type PlatformSettings } from '@/types/platform-settings'
import { FEE_MARKET_CURRENCY } from '@/lib/admin/market-fee-settings'
import { Clock } from 'lucide-react'
import { ConsoleButton, ConsoleInput, ConsolePanel } from '@/components/admin/console'

/** Field label: the console's mono-caps row label. */
function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="label-mono mb-1.5 block text-[10px] uppercase tracking-[0.18em] text-console-faint"
    >
      {children}
    </label>
  )
}

/** Section label between form groups. */
function SectionLabel({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-3">
      <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">
        {children}
      </div>
      {sub && <p className="mt-0.5 text-xs text-console-mut">{sub}</p>}
    </div>
  )
}

/** Display metadata per fee market. The fixed fee is in the market's currency. */
const MARKET_META: Record<FeeMarket, { name: string; anchor: string; symbol: string }> = {
  US: { name: 'United States', anchor: 'us', symbol: '$' },
  CA: { name: 'Canada', anchor: 'ca', symbol: 'C$' },
  FR: { name: 'France', anchor: 'fr', symbol: '€' },
}

type MarketDraft = { fee: string; fixed: string; hold: string }

/** The terms in force for a market: stored, else the shipped default (as checkout resolves them). */
function storedMarket(settings: PlatformSettings | null, market: FeeMarket): LocationFeeConfig {
  return settings?.markets?.[market] ?? DEFAULT_MARKET_FEES[market]
}

function draftFromMarket(cfg: LocationFeeConfig, market: FeeMarket): MarketDraft {
  return {
    fee: (cfg.platformFeePercentage * 100).toFixed(2),
    fixed: (fixedFeeMinorFor(cfg, FEE_MARKET_CURRENCY[market]) / 100).toFixed(2),
    hold: String(cfg.settlementHoldDays),
  }
}

function emptyDrafts(): Record<FeeMarket, MarketDraft> {
  return { US: { fee: '', fixed: '', hold: '' }, CA: { fee: '', fixed: '', hold: '' }, FR: { fee: '', fixed: '', hold: '' } }
}

/** "6.00% + $0.99": a market's terms in one line. */
function termsLabel(cfg: LocationFeeConfig, market: FeeMarket): string {
  const fixed = fixedFeeMinorFor(cfg, FEE_MARKET_CURRENCY[market])
  const pct = `${(cfg.platformFeePercentage * 100).toFixed(2)}%`
  return fixed > 0 ? `${pct} + ${MARKET_META[market].symbol}${(fixed / 100).toFixed(2)}` : pct
}

export function PlatformSettingsForm() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showConfirmModal, setShowConfirmModal] = useState(false)

  // Form state
  const [haitiPlatformFee, setHaitiPlatformFee] = useState('')
  const [haitiSettlementDays, setHaitiSettlementDays] = useState('')
  // US / CA / FR terms. The legacy `usCanada` rate is no longer edited here:
  // it prices none of these markets, so it is left exactly as stored.
  const [marketDrafts, setMarketDrafts] = useState<Record<FeeMarket, MarketDraft>>(emptyDrafts)
  const setMarketField = (market: FeeMarket, field: keyof MarketDraft, value: string) =>
    setMarketDrafts((prev) => ({ ...prev, [market]: { ...prev[market], [field]: value } }))
  const [minimumPayout, setMinimumPayout] = useState('')

  // Load settings on mount
  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/settings')
      const data = await response.json()

      if (data.success && data.settings) {
        setSettings(data.settings)

        // Populate form fields
        setHaitiPlatformFee((data.settings.haiti.platformFeePercentage * 100).toFixed(2))
        setHaitiSettlementDays(String(data.settings.haiti.settlementHoldDays))
        const drafts = emptyDrafts()
        for (const market of FEE_MARKETS) drafts[market] = draftFromMarket(storedMarket(data.settings, market), market)
        setMarketDrafts(drafts)
        setMinimumPayout((data.settings.minimumPayoutAmount / 100).toFixed(2))
      }
    } catch (error) {
      console.error('Error loading settings:', error)
      setMessage({ type: 'error', text: 'Failed to load settings' })
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validate first
    const haitiPlatformFeeNum = parseFloat(haitiPlatformFee)
    const haitiSettlementDaysNum = parseInt(haitiSettlementDays)
    const minimumPayoutNum = parseFloat(minimumPayout)

    if (isNaN(haitiPlatformFeeNum) || haitiPlatformFeeNum < 0 || haitiPlatformFeeNum > 100) {
      setMessage({ type: 'error', text: 'Haiti platform fee must be between 0 and 100%' })
      return
    }

    if (isNaN(haitiSettlementDaysNum) || haitiSettlementDaysNum < 0) {
      setMessage({ type: 'error', text: 'Haiti settlement days must be >= 0' })
      return
    }

    for (const market of FEE_MARKETS) {
      const draft = marketDrafts[market]
      const name = MARKET_META[market].name
      const fee = parseFloat(draft.fee)
      const fixed = parseFloat(draft.fixed)
      const hold = Number(draft.hold)
      if (isNaN(fee) || fee < 0 || fee >= 100) {
        setMessage({ type: 'error', text: `${name} platform fee must be at least 0% and below 100%` })
        return
      }
      if (isNaN(fixed) || fixed < 0 || fixed > 100) {
        setMessage({ type: 'error', text: `${name} fixed fee must be between 0 and 100 ${FEE_MARKET_CURRENCY[market]}` })
        return
      }
      if (!Number.isInteger(hold) || hold < 0 || hold > 365) {
        setMessage({ type: 'error', text: `${name} settlement days must be a whole number from 0 to 365` })
        return
      }
    }

    if (isNaN(minimumPayoutNum) || minimumPayoutNum < 0) {
      setMessage({ type: 'error', text: 'Minimum payout amount must be >= 0' })
      return
    }

    // Show confirmation modal
    setShowConfirmModal(true)
  }

  const confirmSave = async () => {
    setSaving(true)
    setMessage(null)
    setShowConfirmModal(false)

    try {
      const haitiPlatformFeeNum = parseFloat(haitiPlatformFee)
      const haitiSettlementDaysNum = parseInt(haitiSettlementDays)
      const minimumPayoutNum = parseFloat(minimumPayout)
      const markets = {} as Record<FeeMarket, LocationFeeConfig>
      for (const market of FEE_MARKETS) {
        const draft = marketDrafts[market]
        markets[market] = {
          // Rounded so 6.00% is stored as 0.06, not 0.06000000000000001.
          platformFeePercentage: Math.round(parseFloat(draft.fee) * 100) / 10_000,
          fixedFeeMinorPerTicket: { [FEE_MARKET_CURRENCY[market]]: Math.round(parseFloat(draft.fixed) * 100) },
          settlementHoldDays: Number(draft.hold),
        }
      }

      // Send update request
      const response = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          haiti: {
            platformFeePercentage: haitiPlatformFeeNum / 100,
            settlementHoldDays: haitiSettlementDaysNum,
          },
          markets,
          minimumPayoutAmount: Math.round(minimumPayoutNum * 100),
        }),
      })

      const data = await response.json()

      if (data.success) {
        setSettings(data.settings)
        const drafts = emptyDrafts()
        for (const market of FEE_MARKETS) drafts[market] = draftFromMarket(storedMarket(data.settings, market), market)
        setMarketDrafts(drafts)
        setMessage({ type: 'success', text: 'Settings updated successfully!' })
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to update settings' })
      }
    } catch (error) {
      console.error('Error updating settings:', error)
      setMessage({ type: 'error', text: 'Failed to update settings' })
    } finally {
      setSaving(false)
    }
  }

  // Calculate preview for a 100-unit ticket the organizer absorbs.
  const calculatePreview = (feePercent: number, fixedMajor = 0) => {
    const ticketPrice = 10000 // 100.00 in minor units
    if (isNaN(feePercent) || isNaN(fixedMajor)) return null

    const platformFee = Math.min(ticketPrice, Math.round(ticketPrice * (feePercent / 100)) + Math.round(fixedMajor * 100))
    // Stripe's cut is the platform's cost, paid out of the platform fee.
    const processingFee = Math.round(ticketPrice * 0.029) + 30
    const netAmount = ticketPrice - platformFee

    return {
      gross: (ticketPrice / 100).toFixed(2),
      platformFee: (platformFee / 100).toFixed(2),
      processingFee: (processingFee / 100).toFixed(2),
      net: (netAmount / 100).toFixed(2),
      netPercent: ((netAmount / ticketPrice) * 100).toFixed(1)
    }
  }

  const haitiPreview = calculatePreview(parseFloat(haitiPlatformFee))

  const marketChanged = (market: FeeMarket) => {
    if (!settings) return false
    const stored = draftFromMarket(storedMarket(settings, market), market)
    const draft = marketDrafts[market]
    return (
      parseFloat(draft.fee) !== parseFloat(stored.fee) ||
      parseFloat(draft.fixed) !== parseFloat(stored.fixed) ||
      Number(draft.hold) !== Number(stored.hold)
    )
  }

  const hasChanges = settings && (
    (parseFloat(haitiPlatformFee) !== settings.haiti.platformFeePercentage * 100) ||
    (parseInt(haitiSettlementDays) !== settings.haiti.settlementHoldDays) ||
    FEE_MARKETS.some(marketChanged) ||
    (parseFloat(minimumPayout) !== settings.minimumPayoutAmount / 100)
  )

  if (loading) {
    return (
      <ConsolePanel className="max-w-2xl p-4 sm:p-5">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-1/4 rounded bg-console-raise"></div>
          <div className="h-4 w-1/2 rounded bg-console-raise"></div>
          <div className="h-4 w-1/3 rounded bg-console-raise"></div>
        </div>
      </ConsolePanel>
    )
  }

  return (
    <>
      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg bg-console-panel p-6 shadow-xl">
            <h3 className="label-mono text-[13px] font-bold uppercase tracking-[0.14em] text-console-text">
              Confirm Settings Update
            </h3>
            <p className="mb-4 mt-2 text-sm text-console-mut">
              These changes will affect all future transactions. Are you sure you want to update the platform settings?
            </p>

            {/* Show changes */}
            <div className="mb-4 space-y-2 rounded bg-console-ground p-3 text-xs">
              {settings && parseFloat(haitiPlatformFee) !== settings.haiti.platformFeePercentage * 100 && (
                <div className="flex justify-between">
                  <span className="text-console-mut">Haiti Fee</span>
                  <span className="font-mono font-semibold tabular-nums text-console-text">
                    {(settings.haiti.platformFeePercentage * 100).toFixed(2)}% → {parseFloat(haitiPlatformFee).toFixed(2)}%
                  </span>
                </div>
              )}
              {settings && parseInt(haitiSettlementDays) !== settings.haiti.settlementHoldDays && (
                <div className="flex justify-between">
                  <span className="text-console-mut">Haiti Settlement</span>
                  <span className="font-mono font-semibold tabular-nums text-console-text">
                    {settings.haiti.settlementHoldDays} days → {parseInt(haitiSettlementDays)} days
                  </span>
                </div>
              )}
              {settings && FEE_MARKETS.filter(marketChanged).map((market) => {
                const draft = marketDrafts[market]
                const next: LocationFeeConfig = {
                  platformFeePercentage: parseFloat(draft.fee) / 100,
                  fixedFeeMinorPerTicket: { [FEE_MARKET_CURRENCY[market]]: Math.round(parseFloat(draft.fixed) * 100) },
                  settlementHoldDays: Number(draft.hold),
                }
                const before = storedMarket(settings, market)
                return (
                  <div key={market} className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-console-mut">{MARKET_META[market].name} Fee</span>
                      <span className="font-mono font-semibold tabular-nums text-console-text">
                        {termsLabel(before, market)} → {termsLabel(next, market)}
                      </span>
                    </div>
                    {before.settlementHoldDays !== next.settlementHoldDays && (
                      <div className="flex justify-between">
                        <span className="text-console-mut">{MARKET_META[market].name} Settlement</span>
                        <span className="font-mono font-semibold tabular-nums text-console-text">
                          {before.settlementHoldDays} days → {next.settlementHoldDays} days
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex justify-end gap-3">
              <ConsoleButton type="button" variant="quiet" onClick={() => setShowConfirmModal(false)}>
                Cancel
              </ConsoleButton>
              <ConsoleButton type="button" variant="primary" onClick={confirmSave} disabled={saving}>
                {saving ? 'Saving...' : 'Confirm'}
              </ConsoleButton>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-2xl space-y-8">
        {/* Current settings — live summary strip */}
        {settings && (
          <div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-8 sm:gap-y-4">
              <div>
                <p className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Haiti fee</p>
                <p className="mt-1 font-mono text-xl tabular-nums text-console-text">{(settings.haiti.platformFeePercentage * 100).toFixed(2)}%</p>
              </div>
              <div>
                <p className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Haiti hold</p>
                <p className="mt-1 font-mono text-xl tabular-nums text-console-text">{settings.haiti.settlementHoldDays}<span className="text-sm text-console-mut"> days</span></p>
              </div>
              {FEE_MARKETS.map((market) => (
                <div key={market}>
                  <p className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">{market} fee</p>
                  <p className="mt-1 font-mono text-xl tabular-nums text-console-text">{termsLabel(storedMarket(settings, market), market)}</p>
                </div>
              ))}
              <div>
                <p className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Min payout</p>
                <p className="mt-1 font-mono text-xl tabular-nums text-console-text">${(settings.minimumPayoutAmount / 100).toFixed(2)}</p>
              </div>
            </div>
            {settings.updatedBy && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-console-faint">
                <Clock className="h-3.5 w-3.5" /> Last updated by {settings.updatedBy}
              </p>
            )}
          </div>
        )}

        {/* Info note */}
        <p className="text-[13px] text-console-mut">
          These settings apply to all future transactions. Changes take effect immediately and are applied to new ticket sales and earnings calculations.
        </p>

        {/* Section navigation — this page is long, and payout settings live on
            their own pages; one row makes the whole settings surface legible
            (owner call, 2026-08-29: "weird to navigate"). */}
        <nav
          aria-label="Settings sections"
          className="scrollbar-hide -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0"
        >
          {[
            { href: '#haiti', label: 'Haiti' },
            ...FEE_MARKETS.map((market) => ({ href: `#${MARKET_META[market].anchor}`, label: MARKET_META[market].name })),
            { href: '#global', label: 'Global' },
            { href: '/admin/money/release-rules', label: 'Payout release ↗' },
            { href: '/admin/money/disbursements', label: 'Payout queue ↗' },
          ].map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="label-mono shrink-0 whitespace-nowrap rounded bg-console-panel px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-console-mut transition-colors hover:bg-console-raise hover:text-console-text"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Message Banner */}
          {message && (
            <ConsolePanel
              className={`p-4 text-sm ${message.type === 'success' ? 'text-console-green' : 'text-console-red'}`}
            >
              {message.text}
            </ConsolePanel>
          )}

          {/* Haiti Settings Section */}
          <section id="haiti" className="scroll-mt-24">
            <SectionLabel sub="Settings for events in Haiti">Haiti Events</SectionLabel>
            <ConsolePanel className="space-y-4 p-4 sm:p-5">
              <div>
                <FieldLabel htmlFor="haitiPlatformFee">Platform Fee (%)</FieldLabel>
                <div className="relative">
                  <ConsoleInput
                    type="number"
                    id="haitiPlatformFee"
                    value={haitiPlatformFee}
                    onChange={(e) => setHaitiPlatformFee(e.target.value)}
                    step="0.01"
                    min="0"
                    max="100"
                    className="pr-8"
                    required
                  />
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                    <span className="text-sm text-console-faint">%</span>
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-console-faint">
                  Commission taken from each sale
                </p>
              </div>

              <div>
                <FieldLabel htmlFor="haitiSettlementDays">Settlement Hold Days</FieldLabel>
                <ConsoleInput
                  type="number"
                  id="haitiSettlementDays"
                  value={haitiSettlementDays}
                  onChange={(e) => setHaitiSettlementDays(e.target.value)}
                  min="0"
                  required
                />
                <p className="mt-1.5 text-xs text-console-faint">
                  Days before funds can be withdrawn
                </p>
              </div>

              {/* Haiti Preview */}
              {haitiPreview && (
                <div className="rounded bg-console-ground p-3">
                  <p className="label-mono mb-2 text-[10px] uppercase tracking-[0.18em] text-console-faint">Example: $100 ticket sale</p>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-console-mut">Ticket Price</span>
                      <span className="font-mono font-semibold tabular-nums text-console-text">${haitiPreview.gross}</span>
                    </div>
                    <div className="flex justify-between text-console-red">
                      <span>Platform Fee</span>
                      <span className="font-mono tabular-nums">-${haitiPreview.platformFee}</span>
                    </div>
                    <div className="flex justify-between text-console-mut">
                      <span>Processing (paid by Tikèm)</span>
                      <span className="font-mono tabular-nums">${haitiPreview.processingFee}</span>
                    </div>
                    <div className="flex justify-between font-semibold text-console-green">
                      <span>Organizer Earns</span>
                      <span className="font-mono tabular-nums">${haitiPreview.net} ({haitiPreview.netPercent}%)</span>
                    </div>
                  </div>
                </div>
              )}
            </ConsolePanel>
          </section>

          {/* Per-market sections (US, CA, FR): what prices every event there. */}
          {FEE_MARKETS.map((market) => {
            const meta = MARKET_META[market]
            const currency = FEE_MARKET_CURRENCY[market]
            const draft = marketDrafts[market]
            const preview = calculatePreview(parseFloat(draft.fee), parseFloat(draft.fixed))
            const id = market.toLowerCase()
            return (
              <section key={market} id={meta.anchor} className="scroll-mt-24">
                <SectionLabel sub={`Settings for events in ${meta.name}, priced in ${currency}`}>{`${meta.name} Events`}</SectionLabel>
                <ConsolePanel className="space-y-4 p-4 sm:p-5">
                  <div>
                    <FieldLabel htmlFor={`${id}PlatformFee`}>Platform Fee (%)</FieldLabel>
                    <div className="relative">
                      <ConsoleInput
                        type="number"
                        id={`${id}PlatformFee`}
                        value={draft.fee}
                        onChange={(e) => setMarketField(market, 'fee', e.target.value)}
                        step="0.01"
                        min="0"
                        max="99.99"
                        className="pr-8"
                        required
                      />
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                        <span className="text-sm text-console-faint">%</span>
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs text-console-faint">
                      Percentage of each paid ticket
                    </p>
                  </div>

                  <div>
                    <FieldLabel htmlFor={`${id}FixedFee`}>{`Fixed Fee per Paid Ticket (${currency})`}</FieldLabel>
                    <div className="relative">
                      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                        <span className="text-sm text-console-faint">{meta.symbol}</span>
                      </div>
                      <ConsoleInput
                        type="number"
                        id={`${id}FixedFee`}
                        value={draft.fixed}
                        onChange={(e) => setMarketField(market, 'fixed', e.target.value)}
                        step="0.01"
                        min="0"
                        max="100"
                        className="pl-9 pr-3"
                        required
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-console-faint">
                      Added once per paid ticket; free tickets never carry it
                    </p>
                  </div>

                  <div>
                    <FieldLabel htmlFor={`${id}SettlementDays`}>Settlement Hold Days</FieldLabel>
                    <ConsoleInput
                      type="number"
                      id={`${id}SettlementDays`}
                      value={draft.hold}
                      onChange={(e) => setMarketField(market, 'hold', e.target.value)}
                      min="0"
                      max="365"
                      step="1"
                      required
                    />
                    <p className="mt-1.5 text-xs text-console-faint">
                      Days before funds can be withdrawn
                    </p>
                  </div>

                  {preview && (
                    <div className="rounded bg-console-ground p-3">
                      <p className="label-mono mb-2 text-[10px] uppercase tracking-[0.18em] text-console-faint">{`Example: ${meta.symbol}100 ticket, fee absorbed`}</p>
                      <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between">
                          <span className="text-console-mut">Ticket Price</span>
                          <span className="font-mono font-semibold tabular-nums text-console-text">{meta.symbol}{preview.gross}</span>
                        </div>
                        <div className="flex justify-between text-console-red">
                          <span>Platform Fee</span>
                          <span className="font-mono tabular-nums">-{meta.symbol}{preview.platformFee}</span>
                        </div>
                        <div className="flex justify-between text-console-mut">
                          <span>Processing (paid by Tikèm)</span>
                          <span className="font-mono tabular-nums">{meta.symbol}{preview.processingFee}</span>
                        </div>
                        <div className="flex justify-between font-semibold text-console-green">
                          <span>Organizer Earns</span>
                          <span className="font-mono tabular-nums">{meta.symbol}{preview.net} ({preview.netPercent}%)</span>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-console-faint">
                        When the organizer passes the fee on, the buyer pays it on top and the organizer keeps the full price.
                      </p>
                    </div>
                  )}
                </ConsolePanel>
              </section>
            )
          })}

          {/* Global Settings Section */}
          <section id="global" className="scroll-mt-24">
            <SectionLabel sub="Settings that apply to all events">Global Settings</SectionLabel>
            <ConsolePanel className="p-4 sm:p-5">
              <div>
                <FieldLabel htmlFor="minimumPayout">Minimum Payout Amount</FieldLabel>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <span className="text-sm text-console-faint">$</span>
                  </div>
                  <ConsoleInput
                    type="number"
                    id="minimumPayout"
                    value={minimumPayout}
                    onChange={(e) => setMinimumPayout(e.target.value)}
                    step="0.01"
                    min="0"
                    className="pl-7 pr-3"
                    required
                  />
                </div>
                <p className="mt-1.5 text-xs text-console-faint">
                  Minimum required for withdrawal (USD)
                </p>
              </div>
            </ConsolePanel>
          </section>

          {/* Sticky Save Bar */}
          <div className="sticky bottom-4 z-10 flex items-center justify-between gap-4 rounded-lg bg-console-raise px-4 py-3">
            <p className="text-sm">
              {hasChanges ? (
                <span className="font-medium text-console-amber">● Unsaved changes</span>
              ) : (
                <span className="text-console-mut">All changes saved</span>
              )}
            </p>
            <ConsoleButton type="submit" variant="primary" disabled={saving || !hasChanges} className="inline-flex items-center">
              {saving ? (
                <>
                  <svg
                    className="animate-spin -ml-1 mr-2 h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  Saving...
                </>
              ) : (
                'Save Settings'
              )}
            </ConsoleButton>
          </div>
        </form>
      </div>
    </>
  )
}
