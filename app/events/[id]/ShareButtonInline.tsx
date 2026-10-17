'use client'

import { useState } from 'react'
import { Share2, Copy, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ShareButtonInlineProps {
  eventId: string
  eventTitle: string
  eventDate?: string
  eventVenue?: string
}

export default function ShareButtonInline({ eventId, eventTitle, eventDate, eventVenue }: ShareButtonInlineProps) {
  const { t } = useTranslation('common')
  const [copied, setCopied] = useState(false)

  const eventUrl = typeof window !== 'undefined' ? `${window.location.origin}/events/${eventId}` : ''
  
  const getShareText = () => {
    let text = `🎉 ${eventTitle}\n\n`
    if (eventDate) text += `📅 ${eventDate}\n`
    if (eventVenue) text += `📍 ${eventVenue}\n\n`
    text += t('checkout.get_your_tickets_now', { defaultValue: 'Get your tickets now! 🎫' })
    return text
  }

  const handleShare = async () => {
    // Try native share first
    if (navigator.share) {
      try {
        await navigator.share({
          title: eventTitle,
          text: getShareText(),
          url: eventUrl,
        })
        return
      } catch (error) {
        // User cancelled or error - fall through to copy
        if ((error as Error).name !== 'AbortError') {
          console.error('Share failed:', error)
        }
      }
    }
    
    // Fallback to copy
    try {
      await navigator.clipboard.writeText(eventUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  return (
    <button
      onClick={handleShare}
      className="w-full h-12 bg-white/[0.07] hover:bg-white/[0.12] text-white px-4 rounded-full font-semibold transition-colors flex items-center justify-center gap-2"
    >
      {copied ? (
        <>
          <Check className="w-5 h-5" />
          <span>{t('events.link_copied')}</span>
        </>
      ) : (
        <>
          <Share2 className="w-5 h-5" />
          <span>{t('events.share_event')}</span>
        </>
      )}
    </button>
  )
}
