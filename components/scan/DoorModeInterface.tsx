'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { DoorModeTopBar } from '@/components/scan/DoorModeTopBar'
import { ScanViewport } from '@/components/scan/ScanViewport'
import { ScanResultOverlay } from '@/components/scan/ScanResultOverlay'
import { ScanBottomBar } from '@/components/scan/ScanBottomBar'
import { ManualLookupSheet } from '@/components/scan/ManualLookupSheet'
import { useScanController } from '@/lib/scan/useScanController'
import { performCheckIn, performOverrideCheckIn } from '@/app/organizer/scan/actions'
import type { CheckInParams } from '@/lib/scan/checkInTicket'

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

  // Calculate stats
  const stats = useMemo(() => {
    const checkedInCount = tickets.filter((t) => t.checked_in_at).length
    const remainingCount = tickets.length - checkedInCount
    return { checkedInCount, remainingCount }
  }, [tickets])

  // Prepare attendee list for manual lookup
  const attendees = useMemo(() => {
    return tickets.map((ticket) => ({
      ticketId: ticket.id,
      attendeeName: ticket.attendee?.full_name || ticket.attendee?.email || 'Guest',
      attendeeEmail: ticket.attendee?.email || '',
      ticketType: ticket.ticket_type || 'General Admission',
      checkedIn: !!ticket.checked_in_at,
    }))
  }, [tickets])

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
      return await performCheckIn(params)
    },
    cooldownMs: 1200,
    duplicateWindowMs: 3000,
  })

  const handleOverride = async () => {
    if (!currentTicketId) return

    const params: CheckInParams = {
      ticketId: currentTicketId,
      eventId,
      entryPoint,
      scannedBy,
      // The same code the first scan read, so a re-entry is judged on it too.
      checkInMethod: currentMethodRef.current,
      code: currentCodeRef.current,
    }

    const overrideResult = await performOverrideCheckIn(params)
    
    // Show result and reset after cooldown
    setTimeout(() => {
      reset()
    }, 1200)
  }

  return (
    <div className="fixed inset-0 bg-gray-900 flex flex-col">
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

      {/* Result Overlay */}
      {result && (
        <ScanResultOverlay
          result={result}
          onClose={reset}
          onOverride={handleOverride}
        />
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
