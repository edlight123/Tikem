'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Camera, Search, Users, CheckCircle, XCircle, Clock, AlertCircle, Menu } from 'lucide-react'
import { QRScanner } from './QRScanner'
import { useTranslation } from 'react-i18next'

interface Ticket {
  id: string
  event_id: string
  attendee_name: string
  attendee_email: string
  ticket_type: string
  qr_code: string
  checked_in: boolean
  checked_in_at: string | null
  entry_point: string | null
  status: string
}

interface Event {
  id: string
  title: string
  start_datetime: string
}

interface CheckInInterfaceProps {
  event: Event
  tickets: Ticket[]
  onCheckIn: (
    eventId: string,
    qrCode: string,
    entryPoint: string,
    method?: 'scan' | 'manual'
  ) => Promise<{ success: boolean; error?: string }>
}

type ScanResult = {
  type: 'success' | 'error' | 'already-checked-in'
  ticket?: Ticket
  message: string
}

export function CheckInInterface({ event, tickets, onCheckIn }: CheckInInterfaceProps) {
  const { t } = useTranslation('organizer')
  const router = useRouter()
  const [showScanner, setShowScanner] = useState(false)
  const [showManualLookup, setShowManualLookup] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEntryPoint, setSelectedEntryPoint] = useState('Main Entrance')
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  // Calculate stats
  const stats = useMemo(() => {
    const total = tickets.length
    const checkedIn = tickets.filter(t => t.checked_in).length
    const remaining = total - checkedIn
    
    return { total, checkedIn, remaining }
  }, [tickets])

  // Get recent check-ins
  const recentCheckIns = useMemo(() => {
    return tickets
      .filter(t => t.checked_in && t.checked_in_at)
      .sort((a, b) => new Date(b.checked_in_at!).getTime() - new Date(a.checked_in_at!).getTime())
      .slice(0, 10)
  }, [tickets])

  // Handle QR scan
  const handleScan = async (qrCode: string, method: 'scan' | 'manual' = 'scan') => {
    if (isProcessing) return
    
    setIsProcessing(true)
    setShowScanner(false)
    
    try {
      const result = await onCheckIn(event.id, qrCode, selectedEntryPoint, method)
      
      if (result.success) {
        const ticket = tickets.find(t => t.qr_code === qrCode || t.id === qrCode)
        
        if (ticket?.checked_in) {
          setScanResult({
            type: 'already-checked-in',
            ticket,
            message: 'Already checked in'
          })
        } else {
          setScanResult({
            type: 'success',
            ticket,
            message: 'Check-in successful!'
          })
          
          // Refresh page data
          setTimeout(() => {
            router.refresh()
          }, 2000)
        }
      } else {
        setScanResult({
          type: 'error',
          message: result.error || 'Invalid ticket'
        })
      }
    } catch (error) {
      setScanResult({
        type: 'error',
        message: 'Check-in failed. Please try again.'
      })
    } finally {
      setIsProcessing(false)
      
      // Clear result after 3 seconds
      setTimeout(() => {
        setScanResult(null)
      }, 3000)
    }
  }

  // Handle manual check-in
  const handleManualCheckIn = async (ticketId: string) => {
    // Picked by name: no code to judge, so a transferred ticket still admits.
    await handleScan(ticketId, 'manual')
    setShowManualLookup(false)
    setSearchQuery('')
  }

  // Filter tickets for manual lookup
  const filteredTickets = useMemo(() => {
    if (!searchQuery.trim()) return []
    
    const query = searchQuery.toLowerCase()
    return tickets.filter(t => 
      t.attendee_name.toLowerCase().includes(query) ||
      t.attendee_email.toLowerCase().includes(query) ||
      t.id.toLowerCase().includes(query)
    ).slice(0, 20)
  }, [searchQuery, tickets])

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="px-4 py-4 flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold truncate">{event.title}</h1>
            <p className="text-sm text-white/70 mt-0.5">{t('door.checkin_scanner', { defaultValue: 'Check-In Scanner' })}</p>
          </div>
          <Link
            href={`/organizer/events/${event.id}/attendees`}
            className="ml-4 flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
          >
            <Users className="w-4 h-4" />
            <span className="hidden sm:inline">{t('door.manage', { defaultValue: 'Manage' })}</span>
          </Link>
        </div>
      </div>

      {/* Live Stats */}
      <div className="bg-gradient-to-br from-teal-600 to-teal-700 px-4 py-6">
        <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto">
          <div className="text-center">
            <div className="text-3xl font-bold">{stats.checkedIn}</div>
            <div className="text-sm text-teal-100 mt-1">{t('door.checked_in', { defaultValue: 'Checked In' })}</div>
          </div>
          <div className="text-center border-x border-teal-500">
            <div className="text-3xl font-bold">{stats.remaining}</div>
            <div className="text-sm text-teal-100 mt-1">{t('door.remaining', { defaultValue: 'Remaining' })}</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold">{stats.total}</div>
            <div className="text-sm text-teal-100 mt-1">{t('door.total', { defaultValue: 'Total' })}</div>
          </div>
        </div>
        
        {/* Progress Bar */}
        <div className="max-w-2xl mx-auto mt-4">
          <div className="h-2 bg-teal-800 rounded-full overflow-hidden">
            <div 
              className="h-full bg-white transition-all duration-500"
              style={{ width: `${stats.total > 0 ? (stats.checkedIn / stats.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* Entry Point Selector */}
      <div className="bg-gray-800 px-4 py-3 border-b border-gray-700">
        <label className="block text-sm font-medium text-white/70 mb-2">{t('door.entry_point', { defaultValue: 'Entry Point' })}</label>
        <select
          value={selectedEntryPoint}
          onChange={(e) => setSelectedEntryPoint(e.target.value)}
          className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
        >
          <option value="Main Entrance">{t('door.entry_main_entrance', { defaultValue: 'Main Entrance' })}</option>
          <option value="VIP Entrance">{t('door.entry_vip_entrance', { defaultValue: 'VIP Entrance' })}</option>
          <option value="Side Door">{t('door.entry_side_door', { defaultValue: 'Side Door' })}</option>
          <option value="Back Entrance">{t('door.entry_back_entrance', { defaultValue: 'Back Entrance' })}</option>
        </select>
      </div>

      {/* Scan Result Overlay */}
      {scanResult && (
        <div className="fixed inset-0 bg-black/80 z-40 flex items-center justify-center p-4">
          <div className={`max-w-md w-full rounded-2xl p-8 text-center ${
            scanResult.type === 'success' ? 'bg-green-600' :
            scanResult.type === 'already-checked-in' ? 'bg-yellow-600' :
            'bg-red-600'
          }`}>
            {scanResult.type === 'success' && <CheckCircle className="w-20 h-20 mx-auto mb-4" />}
            {scanResult.type === 'already-checked-in' && <Clock className="w-20 h-20 mx-auto mb-4" />}
            {scanResult.type === 'error' && <XCircle className="w-20 h-20 mx-auto mb-4" />}
            
            <h2 className="text-2xl font-bold mb-2">{scanResult.message}</h2>
            
            {scanResult.ticket && (
              <div className="mt-4 bg-black/20 rounded-xl p-4">
                <p className="font-semibold text-lg">{scanResult.ticket.attendee_name}</p>
                <p className="text-sm opacity-90 mt-1">{scanResult.ticket.ticket_type}</p>
                {scanResult.ticket.checked_in_at && (
                  <p className="text-xs opacity-75 mt-2">
                    Checked in at {new Date(scanResult.ticket.checked_in_at).toLocaleTimeString()}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Action Buttons */}
      <div className="p-4 space-y-3">
        <button
          onClick={() => setShowScanner(true)}
          disabled={isProcessing}
          className="w-full flex items-center justify-center gap-3 px-6 py-6 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-700 rounded-2xl font-bold text-lg shadow-lg transition-colors"
        >
          <Camera className="w-8 h-8" />
          {isProcessing ? 'Processing...' : 'Scan QR Code'}
        </button>

        <button
          onClick={() => setShowManualLookup(true)}
          className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gray-700 hover:bg-gray-600 rounded-xl font-semibold transition-colors"
        >
          <Search className="w-5 h-5" />
          {t('check_in.manual_lookup')}
        </button>
      </div>

      {/* Recent Check-Ins */}
      <div className="px-4 pb-20">
        <h2 className="text-lg font-bold mb-3">{t('door.recent_checkins', { defaultValue: 'Recent Check-Ins' })}</h2>
        
        {recentCheckIns.length === 0 ? (
          <div className="bg-gray-800 rounded-xl p-8 text-center">
            <Clock className="w-12 h-12 text-white/65 mx-auto mb-3" />
            <p className="text-white/70">{t('door.no_checkins_yet', { defaultValue: 'No check-ins yet' })}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentCheckIns.map((ticket) => (
              <div key={ticket.id} className="bg-gray-800 rounded-xl p-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{ticket.attendee_name}</p>
                  <p className="text-sm text-white/70 truncate">{ticket.ticket_type}</p>
                </div>
                <div className="text-right ml-4">
                  <CheckCircle className="w-5 h-5 text-green-400 mb-1" />
                  <p className="text-xs text-white/70">
                    {ticket.checked_in_at && new Date(ticket.checked_in_at).toLocaleTimeString([], { 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* QR Scanner Modal */}
      {showScanner && (
        <QRScanner
          onScan={(code: string) => handleScan(code, 'scan')}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* Manual Lookup Modal */}
      {showManualLookup && (
        <div className="fixed inset-0 bg-black/90 z-50 flex flex-col">
          <div className="bg-gray-800 p-4 flex items-center justify-between border-b border-gray-700">
            <h2 className="text-lg font-bold">{t('door.manual_lookup', { defaultValue: 'Manual Lookup' })}</h2>
            <button
              onClick={() => {
                setShowManualLookup(false)
                setSearchQuery('')
              }}
              className="p-2 hover:bg-gray-700 rounded-lg"
            >
              <XCircle className="w-6 h-6" />
            </button>
          </div>

          <div className="p-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/70" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('door.search_placeholder', { defaultValue: 'Search by name, email, or ticket ID...' })}
                autoFocus
                className="w-full pl-12 pr-4 py-3 bg-gray-700 border border-gray-600 rounded-xl text-white placeholder-white/40 focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {searchQuery.trim() && filteredTickets.length === 0 && (
              <div className="text-center py-12">
                <AlertCircle className="w-12 h-12 text-white/65 mx-auto mb-3" />
                <p className="text-white/70">{t('door.no_tickets_found', { defaultValue: 'No tickets found' })}</p>
              </div>
            )}

            <div className="space-y-2">
              {filteredTickets.map((ticket) => (
                <button
                  key={ticket.id}
                  onClick={() => handleManualCheckIn(ticket.id)}
                  disabled={ticket.checked_in}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                    ticket.checked_in
                      ? 'bg-gray-800 border-gray-700 opacity-50'
                      : 'bg-gray-700 border-gray-600 hover:border-teal-500'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{ticket.attendee_name}</p>
                      <p className="text-sm text-white/70 truncate">{ticket.attendee_email}</p>
                      <p className="text-xs text-white/70 mt-1">{ticket.ticket_type}</p>
                    </div>
                    {ticket.checked_in ? (
                      <CheckCircle className="w-6 h-6 text-green-400 ml-4" />
                    ) : (
                      <div className="ml-4 px-3 py-1 bg-teal-600 rounded-lg text-sm font-semibold">
                        {t('actions.check_in')}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
