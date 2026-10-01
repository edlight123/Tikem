'use client'

import { useState, useEffect } from 'react'
import { PlatformSettings } from '@/types/platform-settings'
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

export function PlatformSettingsForm() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showConfirmModal, setShowConfirmModal] = useState(false)

  // Form state
  const [haitiPlatformFee, setHaitiPlatformFee] = useState('')
  const [haitiSettlementDays, setHaitiSettlementDays] = useState('')
  const [usCanadaPlatformFee, setUsCanadaPlatformFee] = useState('')
  const [usCanadaSettlementDays, setUsCanadaSettlementDays] = useState('')
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
        setUsCanadaPlatformFee((data.settings.usCanada.platformFeePercentage * 100).toFixed(2))
        setUsCanadaSettlementDays(String(data.settings.usCanada.settlementHoldDays))
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
    const usCanadaPlatformFeeNum = parseFloat(usCanadaPlatformFee)
    const usCanadaSettlementDaysNum = parseInt(usCanadaSettlementDays)
    const minimumPayoutNum = parseFloat(minimumPayout)

    if (isNaN(haitiPlatformFeeNum) || haitiPlatformFeeNum < 0 || haitiPlatformFeeNum > 100) {
      setMessage({ type: 'error', text: 'Haiti platform fee must be between 0 and 100%' })
      return
    }

    if (isNaN(haitiSettlementDaysNum) || haitiSettlementDaysNum < 0) {
      setMessage({ type: 'error', text: 'Haiti settlement days must be >= 0' })
      return
    }

    if (isNaN(usCanadaPlatformFeeNum) || usCanadaPlatformFeeNum < 0 || usCanadaPlatformFeeNum > 100) {
      setMessage({ type: 'error', text: 'US/Canada platform fee must be between 0 and 100%' })
      return
    }

    if (isNaN(usCanadaSettlementDaysNum) || usCanadaSettlementDaysNum < 0) {
      setMessage({ type: 'error', text: 'US/Canada settlement days must be >= 0' })
      return
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
      const usCanadaPlatformFeeNum = parseFloat(usCanadaPlatformFee)
      const usCanadaSettlementDaysNum = parseInt(usCanadaSettlementDays)
      const minimumPayoutNum = parseFloat(minimumPayout)

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
          usCanada: {
            platformFeePercentage: usCanadaPlatformFeeNum / 100,
            settlementHoldDays: usCanadaSettlementDaysNum,
          },
          minimumPayoutAmount: Math.round(minimumPayoutNum * 100),
        }),
      })

      const data = await response.json()

      if (data.success) {
        setSettings(data.settings)
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

  // Calculate preview for $100 ticket
  const calculatePreview = (region: 'haiti' | 'usCanada') => {
    const ticketPrice = 10000 // $100 in cents
    const feePercent = region === 'haiti' ? parseFloat(haitiPlatformFee) : parseFloat(usCanadaPlatformFee)

    if (isNaN(feePercent)) return null

    const platformFee = Math.round(ticketPrice * (feePercent / 100))
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

  const haitiPreview = calculatePreview('haiti')
  const usCanadaPreview = calculatePreview('usCanada')

  const hasChanges = settings && (
    (parseFloat(haitiPlatformFee) !== settings.haiti.platformFeePercentage * 100) ||
    (parseInt(haitiSettlementDays) !== settings.haiti.settlementHoldDays) ||
    (parseFloat(usCanadaPlatformFee) !== settings.usCanada.platformFeePercentage * 100) ||
    (parseInt(usCanadaSettlementDays) !== settings.usCanada.settlementHoldDays) ||
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
              {settings && parseFloat(usCanadaPlatformFee) !== settings.usCanada.platformFeePercentage * 100 && (
                <div className="flex justify-between">
                  <span className="text-console-mut">US/Canada Fee</span>
                  <span className="font-mono font-semibold tabular-nums text-console-text">
                    {(settings.usCanada.platformFeePercentage * 100).toFixed(2)}% → {parseFloat(usCanadaPlatformFee).toFixed(2)}%
                  </span>
                </div>
              )}
              {settings && parseInt(usCanadaSettlementDays) !== settings.usCanada.settlementHoldDays && (
                <div className="flex justify-between">
                  <span className="text-console-mut">US/Canada Settlement</span>
                  <span className="font-mono font-semibold tabular-nums text-console-text">
                    {settings.usCanada.settlementHoldDays} days → {parseInt(usCanadaSettlementDays)} days
                  </span>
                </div>
              )}
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
              <div>
                <p className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">US/CA fee</p>
                <p className="mt-1 font-mono text-xl tabular-nums text-console-text">{(settings.usCanada.platformFeePercentage * 100).toFixed(2)}%</p>
              </div>
              <div>
                <p className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">US/CA hold</p>
                <p className="mt-1 font-mono text-xl tabular-nums text-console-text">{settings.usCanada.settlementHoldDays}<span className="text-sm text-console-mut"> days</span></p>
              </div>
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
            { href: '#us-canada', label: 'US & Canada' },
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

          {/* US/Canada Settings Section */}
          <section id="us-canada" className="scroll-mt-24">
            <SectionLabel sub="Settings for events in United States or Canada">US &amp; Canada Events</SectionLabel>
            <ConsolePanel className="space-y-4 p-4 sm:p-5">
              <div>
                <FieldLabel htmlFor="usCanadaPlatformFee">Platform Fee (%)</FieldLabel>
                <div className="relative">
                  <ConsoleInput
                    type="number"
                    id="usCanadaPlatformFee"
                    value={usCanadaPlatformFee}
                    onChange={(e) => setUsCanadaPlatformFee(e.target.value)}
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
                <FieldLabel htmlFor="usCanadaSettlementDays">Settlement Hold Days</FieldLabel>
                <ConsoleInput
                  type="number"
                  id="usCanadaSettlementDays"
                  value={usCanadaSettlementDays}
                  onChange={(e) => setUsCanadaSettlementDays(e.target.value)}
                  min="0"
                  required
                />
                <p className="mt-1.5 text-xs text-console-faint">
                  Days before funds can be withdrawn
                </p>
              </div>

              {/* US/Canada Preview */}
              {usCanadaPreview && (
                <div className="rounded bg-console-ground p-3">
                  <p className="label-mono mb-2 text-[10px] uppercase tracking-[0.18em] text-console-faint">Example: $100 ticket sale</p>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-console-mut">Ticket Price</span>
                      <span className="font-mono font-semibold tabular-nums text-console-text">${usCanadaPreview.gross}</span>
                    </div>
                    <div className="flex justify-between text-console-red">
                      <span>Platform Fee</span>
                      <span className="font-mono tabular-nums">-${usCanadaPreview.platformFee}</span>
                    </div>
                    <div className="flex justify-between text-console-mut">
                      <span>Processing (paid by Tikèm)</span>
                      <span className="font-mono tabular-nums">${usCanadaPreview.processingFee}</span>
                    </div>
                    <div className="flex justify-between font-semibold text-console-green">
                      <span>Organizer Earns</span>
                      <span className="font-mono tabular-nums">${usCanadaPreview.net} ({usCanadaPreview.netPercent}%)</span>
                    </div>
                  </div>
                </div>
              )}
            </ConsolePanel>
          </section>

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
