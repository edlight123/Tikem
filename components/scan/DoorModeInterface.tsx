'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { DoorModeTopBar } from '@/components/scan/DoorModeTopBar'
import { ScanViewport } from '@/components/scan/ScanViewport'
import { ScanResultOverlay } from '@/components/scan/ScanResultOverlay'
import { ScanBottomBar } from '@/components/scan/ScanBottomBar'
import { ManualLookupSheet } from '@/components/scan/ManualLookupSheet'
import { useScanController } from '@/lib/scan/useScanController'
import { performCheckIn, performOverrideCheckIn } from '@/app/organizer/scan/actions'
import type { CheckInParams, CheckInResult } from '@/lib/scan/checkInTicket'

interface DoorModeInterfaceProps {
  eventId: string
  eventTitle: string
  scannedBy: string
  tickets: any[]
  defaultEntryPoints?: string[]
  exitHref?: string
}

export function DoorModeInterface({
  eventId,
  eventTitle,
  scannedBy,
  tickets,
  defaultEntryPoints = ['Main Entrance', 'VIP Entrance', 'Gate A', 'Gate B'],
  exitHref,
}: DoorModeInterfaceProps) {
  const [entryPoint, setEntryPoint] = useState(defaultEntryPoints[0])
  const [showManualLookup, setShowManualLookup] = useState(false)
  const [currentTicketId, setCurrentTicketId] = useState<string | null>(null)
  const currentCodeRef = useRef<string | null>(null)
  const currentMethodRef = useRef<'scan' | 'manual'>('scan')

  // Who is in, kept locally so the counters move with every admit. Seeded
  // from the server; each VALID scan or override adds its ticket.
  const [checkedInIds, setCheckedInIds] = useState<Set<string>>(
    () => new Set(tickets.filter((t) => t.checked_in_at || t.checked_in).map((t) => String(t.id)))
  )
  const markIn = (ticketId: string) =>
    setCheckedInIds((prev) => {
      if (prev.has(ticketId)) return prev
      const next = new Set(prev)
      next.add(ticketId)
      return next
    })

  // The override's own verdict (re-entry allowed, or refused and why).
  const [overrideResult, setOverrideResult] = useState<CheckInResult | null>(null)
  const [overriding, setOverriding] = useState(false)
  const overrideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (overrideTimerRef.current) clearTimeout(overrideTimerRef.current)
  }, [])

  const stats = useMemo(() => {
    const ids = new Set(tickets.map((t) => String(t.id)))
    let checkedInCount = 0
    for (const id of checkedInIds) if (ids.has(id)) checkedInCount++
    return { checkedInCount, remainingCount: Math.max(0, tickets.length - checkedInCount) }
  }, [tickets, checkedInIds])

  // Prepare attendee list for manual lookup
  const attendees = useMemo(() => {
    return tickets.map((ticket) => ({
      ticketId: ticket.id,
      attendeeName: ticket.attendee?.full_name || ticket.attendee_name || ticket.attendee?.email || 'Guest',
      attendeeEmail: ticket.attendee?.email || '',
      ticketType: ticket.ticket_type || 'General Admission',
      checkedIn: checkedInIds.has(String(ticket.id)),
    }))
  }, [tickets, checkedInIds])

  // Scan controller
  const { state, result, handleScan, manualCheckIn, reset } = useScanController({
    onScan: async (ticketId, method, code) => {
      setCurrentTicketId(ticketId)
      currentCodeRef.current = code ?? null
      currentMethodRef.current = method
      const params: CheckInParams = {
        ticketId,
        eventId,
        entryPoint,
        scannedBy,
        checkInMethod: method,
        code: code ?? null,
      }
      const res = await performCheckIn(params)
      if (res.success) markIn(ticketId)
      return res
    },
    cooldownMs: 1200,
    duplicateWindowMs: 3000,
  })

  const closeOverride = () => {
    if (overrideTimerRef.current) clearTimeout(overrideTimerRef.current)
    overrideTimerRef.current = null
    setOverrideResult(null)
    reset()
  }

  const handleOverride = async () => {
    if (!currentTicketId || overriding) return
    setOverriding(true)

    const params: CheckInParams = {
      ticketId: currentTicketId,
      eventId,
      entryPoint,
      scannedBy,
      // The same code the first scan read, so a re-entry is judged on it too.
      checkInMethod: currentMethodRef.current,
      code: currentCodeRef.current,
    }

    let res: CheckInResult
    try {
      res = await performOverrideCheckIn(params)
    } catch {
      res = { success: false, type: 'INVALID', reason: 'NOT_FOUND' }
    }
    setOverriding(false)
    if (res.success) markIn(currentTicketId)
    // Show what actually happened: re-entry allowed, or refused (refunded,
    // cancelled, wrong code...) with the reason. A refusal stays until closed.
    setOverrideResult(res)
    if (res.success) {
      overrideTimerRef.current = setTimeout(closeOverride, 1800)
    }
  }

  return (
    <div className="fixed inset-0 bg-black flex flex-col">
      {/* Top Bar */}
      <DoorModeTopBar
        eventTitle={eventTitle}
        eventId={eventId}
        exitHref={exitHref}
        entryPoint={entryPoint}
        entryPoints={defaultEntryPoints}
        onEntryPointChange={setEntryPoint}
        checkedInCount={stats.checkedInCount}
        remainingCount={stats.remainingCount}
      />

      {/* Main Scanner Area */}
      <ScanViewport onScan={handleScan} isProcessing={state !== 'SCANNING'} />

      {/* Bottom Bar */}
      <ScanBottomBar onManualLookup={() => setShowManualLookup(true)} />

      {/* Result Overlay: the override's verdict replaces the scan's. */}
      {overrideResult ? (
        <ScanResultOverlay result={overrideResult} onClose={closeOverride} reentry />
      ) : (
        result && (
          <ScanResultOverlay
            result={result}
            onClose={reset}
            onOverride={handleOverride}
            overriding={overriding}
          />
        )
      )}

      {/* Manual Lookup Sheet */}
      <ManualLookupSheet
        isOpen={showManualLookup}
        onClose={() => setShowManualLookup(false)}
        attendees={attendees}
        onSelect={manualCheckIn}
      />
    </div>
  )
}
