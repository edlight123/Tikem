'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LogOut,
  Trash2,
  HelpCircle,
  Briefcase,
  ChevronRight,
  Loader2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ProfileSection, Panel, PanelRows } from './ui'
import { DeleteAccountDialog } from '@/components/account/DeleteAccountDialog'


/**
 * Account: three destinations, then the destructive one.
 *
 * Before: four rows built as four separate boxes, three of them borders around
 * near-white light-theme tints — `border-brand-100` and `bg-brand-100` on the
 * support row, `border-red-200` and `bg-red-100` on delete — so on a black page
 * the support row drew a pale hairline and a pale block, and the icon tiles were
 * brighter than the text they sat beside.
 *
 * Now: staff / sign out / support are rows of ONE filled panel, hairline-divided,
 * with monochrome icon tiles and a chevron on the ones that navigate. Delete sits
 * apart under it on a red wash — set off by distance and a red edge over a fill,
 * not by a red box, matching the organizer settings danger row.
 */
export function AccountCard() {
  const { t } = useTranslation('profile')
  const { t: tCommon } = useTranslation('common')
  const router = useRouter()
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)

  // /account/delete (the public page) and a re-sign-in both land here with
  // ?delete=1, which reopens the deletion dialog.
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get('delete') === '1') setShowDeleteModal(true)
    } catch {
      // ignore
    }
  }, [])

  /**
   * BUNDLE: firebase/auth is fetched in the handler, not imported at module
   * scope. Its only use in this card is this one signOut(), yet a static import
   * put the whole Firebase client — 444KB over three chunks (223 + 136 + 85) out
   * of ~988KB of shared JS — on /profile's first load. A route only sheds those
   * chunks when its LAST static importer goes, so please don't hoist it back up.
   * Cost at runtime: the first tap on "Sign out" awaits a chunk before the
   * session ends — which is why the row now has a pending state instead of
   * looking inert while the chunk arrives. It is not reset on success: the row
   * stays busy until router.push() takes the reader off the page.
   */
  const handleSignOut = async () => {
    if (isSigningOut) return
    setIsSigningOut(true)
    try {
      const [{ signOut }, { auth }] = await Promise.all([
        import('firebase/auth'),
        import('@/lib/firebase/client'),
      ])
      await signOut(auth)
      router.push('/')
    } catch (error) {
      console.error('Error signing out:', error)
      setIsSigningOut(false)
      alert(t('account.sign_out_error'))
    }
  }

  const rowClass =
    'group flex w-full items-center gap-3.5 px-4 py-4 text-left transition-colors hover:bg-white/[0.05] focus:outline-none focus-visible:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 disabled:opacity-60 sm:px-5'
  const tileClass =
    'grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-white/55 transition-colors group-hover:text-white/85'

  return (
    <>
      <ProfileSection title={t('account.title')} description={t('account.subtitle')}>
        <Panel>
          <PanelRows>
            {/* Staff (hidden from global nav; accessible from Profile) */}
            <Link href="/staff" className={rowClass}>
              <span className={tileClass}>
                <Briefcase className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block !text-[15px] font-semibold text-white">{tCommon('nav.staff')}</span>
                <span className="mt-0.5 block !text-[13px] !leading-snug text-white/50">
                  Staff tools and check-in
                </span>
              </span>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-white/25 transition-colors group-hover:text-white/60"
                aria-hidden
              />
            </Link>

            {/* Sign Out — pending while the lazily-loaded auth chunk arrives */}
            <button
              onClick={handleSignOut}
              disabled={isSigningOut}
              aria-busy={isSigningOut}
              className={rowClass}
            >
              <span className={tileClass}>
                {isSigningOut ? (
                  <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden />
                ) : (
                  <LogOut className="h-[18px] w-[18px]" aria-hidden />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block !text-[15px] font-semibold text-white">{t('account.sign_out')}</span>
                <span className="mt-0.5 block !text-[13px] !leading-snug text-white/50">
                  {t('account.sign_out_desc')}
                </span>
              </span>
            </button>

            {/* Help & Support */}
            <Link href="/support" className={rowClass}>
              <span className={tileClass}>
                <HelpCircle className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block !text-[15px] font-semibold text-white">
                  {t('account.help_support')}
                </span>
                <span className="mt-0.5 block !text-[13px] !leading-snug text-white/50">
                  {t('account.help_support_desc')}
                </span>
              </span>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-white/25 transition-colors group-hover:text-white/60"
                aria-hidden
              />
            </Link>
          </PanelRows>
        </Panel>

        {/* Delete Account — apart, on a red wash rather than in a red box */}
        <button
          id="delete-account"
          onClick={() => setShowDeleteModal(true)}
          className="group mt-4 flex w-full items-center gap-3.5 rounded-2xl bg-red-500/[0.05] px-4 py-4 text-left ring-1 ring-inset ring-red-500/20 transition-colors hover:bg-red-500/[0.1] focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 sm:px-5"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-red-500/10 text-red-300">
            <Trash2 className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block !text-[15px] font-semibold text-red-200">
              {t('account.delete_account')}
            </span>
            <span className="mt-0.5 block !text-[13px] !leading-snug text-white/50">
              {t('account.delete_account_desc')}
            </span>
          </span>
        </button>
      </ProfileSection>

      <DeleteAccountDialog open={showDeleteModal} onClose={() => setShowDeleteModal(false)} />
    </>
  )
}
