'use client'

import { useState } from 'react'
import {
  ConsoleButton,
  ConsoleCaption,
  ConsolePanel,
  ConsoleSection,
  ConsoleState,
} from '@/components/admin/console'
import { useConfirm } from '@/components/ui/ConfirmProvider'

/**
 * Seed events — posts to the seed API to create 30 template events under the
 * info@edlight.org organizer, and reads back a verify endpoint that reports
 * whether those events are actually visible to the feed.
 *
 * Both requests, their payloads, the confirm dialog in front of the seed, and every
 * error path are unchanged by the console restyle; only the surfaces are.
 *
 * The page frame (container, breadcrumb trail, title) comes from DevToolShell.
 */
export default function SeedEventsClient() {
  const confirmDialog = useConfirm()
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [result, setResult] = useState<{
    success: boolean
    message: string
    events?: Array<{ id: string; title: string; location: string; date: string; price: string; currency: string }>
  } | null>(null)

  const [verifyResult, setVerifyResult] = useState<any>(null)

  const handleSeedEvents = async () => {
    const ok = await confirmDialog({
      title: 'Seed 30 template events?',
      description: 'This will create 30 template events under the info@edlight.org organizer.',
      confirmLabel: 'Seed events',
    })
    if (!ok) {
      return
    }

    setLoading(true)
    setResult(null)

    try {
      const response = await fetch('/api/admin/seed-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        cache: 'no-store',
      })

      const data = await response.json()

      if (!response.ok) {
        const details = data?.details ? `\n${JSON.stringify(data.details)}` : ''
        throw new Error(`${data.error || 'Failed to seed events'}${details}`)
      }

      setResult(data)
    } catch (error) {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to seed events',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async () => {
    setVerifying(true)
    setVerifyResult(null)
    try {
      const response = await fetch('/api/admin/seed-events/verify', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok) {
        const details = data?.details ? `\n${JSON.stringify(data.details)}` : ''
        throw new Error(`${data.error || 'Failed to verify'}${details}`)
      }
      setVerifyResult(data)
    } catch (error) {
      setVerifyResult({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to verify',
      })
    } finally {
      setVerifying(false)
    }
  }

  return (
    <>
      <ConsoleCaption>
        Creates 30 template events across Haiti, USA, and Canada under the info@edlight.org
        organizer account.
      </ConsoleCaption>

      <ConsoleSection>Quick diagnostics</ConsoleSection>
      <ConsolePanel className="px-4 py-3.5">
        <div className="text-[13px] text-console-mut">
          Demo mode (client build):{' '}
          <span className="label-mono text-console-text">{String(process.env.NEXT_PUBLIC_DEMO_MODE)}</span>
        </div>
        <div className="mt-0.5 text-[13px] text-console-mut">
          Firebase project (client):{' '}
          <span className="label-mono text-console-text">
            {String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)}
          </span>
        </div>
        <div className="mt-1.5 text-[13px] text-console-faint">
          If demo mode is <span className="label-mono">true</span>, Discover/Home will show demo
          events instead of Firestore.
        </div>
      </ConsolePanel>

      <div className="mt-3">
        <ConsoleButton onClick={handleVerify} disabled={verifying}>
          {verifying ? 'Verifying…' : 'Verify seeded events visibility'}
        </ConsoleButton>
      </div>

      {verifyResult && (
        <ConsolePanel className="mt-3 px-4 py-3.5">
          <ConsoleState tone={verifyResult.ok ? 'good' : 'bad'}>
            {verifyResult.ok ? 'Verify OK' : 'Verify failed'}
          </ConsoleState>
          <pre className="label-mono mt-2 overflow-auto whitespace-pre-wrap rounded bg-console-ground p-3 text-xs text-console-mut">
            {JSON.stringify(verifyResult, null, 2)}
          </pre>
        </ConsolePanel>
      )}

      <ConsoleSection>What will be created</ConsoleSection>
      <ConsolePanel className="px-4 py-3.5">
        <ul className="list-inside list-disc space-y-1 text-[13px] text-console-mut">
          <li>15 events in Haiti (50%) - Mix of USD and HTG pricing</li>
          <li>8 events in USA (Miami, New York, Boston, etc.)</li>
          <li>7 events in Canada (Montreal, Toronto, Vancouver, etc.)</li>
          <li>Categories: Music, Festival, Cultural, Food, Art, Conference, Workshop</li>
          <li>Multiple ticket tiers: Early Bird (30% off, expires 14 days before), General, VIP</li>
          <li>Haiti events: HTG 1,000-4,500 or USD $20-$100</li>
          <li>Event dates: 30-90 days in the future</li>
        </ul>
      </ConsolePanel>

      <div className="mt-4">
        <ConsoleButton variant="primary" onClick={handleSeedEvents} disabled={loading}>
          {loading ? 'Creating Events...' : 'Create 30 Template Events'}
        </ConsoleButton>
      </div>

      {result && (
        <ConsolePanel className="mt-4 px-4 py-3.5">
          <ConsoleState tone={result.success ? 'good' : 'bad'}>{result.message}</ConsoleState>
          {result.events && result.events.length > 0 && (
            <div className="mt-3 max-h-96 overflow-y-auto">
              <div className="label-mono mb-2 text-[10px] uppercase tracking-[0.18em] text-console-faint">
                Created events
              </div>
              <div className="space-y-1.5">
                {result.events.map((event, idx) => (
                  <div key={event.id} className="rounded bg-console-raise px-3 py-2">
                    <div className="text-[13px] font-medium text-console-text">
                      {idx + 1}. {event.title}
                    </div>
                    <div className="label-mono mt-0.5 text-xs text-console-mut">
                      {event.location} • {new Date(event.date).toLocaleDateString()} • {event.price}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </ConsolePanel>
      )}

      {result?.success && (
        <div className="mt-4 flex flex-wrap gap-3">
          <ConsoleButton onClick={() => (window.location.href = '/discover')}>
            View Events
          </ConsoleButton>
          <ConsoleButton onClick={() => (window.location.href = '/organizer/events')}>
            Manage Events
          </ConsoleButton>
        </div>
      )}
    </>
  )
}
