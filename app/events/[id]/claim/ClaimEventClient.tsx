'use client'

/**
 * Claim a community-shared event (web). Pick one proof (an Instagram handle,
 * a link, or a file uploaded to the PRIVATE claim-proofs/{uid}/ folder), add
 * a note if useful, send. An admin checks it; on approval the event moves to
 * the claimant's organization and they can edit it and sell.
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { Check, FileUp } from 'lucide-react'
import { ClaimProofError, uploadClaimProof } from '@/lib/community/uploadClaimProof'

type Method = 'instagram' | 'link' | 'upload'
const METHODS: Method[] = ['instagram', 'link', 'upload']

const field =
  'w-full rounded bg-surface px-3 py-2.5 text-body text-fg placeholder:text-fg-subtle focus:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-brand-400/50'
const chip = (on: boolean) =>
  `rounded px-3 py-1.5 text-meta font-medium transition-colors ${on ? 'bg-inverse text-on-inverse' : 'bg-surface text-fg-muted hover:text-fg'}`

export default function ClaimEventClient({ eventId, eventTitle, sourceName }: { eventId: string; eventTitle: string; sourceName: string }) {
  const { t } = useTranslation('common')
  const [method, setMethod] = useState<Method>('instagram')
  const [handle, setHandle] = useState('')
  const [link, setLink] = useState('')
  const [proofPath, setProofPath] = useState<string | null>(null)
  const [proofName, setProofName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(`/api/events/${encodeURIComponent(eventId)}/claim`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => setStatus(b?.claim?.status || null))
      .catch(() => {})
  }, [eventId])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setUploading(true)
    try {
      setProofPath(await uploadClaimProof(file))
      setProofName(file.name)
    } catch (err) {
      const code = err instanceof ClaimProofError ? err.code : 'failed'
      setError(t(`community.claim.upload_errors.${code}`))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const ready =
    (method === 'instagram' && handle.trim().length > 1) ||
    (method === 'link' && /^https?:\/\/.+\..+/i.test(link.trim())) ||
    (method === 'upload' && !!proofPath)

  async function send() {
    if (!ready || sending) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method,
          instagram_handle: method === 'instagram' ? handle : undefined,
          proof_url: method === 'link' ? link : undefined,
          proof_path: method === 'upload' ? proofPath : undefined,
          message,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const code = String(body?.code || '')
        setError(t(`community.claim.errors.${['invalid_proof', 'not_claimable', 'rate_limited', 'forbidden'].includes(code) ? code : 'generic'}`))
        return
      }
      setStatus('pending')
    } catch {
      setError(t('community.claim.errors.generic'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      <h1 className="font-display italic lowercase !text-[clamp(28px,4vw,40px)] !leading-[1.04] text-fg">{t('community.claim.title')}</h1>
      <p className="mt-2 text-meta text-fg-muted">
        {eventTitle}
        {sourceName ? ` · ${t('community.event.from', { name: sourceName })}` : ''}
      </p>

      {status === 'pending' ? (
        <div className="mt-6">
          <p className="flex items-center gap-2 text-body text-fg">
            <Check className="h-4 w-4 text-brand-400" aria-hidden />
            {t('community.claim.sent')}
          </p>
          <Link href={`/events/${eventId}`} className="mt-5 inline-flex h-10 items-center rounded bg-surface px-4 text-meta font-semibold text-fg hover:bg-surface-high">
            {t('community.claim.back')}
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          <div>
            <p className="mb-2 text-meta text-fg-muted">{t('community.claim.how')}</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('community.claim.how')}>
              {METHODS.map((m) => (
                <button key={m} type="button" role="radio" aria-checked={method === m} className={chip(method === m)} onClick={() => setMethod(m)}>
                  {t(`community.claim.methods.${m}`)}
                </button>
              ))}
            </div>
          </div>

          {method === 'instagram' && (
            <div>
              <label className="mb-1.5 block text-meta text-fg-muted" htmlFor="cl-handle">{t('community.claim.handle')}</label>
              <input id="cl-handle" className={field} placeholder="@" value={handle} maxLength={42} onChange={(e) => setHandle(e.target.value)} />
              <p className="mt-1.5 text-xs text-fg-subtle">{t('community.claim.handle_hint')}</p>
            </div>
          )}
          {method === 'link' && (
            <div>
              <label className="mb-1.5 block text-meta text-fg-muted" htmlFor="cl-link">{t('community.claim.link')}</label>
              <input id="cl-link" type="url" inputMode="url" placeholder="https://" className={field} value={link} onChange={(e) => setLink(e.target.value)} />
            </div>
          )}
          {method === 'upload' && (
            <div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif,application/pdf" className="hidden" onChange={onFile} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex h-10 w-full items-center justify-center gap-2 rounded bg-surface text-meta font-semibold text-fg hover:bg-surface-high disabled:opacity-50"
              >
                <FileUp className="h-4 w-4" aria-hidden />
                {uploading ? t('community.claim.uploading') : proofName || t('community.claim.upload')}
              </button>
              <p className="mt-1.5 text-xs text-fg-subtle">{t('community.claim.upload_hint')}</p>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-meta text-fg-muted" htmlFor="cl-msg">{t('community.claim.message')}</label>
            <textarea id="cl-msg" rows={3} className={field} value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} />
          </div>

          {error && <p className="text-meta text-danger-soft">{error}</p>}
          <button
            type="button"
            disabled={!ready || sending}
            onClick={send}
            className="h-10 w-full rounded bg-inverse text-meta font-semibold text-on-inverse transition-colors hover:bg-inverse-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? t('community.claim.sending') : t('community.claim.send')}
          </button>
          <p className="text-center text-xs text-fg-subtle">{t('community.claim.footnote')}</p>
        </div>
      )}
    </div>
  )
}
