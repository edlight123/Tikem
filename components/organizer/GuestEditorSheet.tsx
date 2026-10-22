'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link2, Loader2, User, X } from 'lucide-react'
import { TimePicker } from '@/components/ui/DateTimePickers'
import type { GuestRole, LineupEntry } from '@/lib/lineup'

/**
 * BUNDLE: the storage shim is fetched at the point of use rather than imported
 * at module scope. A static import put the whole Firebase client — 444KB over
 * three chunks (223 + 136 + 85) out of ~988KB of shared JS — on the first load
 * of every route, because a route only sheds it once its LAST static importer
 * is gone. Nothing here touches Firebase during render: the sole use is the
 * photo upload in handlePhoto, and only on the signed-in path (a guest uploads
 * via `endpoint`). Cached after the first resolve, so a second photo doesn't
 * re-await. Please don't hoist it back to the top.
 */
let _storage: Awaited<typeof import('@/lib/firebase-db/client')>['firebaseDb']['storage'] | null = null
async function getStorage() {
  if (!_storage) _storage = (await import('@/lib/firebase-db/client')).firebaseDb.storage
  return _storage
}

/**
 * The lineup entry editor.
 *
 * A name and a role alone make a list; a face, a link and a set time make a
 * bill. This is the sheet where one act is filled in — modelled on the layout
 * organizers already know from Posh: a circular photo well on the left with the
 * name and link stacked beside it, then the bio, then the set window, then
 * Cancel / Save pinned to the bottom edge.
 *
 * It edits a COPY held by the parent, so Cancel genuinely discards.
 */

export default function GuestEditorSheet({
  draft,
  roles,
  isNew,
  /** Upload route for signed-out visitors; undefined uses the client SDK. */
  endpoint,
  onPatch,
  onSave,
  onCancel,
}: {
  draft: LineupEntry
  roles: readonly GuestRole[]
  isNew: boolean
  endpoint?: string
  onPatch: (patch: Partial<LineupEntry>) => void
  onSave: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation('common')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  // Open focused on the first field, and let Escape dismiss — the sheet covers
  // the form, so a keyboard user must be able to get back out of it.
  //
  // Escape belongs to the TOPMOST dialog. The time picker opens its own modal
  // portalled to <body>, and both listeners sit on `document`, where
  // stopPropagation does nothing to a sibling listener on the same node — so
  // one Escape inside the picker would have closed the picker AND thrown away
  // the whole entry. Whichever aria-modal dialog is last in the document owns
  // the key; the sheet only answers when that is the sheet.
  useEffect(() => {
    nameRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
      if (dialogs.length && dialogs[dialogs.length - 1] !== sheetRef.current) return
      e.stopPropagation()
      onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The sheet is fixed-position over a scrolling page; without locking the body
  // the page behind scrolls under it on wheel/touch.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setUploadError(t('composer.guest.photoType', { defaultValue: 'Please choose an image file.' }))
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError(t('composer.guest.photoSize', { defaultValue: 'Image must be under 5MB.' }))
      return
    }
    setUploadError(null)
    setUploading(true)
    try {
      if (endpoint) {
        // Signed-out: the API route writes it with the admin SDK, under the
        // same guest-uploads/ TTL as the poster.
        const form = new FormData()
        form.append('file', file)
        const res = await fetch(endpoint, { method: 'POST', body: form })
        const body = await res.json().catch(() => ({}))
        if (!res.ok || !body?.url) throw new Error(body?.error || 'Upload failed')
        onPatch({ photoUrl: body.url })
      } else {
        const ext = file.name.split('.').pop() || 'jpg'
        const path = `event-images/${crypto.randomUUID()}.${ext}`
        const storage = await getStorage()
        const { error, data } = await storage
          .from('event-images')
          .upload(path, file, { cacheControl: '3600', upsert: false })
        if (error) throw error
        let url = data?.publicUrl
        if (!url) {
          url = (await storage.from('event-images').getPublicUrl(path)).data.publicUrl
        }
        // Never report success without a URL, or the sheet shows a photo the
        // saved entry does not actually have.
        if (!url) throw new Error('Upload did not return a public URL')
        onPatch({ photoUrl: url })
      }
    } catch (err: any) {
      setUploadError(
        err?.message || t('composer.guest.photoFailed', { defaultValue: 'Upload failed. Please try again.' })
      )
    } finally {
      setUploading(false)
    }
  }

  /* --------------------------------------------------------------------------
   * Surfaces, matched to the composer: filled fields, no hollow outlines.
   *
   * 16px is stated here rather than left to the global mobile floor in
   * globals.css. The floor exists (Safari zooms the page under 16px), but a
   * field that claims 15px and renders 16px on the device you are laying out
   * for is how the set-time row came to overlap in the first place — every
   * width sum below was done at the size that actually ships.
   * ------------------------------------------------------------------------ */
  const fieldBase =
    'min-h-11 w-full min-w-0 rounded-xl bg-white/[0.055] py-3 text-[16px] text-white [color-scheme:dark] placeholder:text-white/40 transition-colors focus:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-brand-400/50'
  const field = `${fieldBase} px-4`

  const label = 'label-mono mb-1.5 block text-[10px] uppercase text-white/70'

  /**
   * Chips: filled, not outlined; `rounded`, not a full pill. ~34px of
   * ink with `py-2 -my-1` extending the tappable box past it without changing
   * the layout — the composer's own chip geometry.
   */
  const chip = (on: boolean) =>
    `-my-1 inline-flex min-w-0 items-center rounded px-3 py-2 text-[13px] font-medium transition-colors ${
      on ? 'bg-white text-black' : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white'
    }`

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button
        type="button"
        onClick={onCancel}
        aria-label={t('common.close', { defaultValue: 'Close' })}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={
          isNew
            ? t('composer.guest.addTitle', { defaultValue: 'Add to lineup' })
            : t('composer.guest.editTitle', { defaultValue: 'Edit lineup entry' })
        }
        className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-[#1c1c1c] shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
          <h2 className="min-w-0 truncate text-[15px] font-semibold text-white">
            {isNew
              ? t('composer.guest.addTitle', { defaultValue: 'Add to lineup' })
              : t('composer.guest.editTitle', { defaultValue: 'Edit lineup entry' })}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="-my-1 shrink-0 rounded-lg p-2 text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white"
            aria-label={t('common.close', { defaultValue: 'Close' })}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* Photo well + the two identity fields beside it */}
          <div className="flex items-start gap-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="group relative h-[76px] w-[76px] shrink-0 overflow-hidden rounded-full bg-white/[0.06] transition-colors hover:bg-white/[0.12] disabled:opacity-60"
              aria-label={t('composer.guest.photo', { defaultValue: 'Add a photo' })}
            >
              {draft.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={draft.photoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center">
                  <User className="h-7 w-7 text-white/35" />
                </span>
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
                {uploading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-white" />
                ) : (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-white">
                    {draft.photoUrl
                      ? t('composer.guest.change', { defaultValue: 'Change' })
                      : t('composer.guest.add', { defaultValue: 'Add' })}
                  </span>
                )}
              </span>
              {uploading && !draft.photoUrl && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/55">
                  <Loader2 className="h-5 w-5 animate-spin text-white" />
                </span>
              )}
            </button>

            <div className="min-w-0 flex-1 space-y-2.5">
              <input
                ref={nameRef}
                value={draft.name}
                onChange={(e) => onPatch({ name: e.target.value })}
                placeholder={t('composer.guestNamePlaceholder', { defaultValue: 'Artist or guest name' })}
                aria-label={t('composer.guest.name', { defaultValue: 'Name' })}
                className={field}
              />
              {/* The icon is `shrink-0`, so the input must be `min-w-0`: a text
                  input's automatic minimum size is its `size=20` intrinsic
                  width — measured 175px at 16px — which on a 320px phone is
                  50px more than this row can give it. Without min-w-0 it
                  refuses to shrink and pushes out of the sheet. */}
              <div className="flex min-h-11 items-center gap-2.5 rounded-xl bg-white/[0.055] px-3.5 transition-colors focus-within:bg-white/[0.08]">
                <Link2 className="h-[18px] w-[18px] shrink-0 text-white/40" aria-hidden />
                <input
                  value={draft.link}
                  onChange={(e) => onPatch({ link: e.target.value })}
                  inputMode="url"
                  placeholder={t('composer.guest.linkPlaceholder', {
                    defaultValue: 'Instagram, Spotify, website…',
                  })}
                  aria-label={t('composer.guest.link', { defaultValue: 'Link' })}
                  className="w-full min-w-0 bg-transparent py-3 text-[16px] text-white placeholder:text-white/40 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} className="hidden" />

          {uploadError && (
            <p className="rounded-xl bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-300">{uploadError}</p>
          )}

          <div>
            <span className={label}>{t('composer.guest.role', { defaultValue: 'Role' })}</span>
            {/* Wraps onto a second line rather than scrolling — and gap-y-3
                pays back the chips' -my-1 so wrapped rows don't touch. */}
            <div className="flex flex-wrap gap-x-2 gap-y-3">
              {roles.map((role) => {
                const on = draft.role === role
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => onPatch({ role })}
                    aria-pressed={on}
                    className={chip(on)}
                  >
                    {t(`composer.roles.${role}`, { defaultValue: role })}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className={label} htmlFor="guest-desc">
              {t('composer.guest.description', { defaultValue: 'Description' })}
            </label>
            <textarea
              id="guest-desc"
              value={draft.description}
              onChange={(e) => onPatch({ description: e.target.value })}
              rows={3}
              maxLength={500}
              placeholder={t('composer.guest.descriptionPlaceholder', {
                defaultValue: 'A line about them: who they are, what they play.',
              })}
              className={`${field} resize-none`}
            />
          </div>

          {/* Set window. Wall-clock times on the event's own evening, so a
              lineup can read like a running order.
              ------------------------------------------------------------------
              This row is where both of the sheet's bugs lived, and the fix is
              to stop using the control that caused them.

              It was two raw `<input type="time">` in `grid grid-cols-2`. A
              native time input is not a text box: it carries an INTRINSIC width
              from its time-edit widget and will not shrink below it — measured
              119px in Chrome at the 16px a phone actually renders, 151px once
              the field's `px-4` is added, and WebKit's widget is wider still.
              Tailwind's `grid-cols-2` tracks are `minmax(0, 1fr)`, i.e. 174px
              on a 402px phone, so the tracks held their size while each input
              drew at its own width and hung past its cell. Reproduced: the
              start field's right edge landed 16.5px INSIDE the end field
              (that's the overlap), and the row pushed 9px past the scroll pane,
              which turns horizontally scrollable the moment it is handed
              `overflow-y-auto` — `overflow-y: auto` computes the other axis
              from `visible` to `auto`. Hence the drag-left, and the labels
              shearing to "former" / "RIPTION" / "T TIME".

              So: the composer's own `TimePicker`, which is how every other date
              and time in this app is set. It is a BUTTON plus a portalled list,
              so there is no native widget, no intrinsic width, and nothing that
              can outgrow its box; the rows below wrap at both levels, so the
              layout has no width it can fail at. Same control, same surface,
              same geometry as the Dates card upstairs in the composer. */}
          <div className="overflow-hidden rounded-xl bg-white/[0.03]">
            {(
              [
                ['start', t('composer.guest.startTime', { defaultValue: 'Start time' }), draft.startTime],
                ['end', t('composer.guest.endTime', { defaultValue: 'End time' }), draft.endTime],
              ] as const
            ).map(([which, text, value], i) => (
              <div
                key={which}
                role="group"
                aria-label={text}
                className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${
                  i > 0 ? 'border-t border-white/[0.06]' : ''
                }`}
              >
                <span className="min-w-0 text-[15px] font-medium text-white/80">{text}</span>
                <div className="flex flex-wrap items-center gap-2">
                  {/* A set time is optional, and the native input it replaced
                      could be emptied — so keep a way back to no time. */}
                  {value && (
                    <button
                      type="button"
                      onClick={() => onPatch(which === 'start' ? { startTime: '' } : { endTime: '' })}
                      className="-my-1 rounded-lg px-2 py-2 text-[13px] text-white/45 transition-colors hover:text-white"
                    >
                      {t('common.clear', { defaultValue: 'Clear' })}
                    </button>
                  )}
                  <TimePicker
                    value={value}
                    onChange={(v) => onPatch(which === 'start' ? { startTime: v } : { endTime: v })}
                    title={text}
                    placeholder={t('composer.time', { defaultValue: 'Time' })}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-white/[0.07] px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 min-w-0 flex-1 rounded bg-white/[0.07] px-4 py-3 text-sm font-semibold text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white"
          >
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!draft.name.trim() || uploading}
            className="min-h-11 min-w-0 flex-1 rounded bg-white px-4 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('common.save', { defaultValue: 'Save' })}
          </button>
        </div>
      </div>
    </div>
  )
}
