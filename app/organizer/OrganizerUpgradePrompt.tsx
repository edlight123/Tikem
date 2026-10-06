'use client'

import { useTranslation } from 'react-i18next'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { becomeOrganizer } from './actions'
import ImageUpload from '@/components/ImageUpload'
import { safeSameOriginPath } from '@/lib/safeUrl'

// Parsed with the URL parser (lib/safeUrl): a startsWith('/') check let
// "/\evil.com" through, which browsers read as protocol-relative. The base
// origin is only a reference point; the result is always a bare path.
function sanitizeRedirectTarget(target: string | undefined | null): string {
  if (!target) return '/organizer'
  const path = safeSameOriginPath(target, 'https://tikem.co')
  return path === '/' ? '/organizer' : path
}

export default function OrganizerUpgradePrompt({ redirectTo }: { redirectTo?: string }) {
  const { t } = useTranslation('organizer')

  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')

  const safeRedirect = sanitizeRedirectTarget(redirectTo)

  const handleContinue = () => {
    setError(null)
    startTransition(async () => {
      try {
        await becomeOrganizer({ organizationName: orgName, organizationLogo: logoUrl })
        router.push(safeRedirect)
        router.refresh()
      } catch (e: any) {
        setError(e?.message || 'Unable to set up your organization right now')
      }
    })
  }

  return (
    <div className="grid min-h-[calc(100vh-3.5rem)] grid-cols-1 lg:grid-cols-2">
      {/* Left — textured brand panel */}
      <div className="relative hidden overflow-hidden lg:block">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0c2b28] via-[#0a0a0a] to-[#0a0a0a]" />
        <div aria-hidden className="absolute left-1/3 top-1/4 h-[420px] w-[420px] max-w-full rounded-full blur-[140px]" />
        {/* No wordmark here — the site navbar above already carries the logo. */}
        <div className="relative flex h-full flex-col justify-end p-10">
          <div>
            <h2 className="max-w-sm font-display text-3xl leading-tight text-white">
              Create your world on tikèm.
            </h2>
            <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-white/55">
              {t('upgrade_prompt.setup_once_note')}
            </p>
          </div>
        </div>
      </div>

      {/* Right — clean form */}
      <div className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <h1 className="font-display text-[clamp(28px,4vw,40px)] leading-[1.05] text-white">
            {t('upgrade_prompt.create_your_organization')}
          </h1>
          <p className="mt-2 text-[15px] text-white/55">
            {t('upgrade_prompt.brand_visible_note')}
          </p>

          {error && (
            <div className="mt-5 rounded-lg border border-red-500/30 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Brand name */}
          <div className="mt-7">
            <label htmlFor="org-name" className="mb-2 block text-sm font-semibold text-white/80">
              {t('upgrade_prompt.what_is_org_called')}
            </label>
            <input
              id="org-name"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder={t('upgrade_prompt.brand_name')}
              className="w-full rounded-xl border border-white/10 bg-transparent px-4 py-3 text-[15px] text-white placeholder:text-white/40 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/40"
            />
          </div>

          {/* Square logo */}
          <div className="mt-6">
            <label className="mb-2 block text-sm font-semibold text-white/80">
              Add your brand&rsquo;s logo <span className="font-normal text-white/40">(square, optional)</span>
            </label>
            <div className="w-40">
              <ImageUpload variant="square" currentImage={logoUrl} onImageUploaded={setLogoUrl} />
            </div>
          </div>

          {/* Actions */}
          <button
            type="button"
            disabled={isPending}
            onClick={handleContinue}
            className="mt-8 w-full rounded-xl bg-brand-600 px-5 py-3.5 text-sm font-bold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? 'Setting up…' : 'Continue'}
          </button>
          <p className="mt-3 text-center text-xs text-white/40">
            {t('upgrade_prompt.drafts_free_note')}
          </p>
          <button
            type="button"
            onClick={() => router.push('/discover')}
            className="mt-2 w-full rounded-xl px-5 py-2.5 text-sm font-medium text-white/50 transition-colors hover:text-white"
          >
            {t('upgrade_prompt.browse_events_instead')}
          </button>
        </div>
      </div>
    </div>
  )
}
