'use client'

import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import { useTranslation } from 'react-i18next'
import FlyerLibraryPicker from '@/components/organizer/FlyerLibraryPicker'

/**
 * BUNDLE: the storage shim is fetched at the point of use, not imported at
 * module scope. A static import pulled the whole Firebase client — 444KB over
 * three chunks (223 + 136 + 85) out of ~988KB of shared JS — onto the first
 * load of every route, since a route only sheds it when its LAST static
 * importer goes. Nothing here touches Firebase during render: the only use is
 * inside handleFileSelect, and even there only on the signed-in path (a guest
 * uploads through `endpoint`, which never needs the SDK at all). The module is
 * cached after the first resolve so repeat uploads don't re-await.
 *
 * Please do not hoist this back to the top of the file.
 */
let _storage: Awaited<typeof import('@/lib/firebase-db/client')>['firebaseDb']['storage'] | null = null
async function getStorage() {
  if (!_storage) _storage = (await import('@/lib/firebase-db/client')).firebaseDb.storage
  return _storage
}

interface ImageUploadProps {
  currentImage?: string | null
  onImageUploaded: (url: string) => void
  bucket?: string
  /** 'flyer' = tall portrait poster; 'square' = square brand logo (Posh-style). */
  variant?: 'default' | 'flyer' | 'square'
  /**
   * Upload through an API route (multipart POST responding { url }) instead
   * of the client Firebase SDK — how signed-out visitors upload on /create
   * (storage rules require auth; the route uses the admin SDK).
   */
  endpoint?: string
}

export default function ImageUpload({
  currentImage,
  onImageUploaded,
  bucket = 'event-images',
  variant = 'default',
  endpoint,
}: ImageUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<string | null>(currentImage || null)
  const [error, setError] = useState<string | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { t } = useTranslation('common')

  // A parent can set currentImage AFTER mount (the composer's draft restore
  // does) — without this sync the slot renders empty while the form actually
  // holds a poster URL. Never clobber an in-flight local preview.
  useEffect(() => {
    if (!uploading && currentImage && currentImage !== preview) {
      setPreview(currentImage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentImage])

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError(t('upload.errType', { defaultValue: 'Please select an image file' }))
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError(t('upload.errSize', { defaultValue: 'Image must be less than 5MB' }))
      return
    }

    setError(null)
    setUploading(true)

    try {
      // Create preview
      const reader = new FileReader()
      reader.onload = (e) => {
        setPreview(e.target?.result as string)
      }
      reader.readAsDataURL(file)

      // API-route upload (guest mode): the server does the storage write.
      if (endpoint) {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch(endpoint, { method: 'POST', body: form })
        const body = await res.json().catch(() => ({}))
        if (!res.ok || !body?.url) {
          throw new Error(body?.error || 'Upload failed. Please try again.')
        }
        onImageUploaded(body.url)
        return
      }

      // Upload to Firebase Storage
      const fileExt = file.name.split('.').pop()
      // storage.rules only lets a signed-in user write event-images/{uid}_*:
      // a bare UUID name was refused for everyone ("you don't have
      // permission"), e.g. the logo on the Create organization step.
      const uid = (await import('@/lib/firebase/client')).auth.currentUser?.uid
      if (!uid) {
        throw Object.assign(new Error('Not signed in'), { code: 'storage/unauthenticated' })
      }
      const fileName = `${uid}_${crypto.randomUUID()}.${fileExt}`
      const filePath = `event-images/${fileName}`

      console.log('Uploading file:', filePath)
      const storage = await getStorage()
      const { error: uploadError, data } = await storage
        .from(bucket)
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
        })

      if (uploadError) {
        console.error('Upload error:', uploadError)
        throw uploadError
      }

      console.log('Upload data:', data)
      
      // Use the publicUrl from upload response if available, otherwise fetch it
      let publicUrl = data?.publicUrl
      
      if (!publicUrl) {
        console.log('Getting public URL for:', filePath)
        const urlResult = await storage
          .from(bucket)
          .getPublicUrl(filePath)
        publicUrl = urlResult.data.publicUrl
      }

      // Never report success without a real URL — otherwise the form thinks the
      // banner is set while banner_image_url is empty, and publish fails later.
      if (!publicUrl) {
        throw new Error('Upload did not return a public URL')
      }

      console.log('Final public URL:', publicUrl)
      onImageUploaded(publicUrl)
    } catch (err: any) {
      console.error('Upload error:', err)
      const code: string = err?.code || ''
      const rawMessage: string = err?.message || ''
      let message = 'Failed to upload image. Please try again.'
      if (code === 'storage/quota-exceeded' || /quota/i.test(rawMessage)) {
        message = 'Image storage is temporarily unavailable. Your event was not saved with this image, please try again shortly or contact support.'
      } else if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
        message = "You don't have permission to upload right now. Please sign in again and retry."
      } else if (code === 'storage/retry-limit-exceeded') {
        message = 'The upload timed out. Check your connection and try again.'
      } else if (rawMessage) {
        message = rawMessage
      }
      setError(message)
      setPreview(currentImage || null)
    } finally {
      setUploading(false)
    }
  }

  // Picking library artwork is not an upload: the image already lives on a CDN
  // the app allows, so the URL goes straight to the form. That is what makes it
  // work for signed-out visitors on /create with no round trip at all.
  function pickFromLibrary(url: string) {
    setError(null)
    setPreview(url)
    onImageUploaded(url)
    setLibraryOpen(false)
  }

  const isFlyer = variant === 'flyer'
  const isSquare = variant === 'square'
  const frame = isFlyer ? 'aspect-[4/5]' : isSquare ? 'aspect-square' : 'h-64'
  const ctaLabel = isFlyer
    ? t('upload.flyer', { defaultValue: 'Upload your flyer' })
    : isSquare
      ? t('upload.logo', { defaultValue: 'Upload logo' })
      : t('upload.image', { defaultValue: 'Upload image' })
  const changeLabel = isFlyer
    ? t('upload.changeFlyer', { defaultValue: 'Change flyer' })
    : isSquare
      ? t('upload.changeLogo', { defaultValue: 'Change logo' })
      : t('upload.changeImage', { defaultValue: 'Change image' })

  // Cool, Posh-style dropzone backdrop: a teal glow over a faint perspective grid.
  const coolBg: React.CSSProperties =
    isFlyer || isSquare
      ? {
          backgroundColor: '#0c0e0d',
          backgroundImage: [
            'radial-gradient(125% 90% at 50% -10%, rgba(20,184,166,0.22), rgba(20,184,166,0.04) 45%, transparent 70%)',
            'linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px)',
            'linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)',
          ].join(', '),
          backgroundSize: '100% 100%, 28px 28px, 28px 28px',
        }
      : {}

  return (
    <div className="space-y-3">
      <div className="relative">
        {preview ? (
          <div className="group relative">
            <div className={`relative w-full ${frame}`}>
              <Image
                src={preview}
                alt="Preview"
                fill
                sizes="(max-width: 1024px) 100vw, 360px"
                className="rounded-2xl  object-cover"
              />
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded bg-white px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-white/90"
              >
                {changeLabel}
              </button>
              {isFlyer && (
                <button
                  type="button"
                  onClick={() => setLibraryOpen(true)}
                  className="rounded border border-white/40 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  {t('upload.browseLibrary', { defaultValue: 'Browse library' })}
                </button>
              )}
            </div>
          </div>
        ) : (
          // The empty state offers both doors. Upload stays the primary
          // action — most organizers have a flyer — but "browse the library"
          // is the escape hatch for the ones who don't, who would otherwise
          // publish an event with no image at all.
          <div
            style={coolBg}
            className={`group/flyer relative flex w-full ${frame} flex-col items-center justify-center overflow-hidden rounded-2xl text-white/50`}
          >
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded bg-white px-5 py-2.5 text-sm font-semibold text-gray-900 shadow-lg transition-transform group-hover/flyer:scale-105"
            >
              {ctaLabel}
            </button>
            <span className="mt-3 text-xs text-white/45">
              {t('upload.formats', { defaultValue: 'PNG or JPG · up to 5MB' })}
            </span>
            {isFlyer && (
              <button
                type="button"
                onClick={() => setLibraryOpen(true)}
                className="mt-4 text-xs font-semibold text-white/70 underline decoration-white/30 underline-offset-4 transition-colors hover:text-white"
              >
                {t('upload.noFlyer', { defaultValue: 'No flyer? Choose from our library' })}
              </button>
            )}
          </div>
        )}

        {libraryOpen && (
          <FlyerLibraryPicker
            current={preview}
            onPick={pickFromLibrary}
            onClose={() => setLibraryOpen(false)}
          />
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
          disabled={uploading}
        />
      </div>

      {uploading && (
        <div className="flex items-center justify-center py-2">
          <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-brand-400"></div>
          <span className="ml-2 text-sm text-white/60">{t('upload.uploading', { defaultValue: 'Uploading…' })}</span>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 p-3 text-sm text-red-300">
          {error}
        </div>
      )}
    </div>
  )
}
