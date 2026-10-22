"use client"
import { useEffect, useState } from 'react'
import { subscribeToPush, unsubscribePush } from '@/lib/push'
import { sendTestNotification } from '@/lib/push'

const TOPICS = [
  { key: 'reminders', label: 'Event Reminders', desc: 'Notifications before your events start.' },
  { key: 'promotions', label: 'Promotions', desc: 'Discounts and special offers.' },
  { key: 'updates', label: 'Platform Updates', desc: 'New feature announcements.' }
]

interface Props { userId?: string }

export default function NotificationPreferences({ userId }: Props) {
  const [available, setAvailable] = useState<boolean>(false)
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [subscribed, setSubscribed] = useState(false)
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [topics, setTopics] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(localStorage.getItem('eh_push_topics') || '[]') } catch { return [] }
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setAvailable('serviceWorker' in navigator && 'PushManager' in window)
    setPermission(Notification.permission)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => {
        if (sub) {
          setSubscribed(true)
          setEndpoint(sub.endpoint)
        }
      }).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('eh_push_topics', JSON.stringify(topics))
    }
  }, [topics])

  function toggleTopic(key: string) {
    setTopics(t => t.includes(key) ? t.filter(x => x !== key) : [...t, key])
  }

  async function enable() {
    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
      setError('Missing VAPID key')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const sub = await subscribeToPush(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, topics, userId || undefined)
      if (!sub) {
        setPermission(Notification.permission)
        setError(Notification.permission === 'denied' ? 'Permission denied by user' : 'Failed to subscribe')
      } else {
        setSubscribed(true)
        setEndpoint(sub.endpoint)
        setPermission('granted')
      }
    } catch (e: any) {
      setError(e?.message || 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  async function disable() {
    if (!endpoint) return
    setLoading(true)
    setError(null)
    try {
      await unsubscribePush(endpoint)
      setSubscribed(false)
      setEndpoint(null)
    } catch (e: any) {
      setError('Failed to unsubscribe')
    } finally {
      setLoading(false)
    }
  }

  async function sendTest() {
    setLoading(true)
    setError(null)
    try { await sendTestNotification() } catch { setError('Failed to send test') } finally { setLoading(false) }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white/[0.03] rounded-2xl border border-white/10 shadow-soft p-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-white">Push Subscription</h2>
          <p className="text-sm text-white/65 mt-1">Real-time notifications delivered to your device.</p>
        </div>
        {!available && (
          <p className="text-sm text-red-400">Push not supported in this browser.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {TOPICS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => toggleTopic(t.key)}
              className={`px-3 py-1.5 rounded text-xs border transition ${topics.includes(t.key) ? 'bg-brand-600 text-white border-brand-600' : 'border-white/10 text-white/70 hover:bg-white/[0.04]'}`}
              aria-pressed={topics.includes(t.key)}
            >{t.label}</button>
          ))}
        </div>
        <div className="text-xs text-white/50">Selected Topics: {topics.length ? topics.join(', ') : 'None'}</div>
        <div className="flex gap-3">
          {!subscribed ? (
            <button
              onClick={enable}
              disabled={loading || !available}
              className="h-11 px-5 rounded-lg bg-brand-600 text-white text-sm font-medium shadow disabled:opacity-60"
            >{loading ? 'Enabling…' : 'Enable Push'}</button>
          ) : (
            <button
              onClick={disable}
              disabled={loading}
              className="h-11 px-5 rounded-lg bg-white/[0.06] text-white/90 text-sm font-medium shadow disabled:opacity-60"
            >{loading ? 'Removing…' : 'Disable Push'}</button>
          )}
          {subscribed && (
            <button
              onClick={sendTest}
              disabled={loading}
              className="h-11 px-4 rounded-lg bg-white/[0.03] border text-sm font-medium shadow disabled:opacity-60"
            >{loading ? 'Sending…' : 'Send Test'}</button>
          )}
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="text-xs text-white/50">Permission: {permission}</div>
        {endpoint && (
          <div className="text-[10px] text-white/50 break-all">Endpoint: {endpoint}</div>
        )}
      </div>
      <div className="bg-white/[0.03] rounded-2xl border border-white/10 shadow-soft p-6 space-y-4">
        <h3 className="text-sm font-semibold text-white">Topic Details</h3>
        <ul className="space-y-2 text-xs text-white/65">
          {TOPICS.map(t => (
            <li key={t.key} className="flex items-start gap-2">
              <span className="font-medium text-white/90 min-w-[90px]">{t.label}</span>
              <span className="flex-1">{t.desc}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
