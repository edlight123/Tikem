'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConsoleButton, ConsoleState, consoleTone } from '@/components/admin/console'
import { useToast } from '@/components/ui/Toast'

interface Organizer {
  id: string
  full_name: string
  email: string
  is_verified: boolean
  verification_status:
    | 'none'
    | 'pending'
    | 'pending_review'
    | 'in_review'
    | 'approved'
    | 'changes_requested'
    | 'rejected'
  created_at: string
}

interface Props {
  organizers: Organizer[]
}

export default function VerifyOrganizerForm({ organizers }: Props) {
  const { t } = useTranslation('admin')
  const { showToast } = useToast()
  const [updating, setUpdating] = useState<string | null>(null)
  const [localOrganizers, setLocalOrganizers] = useState(organizers)
  const [query, setQuery] = useState('')

  const normalizedQuery = query.trim().toLowerCase()
  const shouldShowResults = normalizedQuery.length >= 2
  const filtered = shouldShowResults
    ? localOrganizers.filter((o) => {
        const haystack = `${o.full_name || ''} ${o.email || ''}`.toLowerCase()
        return haystack.includes(normalizedQuery)
      })
    : []

  const toggleVerification = async (organizerId: string, currentStatus: boolean) => {
    setUpdating(organizerId)

    try {
      const response = await fetch('/api/admin/verify-organizer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizerId,
          isVerified: !currentStatus,
        }),
      })

      if (!response.ok) throw new Error('Failed to update verification')

      // Update local state
      setLocalOrganizers(prev =>
        prev.map(org =>
          org.id === organizerId
            ? { 
                ...org, 
                is_verified: !currentStatus,
                verification_status: !currentStatus ? 'approved' : 'none'
              }
            : org
        )
      )
    } catch (error) {
      console.error('Error updating verification:', error)
      showToast({
        type: 'error',
        title: 'Action failed',
        message: 'Failed to update verification status',
      })
    } finally {
      setUpdating(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="label-mono block text-eyebrow uppercase tracking-[0.18em] text-console-faint">{t('verify.override_search_label')}</label>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('verify.override_search_placeholder')}
          className="w-full px-3 py-2 rounded bg-console-ground text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut text-body sm:text-base"
        />
        <p className="text-caption sm:text-sm text-console-faint">{t('verify.override_search_hint')}</p>
      </div>

      {!shouldShowResults ? (
        <p className="text-console-faint text-center py-6">{t('verify.override_search_required')}</p>
      ) : filtered.length === 0 ? (
        <p className="text-console-faint text-center py-6">{t('verify.override_no_results')}</p>
      ) : (
        filtered.map(organizer => (
          <div
            key={organizer.id}
            className="flex items-center justify-between p-4 rounded-lg bg-console-ground hover:bg-console-raise transition-colors"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-console-text">{organizer.full_name}</h3>
                {organizer.verification_status === 'approved' && (
                  <svg className="w-5 h-5 text-console-green" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
              <p className="text-sm text-console-mut">{organizer.email}</p>
              <div className="flex items-center gap-2 mt-1">
                <p className="font-mono text-xs tabular-nums text-console-faint">
                  Joined {new Date(organizer.created_at).toLocaleDateString()}
                </p>
                {organizer.verification_status && organizer.verification_status !== 'none' && (
                  <ConsoleState tone={consoleTone(organizer.verification_status)}>
                    {organizer.verification_status
                      .replace(/[_-]+/g, ' ')
                      .replace(/\b\w/g, (c) => c.toUpperCase())}
                  </ConsoleState>
                )}
              </div>
            </div>

            <ConsoleButton
              variant={organizer.verification_status === 'approved' ? 'danger' : 'primary'}
              onClick={() => toggleVerification(organizer.id, organizer.verification_status === 'approved')}
              disabled={updating === organizer.id}
            >
              {updating === organizer.id
                ? t('verify.override_updating')
                : organizer.verification_status === 'approved'
                ? t('verify.override_remove')
                : t('verify.override_verify')}
            </ConsoleButton>
          </div>
        ))
      )}
    </div>
  )
}
