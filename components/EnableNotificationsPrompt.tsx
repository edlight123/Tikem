'use client'

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bell, X } from 'lucide-react'
import { requestNotificationPermission, canRequestNotificationPermission } from '@/lib/fcm'

interface EnableNotificationsPromptProps {
  userId: string
  onClose?: () => void
  onSuccess?: () => void
  context?: 'purchase' | 'favorite' | 'settings'
}

export function EnableNotificationsPrompt({ 
  userId, 
  onClose, 
  onSuccess,
  context = 'purchase'
}: EnableNotificationsPromptProps) {
  const { t } = useTranslation('common')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Don't show if user already denied permission
  if (!canRequestNotificationPermission()) {
    return null
  }

  const getContextMessage = () => {
    switch (context) {
      case 'purchase':
        return t('notifications_prompt.context_purchase', 'Get notified about your ticket, event updates, and reminders!')
      case 'favorite':
        return t('notifications_prompt.context_favorite', 'Get notified when this event is updated or when tickets go on sale!')
      case 'settings':
        return t('notifications_prompt.context_settings', 'Stay updated with event reminders and important notifications.')
      default:
        return t('notifications_prompt.context_default', 'Get notified about your events and tickets!')
    }
  }

  const handleEnable = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await requestNotificationPermission(userId)
      
      if (result.success) {
        onSuccess?.()
        onClose?.()
      } else {
        setError(result.error || 'Failed to enable notifications')
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-[#1c1c1c] p-5">
      {/* Decorative only: a faint teal glow in one corner. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(45,212,191,0.14),transparent_70%)]"
      />

      {/* Close button */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/[0.08] hover:text-white/70"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      <div className="relative">
        {/* Eyebrow */}
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.08]">
            <Bell className="h-4 w-4 text-white/80" />
          </div>
          <span className="h-1.5 w-1.5 rounded-full bg-brand-400" aria-hidden="true" />
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">
            {t('notifications.title', 'Notifications')}
          </span>
        </div>

        <h3 className="mb-1 pr-8 font-display lowercase italic !text-[22px] !leading-snug text-white">
          {t('notifications_prompt.title', 'Enable Notifications')}
        </h3>
        <p className="mb-4 text-sm text-white/60">
          {getContextMessage()}
        </p>

        {error && (
          <div className="mb-4 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleEnable}
            disabled={isLoading}
            className="h-11 rounded-full bg-white px-6 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? t('notifications_prompt.enabling', 'Enabling...') : t('notifications_prompt.enable', 'Enable')}
          </button>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="text-sm font-medium text-white/55 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('notifications_prompt.not_now', 'Not Now')}
          </button>
        </div>
      </div>
    </div>
  )
}
