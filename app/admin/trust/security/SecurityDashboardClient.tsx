'use client'

import { useState, useEffect, useCallback } from 'react'
import type React from 'react'
import { User as UserIcon, Globe, Clock, Zap, Ticket, Bot, CreditCard, Users } from 'lucide-react'
import { ConsoleButton, ConsoleInput, ConsolePanel, ConsoleState } from '@/components/admin/console'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { useToast } from '@/components/ui/Toast'

interface SuspiciousActivity {
  id: string
  user_id: string | null
  activity_type: string
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  ip_address: string | null
  detected_at: string
  reviewed: boolean
  reviewed_by: string | null
  reviewed_at: string | null
  action_taken: string | null
  users?: {
    name: string
    email: string
  }
}

const SEVERITY_COLORS = {
  low: 'text-console-mut',
  medium: 'text-console-amber',
  high: 'text-console-amber',
  critical: 'text-console-red',
}

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  rapid_purchases: 'Rapid Purchases',
  duplicate_tickets: 'Duplicate Tickets',
  unusual_location: 'Unusual Location',
  bot_behavior: 'Bot Behavior',
  chargeback: 'Chargeback',
  multiple_accounts: 'Multiple Accounts',
}

/* Lucide marks in place of the emoji the labels used to carry. */
const ACTIVITY_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  rapid_purchases: Zap,
  duplicate_tickets: Ticket,
  unusual_location: Globe,
  bot_behavior: Bot,
  chargeback: CreditCard,
  multiple_accounts: Users,
}

export default function SecurityDashboardClient() {
  const confirmDialog = useConfirm()
  const { showToast } = useToast()
  const [activities, setActivities] = useState<SuspiciousActivity[]>([])
  const [unreviewedCount, setUnreviewedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [rebuildStatus, setRebuildStatus] = useState<
    | null
    | {
        running: boolean
        step: 'users' | 'events' | 'tickets' | 'done'
        processed: { users: number; events: number; tickets: number }
        error?: string
      }
  >(null)
  const [filter, setFilter] = useState<{
    reviewed: string
    severity: string
    activityType: string
  }>({
    reviewed: 'false',
    severity: '',
    activityType: '',
  })
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [actionText, setActionText] = useState('')

  const rebuildSearchIndex = async () => {
    const ok = await confirmDialog({
      title: 'Rebuild admin search index now?',
      description: 'This reindexes all users, events, and tickets and may take a few minutes.',
      confirmLabel: 'Rebuild',
      variant: 'default',
    })
    if (!ok) return

    setRebuildStatus({
      running: true,
      step: 'users',
      processed: { users: 0, events: 0, tickets: 0 },
    })

    const runStep = async (type: 'users' | 'events' | 'tickets') => {
      let cursor: string | null = null
      let total = 0

      while (true) {
        setRebuildStatus((prev) =>
          prev
            ? {
                ...prev,
                running: true,
                step: type,
              }
            : prev
        )

        const res: Response = await fetch('/api/admin/search/rebuild', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, cursor, limit: 200 }),
        })

        const data: any = await res.json().catch(() => ({}))
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || data?.details || 'Rebuild failed')
        }

        total += Number(data.processed || 0)
        cursor = data.nextCursor || null

        setRebuildStatus((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            running: true,
            step: type,
            processed: {
              ...prev.processed,
              [type]: total,
            },
          }
        })

        if (data.done || !cursor) break
      }
    }

    try {
      await runStep('users')
      await runStep('events')
      await runStep('tickets')

      setRebuildStatus((prev) =>
        prev
          ? {
              ...prev,
              running: false,
              step: 'done',
            }
          : {
              running: false,
              step: 'done',
              processed: { users: 0, events: 0, tickets: 0 },
            }
      )
    } catch (e) {
      setRebuildStatus((prev) =>
        prev
          ? {
              ...prev,
              running: false,
              error: e instanceof Error ? e.message : 'Rebuild failed',
            }
          : {
              running: false,
              step: 'users',
              processed: { users: 0, events: 0, tickets: 0 },
              error: e instanceof Error ? e.message : 'Rebuild failed',
            }
      )
    }
  }

  const fetchActivities = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filter.reviewed) params.append('reviewed', filter.reviewed)
      if (filter.severity) params.append('severity', filter.severity)
      if (filter.activityType) params.append('activityType', filter.activityType)

      const response = await fetch(`/api/admin/suspicious-activities?${params}`)
      if (!response.ok) {
        throw new Error('Failed to fetch activities')
      }

      const data = await response.json()
      setActivities(data.activities || [])
      setUnreviewedCount(data.unreviewedCount || 0)
    } catch (error) {
      console.error('Error fetching activities:', error)
      showToast({
        type: 'error',
        title: 'Action failed',
        message: 'Failed to load suspicious activities',
      })
    } finally {
      setLoading(false)
    }
  }, [filter, showToast])

  useEffect(() => {
    fetchActivities()
  }, [fetchActivities])

  const handleReview = async (activityId: string, action: string) => {
    try {
      const response = await fetch('/api/admin/suspicious-activities', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityId, actionTaken: action }),
      })

      if (!response.ok) {
        throw new Error('Failed to update activity')
      }

      // Refresh list
      fetchActivities()
      setReviewingId(null)
      setActionText('')
    } catch (error) {
      console.error('Error reviewing activity:', error)
      showToast({
        type: 'error',
        title: 'Action failed',
        message: 'Failed to mark as reviewed',
      })
    }
  }

  const getSeverityBadge = (severity: string) => {
    return (
      <span
        className={`label-mono inline-flex items-center text-[11px] font-semibold uppercase tracking-wide ${
          SEVERITY_COLORS[severity as keyof typeof SEVERITY_COLORS]
        }`}
      >
        {severity.toUpperCase()}
      </span>
    )
  }

  const criticalCount = activities.filter((a) => a.severity === 'critical').length

  return (
    <div className="space-y-7">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-8">
        <div>
          <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Unreviewed</div>
          <div className="mt-1 font-mono text-xl tabular-nums text-console-text">{unreviewedCount}</div>
        </div>
        <div>
          <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Critical</div>
          <div className="mt-1 font-mono text-xl tabular-nums text-console-text">{criticalCount}</div>
        </div>
        <div>
          <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">In View</div>
          <div className="mt-1 font-mono text-xl tabular-nums text-console-text">{activities.length}</div>
        </div>
      </div>

      {/* Admin Tools */}
      <div>
        <div className="label-mono mb-2 text-[10px] uppercase tracking-[0.18em] text-console-faint">
          Admin Tools
        </div>
        <ConsolePanel className="p-4">
          <p className="mb-4 text-sm text-console-mut">
            Rebuild the admin search index so search is fully populated immediately.
          </p>

          <ConsoleButton
            type="button"
            variant="quiet"
            onClick={rebuildSearchIndex}
            disabled={Boolean(rebuildStatus?.running)}
          >
            {rebuildStatus?.running ? 'Rebuilding…' : 'Rebuild search index'}
          </ConsoleButton>

          {rebuildStatus && (
            <div className="mt-4 space-y-1 font-mono text-sm tabular-nums text-console-mut">
              <div>Users indexed: {rebuildStatus.processed.users}</div>
              <div>Events indexed: {rebuildStatus.processed.events}</div>
              <div>Tickets indexed: {rebuildStatus.processed.tickets}</div>
              {rebuildStatus.step !== 'done' && (
                <div className="text-console-faint">Current step: {rebuildStatus.step}</div>
              )}
              {rebuildStatus.step === 'done' && (
                <div className="font-semibold text-console-green">Rebuild complete</div>
              )}
              {rebuildStatus.error && (
                <div className="font-semibold text-console-red">{rebuildStatus.error}</div>
              )}
            </div>
          )}
        </ConsolePanel>
      </div>

      {/* Filters */}
      <div>
        <div className="label-mono mb-2 text-[10px] uppercase tracking-[0.18em] text-console-faint">
          Filters
        </div>
        <ConsolePanel className="p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="label-mono mb-1.5 block text-[10px] uppercase tracking-[0.18em] text-console-faint">
                Review Status
              </label>
              <select
                value={filter.reviewed}
                onChange={(e) => setFilter({ ...filter, reviewed: e.target.value })}
                className="min-h-[44px] w-full rounded bg-console-ground px-3 text-sm text-console-text focus:outline-none focus:ring-2 focus:ring-console-mut"
              >
                <option value="">All</option>
                <option value="false">Unreviewed</option>
                <option value="true">Reviewed</option>
              </select>
            </div>

            <div>
              <label className="label-mono mb-1.5 block text-[10px] uppercase tracking-[0.18em] text-console-faint">
                Severity
              </label>
              <select
                value={filter.severity}
                onChange={(e) => setFilter({ ...filter, severity: e.target.value })}
                className="min-h-[44px] w-full rounded bg-console-ground px-3 text-sm text-console-text focus:outline-none focus:ring-2 focus:ring-console-mut"
              >
                <option value="">All</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div>
              <label className="label-mono mb-1.5 block text-[10px] uppercase tracking-[0.18em] text-console-faint">
                Activity Type
              </label>
              <select
                value={filter.activityType}
                onChange={(e) => setFilter({ ...filter, activityType: e.target.value })}
                className="min-h-[44px] w-full rounded bg-console-ground px-3 text-sm text-console-text focus:outline-none focus:ring-2 focus:ring-console-mut"
              >
                <option value="">All</option>
                <option value="rapid_purchases">Rapid Purchases</option>
                <option value="duplicate_tickets">Duplicate Tickets</option>
                <option value="unusual_location">Unusual Location</option>
                <option value="bot_behavior">Bot Behavior</option>
                <option value="chargeback">Chargeback</option>
                <option value="multiple_accounts">Multiple Accounts</option>
              </select>
            </div>
          </div>
        </ConsolePanel>
      </div>

      {/* Activities List */}
      {loading ? (
        <div className="py-12 text-center">
          <p className="text-sm text-console-mut">Loading activities...</p>
        </div>
      ) : activities.length === 0 ? (
        <ConsolePanel className="p-12 text-center">
          <p className="text-sm text-console-mut">No suspicious activities found</p>
        </ConsolePanel>
      ) : (
        <div className="space-y-3">
          {activities.map((activity) => (
            <ConsolePanel key={activity.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="mb-2 flex items-center gap-3">
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-console-text">
                      {(() => {
                        const TypeIcon = ACTIVITY_TYPE_ICONS[activity.activity_type]
                        return TypeIcon ? <TypeIcon className="h-4 w-4 text-console-mut" aria-hidden /> : null
                      })()}
                      {ACTIVITY_TYPE_LABELS[activity.activity_type] || activity.activity_type}
                    </span>
                    {getSeverityBadge(activity.severity)}
                    {activity.reviewed && <ConsoleState tone="good">Reviewed</ConsoleState>}
                  </div>

                  <p className="mb-2 font-medium text-console-text">
                    {activity.description}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-console-mut">
                    {activity.users && (
                      <span className="inline-flex items-center gap-1.5">
                        <UserIcon className="h-3.5 w-3.5 text-console-faint" />
                        {activity.users.name} ({activity.users.email})
                      </span>
                    )}
                    {activity.ip_address && (
                      <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                        <Globe className="h-3.5 w-3.5 text-console-faint" />
                        {activity.ip_address}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                      <Clock className="h-3.5 w-3.5 text-console-faint" />
                      {new Date(activity.detected_at).toLocaleString()}
                    </span>
                  </div>

                  {activity.reviewed && activity.action_taken && (
                    <div className="mt-3 rounded bg-console-raise p-3">
                      <p className="text-sm text-console-mut">
                        <strong className="font-semibold text-console-text">Action Taken:</strong> {activity.action_taken}
                      </p>
                      {activity.reviewed_at && (
                        <p className="mt-1 font-mono text-xs tabular-nums text-console-faint">
                          Reviewed on {new Date(activity.reviewed_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {!activity.reviewed && (
                  <div className="shrink-0">
                    {reviewingId === activity.id ? (
                      <div className="flex flex-col gap-2">
                        <ConsoleInput
                          type="text"
                          placeholder="Action taken (optional)"
                          value={actionText}
                          onChange={(e) => setActionText(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <ConsoleButton
                            type="button"
                            variant="primary"
                            onClick={() => handleReview(activity.id, actionText)}
                          >
                            Confirm
                          </ConsoleButton>
                          <ConsoleButton
                            type="button"
                            variant="quiet"
                            onClick={() => {
                              setReviewingId(null)
                              setActionText('')
                            }}
                          >
                            Cancel
                          </ConsoleButton>
                        </div>
                      </div>
                    ) : (
                      <ConsoleButton type="button" variant="quiet" onClick={() => setReviewingId(activity.id)}>
                        Mark Reviewed
                      </ConsoleButton>
                    )}
                  </div>
                )}
              </div>
            </ConsolePanel>
          ))}
        </div>
      )}
    </div>
  )
}
