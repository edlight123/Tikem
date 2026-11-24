'use client'

/**
 * Organization settings: what the public page shows beyond the name and
 * links. Two parts, each with its own anchor so the page's add-prompts land
 * on them:
 *   #banner  pick one of our photos, upload one, or none
 *   #photos  up to 12 photos: add, remove, reorder (lib/gallery.ts)
 * Both save at once through /api/organizer/settings/{cover,gallery}, which
 * check the caller may edit the acting org (owner or team admin).
 */
import { useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, Eye, ImagePlus, Loader2, MoreHorizontal, Trash2, Upload, X } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { COVER_TEMPLATES, coverTemplatePath, type CoverTemplate } from '@/lib/organizer/cover'
import { MAX_GALLERY_PHOTOS, availableMoves, moveGalleryPhoto, type GalleryMove, type GalleryPhoto } from '@/lib/gallery'

const MAX_BYTES = 4 * 1024 * 1024

const MOVE_ICON: Record<GalleryMove, typeof ArrowUp> = {
  first: ChevronsUp,
  up: ArrowUp,
  down: ArrowDown,
  last: ChevronsDown,
}

async function readJson(res: Response): Promise<any> {
  return res.json().catch(() => ({}))
}

export default function OrgPageEditor({
  orgId,
  initialCover,
  initialGallery,
}: {
  orgId: string
  initialCover: { coverTemplate: CoverTemplate | null; coverImageUrl: string | null }
  initialGallery: GalleryPhoto[]
}) {
  const { t } = useTranslation('organizer')
  const { showToast } = useToast()
  const [cover, setCover] = useState(initialCover)
  const [gallery, setGallery] = useState<GalleryPhoto[]>(initialGallery)
  const [coverBusy, setCoverBusy] = useState(false)
  const [galleryBusy, setGalleryBusy] = useState(false)
  const [menuFor, setMenuFor] = useState<number | null>(null)
  const coverInput = useRef<HTMLInputElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)

  const fail = (message?: string) =>
    showToast({ title: t('org_page.error_title'), message: message || t('org_page.error_body'), type: 'error' })

  const tooBig = (file: File) => {
    if (file.size <= MAX_BYTES) return false
    fail(t('org_page.too_large'))
    return true
  }

  const applyCover = (d: any) =>
    setCover({ coverTemplate: d?.coverTemplate ?? null, coverImageUrl: d?.coverImageUrl ?? null })

  const pickTemplate = async (key: CoverTemplate | null) => {
    setCoverBusy(true)
    try {
      const res = await fetch('/api/organizer/settings/cover', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: key }),
      })
      const d = await readJson(res)
      if (!res.ok) return fail(d?.error)
      applyCover(d)
    } catch {
      fail()
    } finally {
      setCoverBusy(false)
    }
  }

  const uploadCover = async (file: File | undefined) => {
    if (!file || tooBig(file)) return
    setCoverBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/organizer/settings/cover', { method: 'POST', body: form })
      const d = await readJson(res)
      if (!res.ok) return fail(d?.error)
      applyCover(d)
    } catch {
      fail()
    } finally {
      setCoverBusy(false)
      if (coverInput.current) coverInput.current.value = ''
    }
  }

  const uploadPhotos = async (files: FileList | null) => {
    const list = Array.from(files || []).slice(0, MAX_GALLERY_PHOTOS - gallery.length)
    if (!list.length) return
    setGalleryBusy(true)
    try {
      for (const file of list) {
        if (tooBig(file)) continue
        const form = new FormData()
        form.append('file', file)
        const res = await fetch('/api/organizer/settings/gallery', { method: 'POST', body: form })
        const d = await readJson(res)
        if (!res.ok) {
          fail(d?.error)
          break
        }
        if (Array.isArray(d?.gallery)) setGallery(d.gallery)
      }
    } catch {
      fail()
    } finally {
      setGalleryBusy(false)
      if (photoInput.current) photoInput.current.value = ''
    }
  }

  const saveGallery = async (next: GalleryPhoto[]) => {
    const before = gallery
    setGallery(next)
    setMenuFor(null)
    setGalleryBusy(true)
    try {
      const res = await fetch('/api/organizer/settings/gallery', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gallery: next }),
      })
      const d = await readJson(res)
      if (!res.ok) {
        setGallery(before)
        return fail(d?.error)
      }
      if (Array.isArray(d?.gallery)) setGallery(d.gallery)
    } catch {
      setGallery(before)
      fail()
    } finally {
      setGalleryBusy(false)
    }
  }

  const currentSrc = cover.coverTemplate ? coverTemplatePath(cover.coverTemplate) : cover.coverImageUrl
  const full = gallery.length >= MAX_GALLERY_PHOTOS

  return (
    <div className="space-y-6">
      {/* ── Banner ── */}
      <section id="banner" className="scroll-mt-24 rounded bg-surface-low p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-section lowercase text-fg">{t('org_page.banner_title')}</h2>
          <Link
            href={`/profile/organizer/${encodeURIComponent(orgId)}?preview=1`}
            className="inline-flex shrink-0 items-center gap-1.5 text-meta text-fg-subtle hover:text-fg"
          >
            <Eye className="h-4 w-4" aria-hidden />
            {t('org_page.preview')}
          </Link>
        </div>

        <div className="relative mt-4 aspect-[3/1] overflow-hidden rounded bg-surface">
          {currentSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentSrc} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-meta text-fg-subtle">{t('org_page.no_banner')}</div>
          )}
          {coverBusy && (
            <div className="absolute inset-0 grid place-items-center bg-scrim-light">
              <Loader2 className="h-6 w-6 animate-spin text-fg" />
            </div>
          )}
        </div>

        <ul className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
          {COVER_TEMPLATES.map((key) => {
            const selected = cover.coverTemplate === key
            return (
              <li key={key}>
                <button
                  type="button"
                  disabled={coverBusy}
                  onClick={() => pickTemplate(key)}
                  aria-pressed={selected}
                  aria-label={t('org_page.template_label', { n: COVER_TEMPLATES.indexOf(key) + 1 })}
                  className={`block aspect-square w-full overflow-hidden rounded outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-fg/70 disabled:opacity-50 ${
                    selected ? 'ring-2 ring-fg' : 'opacity-80 hover:opacity-100'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={coverTemplatePath(key)} alt="" className="h-full w-full object-cover" loading="lazy" />
                </button>
              </li>
            )
          })}
        </ul>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={coverBusy}
            onClick={() => coverInput.current?.click()}
            className="inline-flex h-10 items-center gap-2 rounded bg-surface-raised px-4 text-sm font-semibold text-fg transition-colors hover:bg-surface-high disabled:opacity-50"
          >
            <Upload className="h-4 w-4" aria-hidden />
            {t('org_page.upload_banner')}
          </button>
          {currentSrc && (
            <button
              type="button"
              disabled={coverBusy}
              onClick={() => pickTemplate(null)}
              className="inline-flex h-10 items-center gap-1.5 px-2 text-sm text-fg-subtle transition-colors hover:text-fg disabled:opacity-50"
            >
              <X className="h-4 w-4" aria-hidden />
              {t('org_page.remove_banner')}
            </button>
          )}
          <input
            ref={coverInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => uploadCover(e.target.files?.[0])}
          />
        </div>
      </section>

      {/* ── Photos ── */}
      <section id="photos" className="scroll-mt-24 rounded bg-surface-low p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-section lowercase text-fg">{t('org_page.photos_title')}</h2>
          <span className="text-meta tabular-nums text-fg-subtle">
            {gallery.length} / {MAX_GALLERY_PHOTOS}
          </span>
        </div>

        {gallery.length === 0 ? (
          <div className="mt-4 flex flex-col items-start gap-3 rounded bg-surface px-5 py-6">
            <p className="font-display text-headline lowercase leading-none text-fg">{t('org_page.photos_empty_title')}</p>
            <p className="text-meta text-fg-muted">{t('org_page.photos_empty_line')}</p>
            <button
              type="button"
              disabled={galleryBusy}
              onClick={() => photoInput.current?.click()}
              className="mt-1 inline-flex h-10 items-center gap-2 rounded bg-inverse px-4 text-sm font-semibold text-on-inverse transition-colors hover:bg-inverse-hover disabled:opacity-50"
            >
              {galleryBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" aria-hidden />}
              {t('org_page.add_photos')}
            </button>
          </div>
        ) : (
          <>
            <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {gallery.map((p, i) => (
                <li key={p.url} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="aspect-[4/3] w-full rounded bg-surface object-cover" />
                  <span className="absolute left-2 top-2 rounded bg-scrim px-1.5 text-caption tabular-nums text-fg">{i + 1}</span>
                  <button
                    type="button"
                    disabled={galleryBusy}
                    onClick={() => setMenuFor(menuFor === i ? null : i)}
                    aria-haspopup="menu"
                    aria-expanded={menuFor === i}
                    aria-label={t('org_page.photo_menu', { n: i + 1 })}
                    className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded bg-scrim text-fg hover:bg-scrim-strong disabled:opacity-50"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {menuFor === i && (
                    <div role="menu" className="absolute right-2 top-11 z-10 w-44 overflow-hidden rounded bg-surface-raised-solid py-1 shadow-lg">
                      {availableMoves(i, gallery.length).map((move) => {
                        const Icon = MOVE_ICON[move]
                        return (
                          <button
                            key={move}
                            type="button"
                            role="menuitem"
                            onClick={() => saveGallery(moveGalleryPhoto(gallery, i, move))}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-fg-soft hover:bg-surface-high"
                          >
                            <Icon className="h-4 w-4" aria-hidden />
                            {t(`org_page.move_${move}`)}
                          </button>
                        )
                      })}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => saveGallery(gallery.filter((_, j) => j !== i))}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-danger hover:bg-surface-high"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                        {t('org_page.remove_photo')}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <button
                type="button"
                disabled={galleryBusy || full}
                onClick={() => photoInput.current?.click()}
                className="inline-flex h-10 items-center gap-2 rounded bg-surface-raised px-4 text-sm font-semibold text-fg transition-colors hover:bg-surface-high disabled:opacity-50"
              >
                {galleryBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" aria-hidden />}
                {full ? t('org_page.photos_full') : t('org_page.add_photos')}
              </button>
            </div>
          </>
        )}
        <input
          ref={photoInput}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => uploadPhotos(e.target.files)}
        />
      </section>
    </div>
  )
}
