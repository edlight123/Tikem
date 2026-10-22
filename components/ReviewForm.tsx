'use client'

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ThumbsUp, ThumbsDown } from 'lucide-react'

interface ReviewFormProps {
  eventId: string
  ticketId: string
  eventTitle: string
  onSuccess?: () => void
}

export default function ReviewForm({ eventId, ticketId, eventTitle, onSuccess }: ReviewFormProps) {
  const { t } = useTranslation('common')
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [comment, setComment] = useState('')
  const [organizerRating, setOrganizerRating] = useState(0)
  const [wouldRecommend, setWouldRecommend] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (rating === 0) {
      setError(t('review_form.rating_required_error', 'Please select a rating'))
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          ticketId,
          rating,
          comment: comment.trim() || null,
          organizerRating: organizerRating || null,
          wouldRecommend
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit review')
      }

      if (onSuccess) onSuccess()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white/[0.055] rounded-2xl p-6">
      <h3 className="mb-5 font-display lowercase italic !text-[22px] !leading-snug text-white">
        {t('review_form.heading', { defaultValue: 'Review: {{eventTitle}}', eventTitle })}
      </h3>

      {/* Event Rating */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-white/70 mb-2">
          {t('review_form.rating_label', 'How was the event? *')}
        </label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(0)}
              className="text-3xl transition-colors"
            >
              <span className={
                star <= (hoverRating || rating)
                  ? 'text-yellow-400'
                  : 'text-white/40'
              }>
                ★
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Comment */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-white/70 mb-2">
          {t('review_form.comment_label', 'Your review (optional)')}
        </label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          className="w-full rounded-xl bg-white/[0.07] px-4 py-3 text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-brand-400/60"
          placeholder={t('review_form.comment_placeholder', 'Share your experience...')}
          maxLength={500}
        />
        <div className="text-xs text-white/50 mt-1">
          {t('review_form.comment_counter', { defaultValue: '{{count}}/500 characters', count: comment.length })}
        </div>
      </div>

      {/* Organizer Rating */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-white/70 mb-2">
          {t('review_form.organizer_rating_label', 'How was the organizer? (optional)')}
        </label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setOrganizerRating(star)}
              className="text-2xl transition-colors"
            >
              <span className={star <= organizerRating ? 'text-teal-500' : 'text-white/40'}>
                ★
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Recommendation */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-white/70 mb-2">
          {t('review_form.recommend_label', 'Would you recommend this event?')}
        </label>
        <div className="flex gap-3">
          {([
            [true, ThumbsUp, t('review_form.recommend_yes', 'Yes')],
            [false, ThumbsDown, t('review_form.recommend_no', 'No')],
          ] as const).map(([value, Icon, label]) => {
            const selected = wouldRecommend === value
            return (
              <button
                key={String(value)}
                type="button"
                onClick={() => setWouldRecommend(value)}
                aria-pressed={selected}
                className={`inline-flex items-center gap-2 rounded px-5 py-2.5 text-sm font-medium transition-colors ${
                  selected
                    ? 'bg-white/[0.16] text-white'
                    : 'bg-white/[0.07] text-white/70 hover:bg-white/[0.1] hover:text-white'
                }`}
              >
                <Icon className={`h-4 w-4 ${selected ? 'text-brand-300' : ''}`} aria-hidden />
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || rating === 0}
        className="w-full rounded bg-white py-3 font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? t('review_form.submitting', 'Submitting...') : t('review_form.submit', 'Submit Review')}
      </button>
    </form>
  )
}
