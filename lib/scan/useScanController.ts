'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { parseTicketId } from './parseTicketId'
import type { CheckInResult } from './checkInTicket'

type ScanState = 'SCANNING' | 'PROCESSING' | 'RESULT'

interface UseScanControllerOptions {
  /** `code` is the raw string the camera read (absent for a manual pick), so the server can judge its QR version. */
  onScan: (ticketId: string, method: 'scan' | 'manual', code?: string) => Promise<CheckInResult>
  cooldownMs?: number
  duplicateWindowMs?: number
}

export function useScanController(options: UseScanControllerOptions) {
  const { onScan, cooldownMs = 1200, duplicateWindowMs = 3000 } = options

  const [state, setState] = useState<ScanState>('SCANNING')
  const [result, setResult] = useState<CheckInResult | null>(null)
  
  const lastScanRef = useRef<{
    ticketId: string | null
    timestamp: number
  }>({ ticketId: null, timestamp: 0 })

  const processingRef = useRef(false)
  const cooldownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (cooldownTimeoutRef.current) {
        clearTimeout(cooldownTimeoutRef.current)
        cooldownTimeoutRef.current = null
      }
    }
  }, [])

  const handleScan = useCallback(async (scanResult: string, method: 'scan' | 'manual' = 'scan') => {
    // Ignore if currently processing
    if (processingRef.current || state !== 'SCANNING') {
      console.log('Scan ignored: already processing or not in SCANNING state')
      return
    }

    // Parse ticket ID
    const ticketId = parseTicketId(scanResult)
    if (!ticketId) {
      console.log('Invalid scan result:', scanResult)
      return
    }

    const now = Date.now()

    // Check for duplicate scan within window
    if (
      lastScanRef.current.ticketId === ticketId &&
      now - lastScanRef.current.timestamp < duplicateWindowMs
    ) {
      console.log('Duplicate scan ignored:', ticketId)
      return
    }

    // Update last scan
    lastScanRef.current = {
      ticketId,
      timestamp: now,
    }

    // Lock processing
    processingRef.current = true
    if (mountedRef.current) setState('PROCESSING')

    try {
      // Perform check-in
      const checkInResult = await onScan(ticketId, method, method === 'scan' ? scanResult : undefined)
      
      // Show result
      if (mountedRef.current) {
        setResult(checkInResult)
        setState('RESULT')
      }

      // Auto-return to scanning after cooldown
      if (cooldownTimeoutRef.current) clearTimeout(cooldownTimeoutRef.current)
      cooldownTimeoutRef.current = setTimeout(() => {
        if (!mountedRef.current) return
        setState('SCANNING')
        setResult(null)
        processingRef.current = false
      }, cooldownMs)
    } catch (error) {
      console.error('Scan error:', error)
      
      // Return to scanning on error
      if (mountedRef.current) {
        setState('SCANNING')
        setResult(null)
      }
      processingRef.current = false
    }
  }, [state, onScan, cooldownMs, duplicateWindowMs])

  const manualCheckIn = useCallback(async (ticketId: string) => {
    // Same validation and locking as a scan, but the stored record must say a
    // human picked this attendee off a list — payout review reads that.
    await handleScan(ticketId, 'manual')
  }, [handleScan])

  const reset = useCallback(() => {
    if (cooldownTimeoutRef.current) {
      clearTimeout(cooldownTimeoutRef.current)
      cooldownTimeoutRef.current = null
    }
    setState('SCANNING')
    setResult(null)
    processingRef.current = false
  }, [])

  return {
    state,
    result,
    handleScan,
    manualCheckIn,
    reset,
    isProcessing: state === 'PROCESSING',
    isShowingResult: state === 'RESULT',
  }
}
