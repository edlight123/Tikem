'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Ticket, BadgeCheck, AlarmClock, CalendarPlus, Mail, Bell, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

export default function TestNotificationsClient() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const router = useRouter()

  async function sendTest(type: string) {
    setLoading(true)
    setResult(null)
    
    try {
      const response = await fetch('/api/test-notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      })
      
      const data = await response.json()
      setResult(data)
      
      if (data.success) {
        // Refresh the page to show new notifications
        setTimeout(() => router.push('/notifications'), 1500)
      }
    } catch (error) {
      setResult({ error: 'Failed to send test notification' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="rounded-2xl bg-white/[0.03] p-8">
          <h1 className="text-3xl font-bold text-white mb-2">
            Test Notifications
          </h1>
          <p className="text-white/65 mb-8">
            Send test notifications to verify the notification system is working correctly.
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <button
              onClick={() => sendTest('ticket_purchase')}
              disabled={loading}
              className="flex flex-col items-start rounded-2xl bg-white/[0.055] p-6 text-left transition-colors hover:bg-white/[0.12] disabled:opacity-50"
            >
              <Ticket className="mb-3 h-6 w-6 text-white/70" aria-hidden />
              <span className="font-semibold text-white">Ticket Purchase</span>
              <span className="text-sm text-white/65">Test ticket confirmation notification</span>
            </button>

            <button
              onClick={() => sendTest('verification')}
              disabled={loading}
              className="flex flex-col items-start rounded-2xl bg-white/[0.055] p-6 text-left transition-colors hover:bg-white/[0.12] disabled:opacity-50"
            >
              <BadgeCheck className="mb-3 h-6 w-6 text-white/70" aria-hidden />
              <span className="font-semibold text-white">Verification</span>
              <span className="text-sm text-white/65">Test verification approved</span>
            </button>

            <button
              onClick={() => sendTest('event_reminder')}
              disabled={loading}
              className="flex flex-col items-start rounded-2xl bg-white/[0.055] p-6 text-left transition-colors hover:bg-white/[0.12] disabled:opacity-50"
            >
              <AlarmClock className="mb-3 h-6 w-6 text-white/70" aria-hidden />
              <span className="font-semibold text-white">Event Reminder</span>
              <span className="text-sm text-white/65">Test event reminder (24h)</span>
            </button>

            <button
              onClick={() => sendTest('new_event')}
              disabled={loading}
              className="flex flex-col items-start rounded-2xl bg-white/[0.055] p-6 text-left transition-colors hover:bg-white/[0.12] disabled:opacity-50"
            >
              <CalendarPlus className="mb-3 h-6 w-6 text-white/70" aria-hidden />
              <span className="font-semibold text-white">New Event</span>
              <span className="text-sm text-white/65">Test follower notification</span>
            </button>

            <button
              onClick={() => sendTest('email')}
              disabled={loading}
              className="flex flex-col items-start rounded-2xl bg-white/[0.055] p-6 text-left transition-colors hover:bg-white/[0.12] disabled:opacity-50"
            >
              <Mail className="mb-3 h-6 w-6 text-white/70" aria-hidden />
              <span className="font-semibold text-white">Email Test</span>
              <span className="text-sm text-white/65">Send test email</span>
            </button>

            <button
              onClick={() => router.push('/notifications')}
              className="flex flex-col items-start rounded-2xl bg-white/[0.055] p-6 text-left transition-colors hover:bg-white/[0.12]"
            >
              <Bell className="mb-3 h-6 w-6 text-white/70" aria-hidden />
              <span className="font-semibold text-white">View Notifications</span>
              <span className="text-sm text-white/65">Go to notifications page</span>
            </button>
          </div>

          {loading && (
            <div className="mt-6 flex items-center gap-2 rounded-2xl bg-white/[0.055] p-4">
              <Loader2 className="h-4 w-4 animate-spin text-white/60" aria-hidden />
              <p className="text-white/70">Sending notification...</p>
            </div>
          )}

          {result && (
            <div className={`mt-6 rounded-2xl p-4 ${
              result.success ? 'bg-emerald-500/10' : 'bg-red-500/10'
            }`}>
              <p className={`flex items-center gap-2 ${result.success ? 'text-emerald-300' : 'text-red-300'}`}>
                {result.success ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
                )}
                {result.success
                  ? 'Notification sent! Redirecting to notifications page...'
                  : `Error: ${result.error}`}
              </p>
              {result.sent && (
                <p className="text-sm text-white/65 mt-2">
                  Types sent: {result.sent.join(', ')}
                </p>
              )}
            </div>
          )}

          <div className="mt-8 rounded-2xl bg-white/[0.055] p-4">
            <h2 className="font-display lowercase italic !text-[22px] !leading-snug text-white mb-2">how to test</h2>
            <ol className="text-sm text-white/65 space-y-1 list-decimal list-inside">
              <li>Click any notification type above</li>
              <li>You&apos;ll be redirected to /notifications</li>
              <li>Check your notification bell icon</li>
              <li>Check browser push notifications (if enabled)</li>
              <li>Check your email inbox (for email test)</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
