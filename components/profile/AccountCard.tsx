'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LogOut,
  Trash2,
  Briefcase,
  ChevronRight,
  Loader2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import Link from 'next/link'
import { ProfileSection, Panel, PanelRows } from './ui'
import { DeleteAccountDialog } from '@/components/account/DeleteAccountDialog'


/**
 * Account: staff tools and sign out, then the destructive one. (Help & Support
 * moved to the dashboard's help list, as on mobile.)
 *
 * Before: four rows built as four separate boxes, three of them borders around
 * near-white light-theme tints — `border-brand-100` and `bg-brand-100` on the
 * support row, `border-danger-soft` and `bg-danger-soft` on delete — so on a black page
 * the support row drew a pale hairline and a pale block, and the icon tiles were
 * brighter than the text they sat beside.
 *
 * Now: staff / sign out are rows of ONE filled panel, hairline-divided,
 * with monochrome icon tiles and a chevron on the ones that navigate. Delete sits
 * apart under it on a red wash — set off by distance and a red edge over a fill,
 * not by a red box, matching the organizer settings danger row.
 */
export function AccountCard() {
  const { t } = useTranslation('profile')
  const { t: tCommon } = useTranslation('common')
  const { showToast } = useToast()
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
      showToast({ type: 'error', title: t('account.sign_out_error') })
    }
  }

  const rowClass =
    'group flex w-full items-center gap-3.5 px-4 py-4 text-left transition-colors hover:bg-surface focus:outline-none focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 disabled:opacity-60 sm:px-5'
  const tileClass =
    'grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface text-fg-muted transition-colors group-hover:text-fg-soft'

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
                <span className="block !text-body font-semibold text-fg">{tCommon('nav.staff')}</span>
                <span className="mt-0.5 block !text-meta !leading-snug text-fg-subtle">
                  {t('account.staff_desc')}
                </span>
              </span>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-fg-faint transition-colors group-hover:text-fg-muted"
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
                <span className="block !text-body font-semibold text-fg">{t('account.sign_out')}</span>
                <span className="mt-0.5 block !text-meta !leading-snug text-fg-subtle">
                  {t('account.sign_out_desc')}
                </span>
              </span>
            </button>

          </PanelRows>
        </Panel>

        {/* Delete Account — apart, on a red wash rather than in a red box */}
        <button
          type="button"
          id="delete-account"
          onClick={() => setShowDeleteModal(true)}
          className="group mt-4 flex w-full items-center gap-3.5 rounded-2xl bg-danger-strong/[0.05] px-4 py-4 text-left ring-1 ring-inset ring-danger-strong/20 transition-colors hover:bg-danger-strong/[0.1] focus:outline-none focus-visible:ring-2 focus-visible:ring-danger sm:px-5"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-danger-strong/10 text-danger-soft">
            <Trash2 className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block !text-body font-semibold text-danger-soft">
              {t('account.delete_account')}
            </span>
            <span className="mt-0.5 block !text-meta !leading-snug text-fg-subtle">
              {t('account.delete_account_desc')}
            </span>
          </span>
        </button>
      </ProfileSection>

      <DeleteAccountDialog open={showDeleteModal} onClose={() => setShowDeleteModal(false)} />
    </>
  )
}
