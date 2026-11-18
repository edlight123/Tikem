'use client'

import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Bell,
  Building2,
  ChevronRight,
  CreditCard,
  HelpCircle,
  Lock,
  Settings as SettingsIcon,
  ShieldCheck,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { PageHeader, SectionHeader } from '@/components/organizer/ui'

/**
 * The organizer settings hub.
 *
 * What was here before: nine link cards painted `bg-surface-low` — the exact
 * colour of the page behind them — with `rounded-xl  p-4` where a border class
 * had been deleted, and `hover:border-brand-300` with no border-width to hover.
 * So the cards were invisible, the hover was inert, the icon tiles were empty
 * boxes, and every one of the nine rows carried the same teal glyph and the
 * same chevron. Nine identical undifferentiated destinations, and the one thing
 * that actually needed attention — unfinished verification — was a tiny badge
 * in the middle of the stack.
 *
 * This version does three things instead:
 *
 *  - Leads with what is BLOCKED. Verification isn't a settings row, it's the
 *    gate on selling paid tickets, so when it is unfinished it gets a banner
 *    that says why and one button. That is the only teal on the page: an accent
 *    the reader should look at exactly once.
 *  - States read as state. Three facts — verification, payouts, default city —
 *    sit on one line as dot-plus-label read-outs, per the house rule against
 *    filled status pills, instead of four invisible cards.
 *  - Destinations are GROUPED. Four named groups in the editorial serif voice,
 *    each one filled panel with hairline-divided rows, so the reader scans four
 *    things and then one row — not nine equal cards. Icons are monochrome, so
 *    they identify a row without nine of them shouting in brand colour.
 */

type Row = {
  href: string
  icon: LucideIcon
  title: string
  desc: string
  /** Renders on the right instead of the chevron's usual silence. */
  hint?: string
}

function SettingsGroup({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section>
      <SectionHeader title={title} className="mb-3" />
      {/* One panel, hairline-divided — not one card per row. The group is the
          object; the rows are its contents. */}
      <div className="overflow-hidden rounded-2xl bg-surface-low divide-y divide-line-soft">
        {rows.map(({ href, icon: Icon, title: rowTitle, desc, hint }) => (
          <Link
            key={href}
            href={href}
            className="group flex items-center gap-4 px-4 py-4 transition-colors hover:bg-surface focus:outline-none focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 sm:px-5"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-fg-muted transition-colors group-hover:text-fg-soft">
              <Icon className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold text-fg">{rowTitle}</span>
              <span className="mt-0.5 block text-meta leading-snug text-fg-subtle">{desc}</span>
            </span>
            {hint && (
              <span className="shrink-0 text-caption font-semibold text-warning-soft">{hint}</span>
            )}
            <ChevronRight
              className="h-4 w-4 shrink-0 text-fg-faint transition-colors group-hover:text-fg-muted"
              aria-hidden
            />
          </Link>
        ))}
      </div>
    </section>
  )
}

/** A dot and a label — never a filled pill (house rule). */
function StateReadout({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'good' | 'warn' | 'idle'
}) {
  const dot =
    tone === 'good' ? 'bg-success' : tone === 'warn' ? 'bg-warning' : 'bg-fg/30'
  const text =
    tone === 'good' ? 'text-success-soft' : tone === 'warn' ? 'text-warning-soft' : 'text-fg-muted'
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="eyebrow shrink-0 text-fg-subtle">{label}</span>
      <span className={`flex min-w-0 items-center gap-1.5 text-meta font-semibold ${text}`}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
        <span className="truncate">{value}</span>
      </span>
    </div>
  )
}

interface SettingsContentProps {
  isVerified: boolean
  isPending: boolean
  hasPayoutSetup: boolean
  defaultLocation: string
  payoutStatusText: string
  /** Payouts, verification and the danger zone are the org owner's alone; an org admin never sees them. */
  isOwner?: boolean
}

export default function SettingsContent({
  isVerified,
  isPending,
  hasPayoutSetup,
  defaultLocation,
  isOwner = true,
}: SettingsContentProps) {
  const { t } = useTranslation('organizer')

  const locationSet = defaultLocation && defaultLocation !== 'Not set'

  return (
    <>
      <PageHeader
        eyebrow={t('settings.eyebrow', 'Organizer')}
        title={t('settings.title')}
        subtitle={t('settings.subtitle')}
      />

      {/* The three live facts, on one line. A settings hub's job is partly to
          answer "is my account actually ready", these answer it without
          spending four cards on it. */}
      <div className="mt-6 flex flex-wrap items-baseline gap-x-8 gap-y-3 border-y border-line py-4">
        {isOwner && (
        <>
        <StateReadout
          label={t('settings.verification')}
          value={
            isVerified
              ? t('settings.verified')
              : isPending
                ? t('settings.pending')
                : t('settings.not_verified')
          }
          tone={isVerified ? 'good' : isPending ? 'warn' : 'idle'}
        />
        <StateReadout
          label={t('settings.payouts')}
          value={hasPayoutSetup ? t('settings.configured') : t('settings.not_setup')}
          tone={hasPayoutSetup ? 'good' : 'idle'}
        />
        </>
        )}
        <StateReadout
          label={t('settings.location')}
          value={locationSet ? defaultLocation : t('settings.not_set')}
          tone={locationSet ? 'good' : 'idle'}
        />
      </div>

      {/* Verification is not really a setting — it is the gate on selling paid
          tickets. Unfinished, it leads; finished, it disappears entirely rather
          than sitting there as a green trophy. */}
      {isOwner && !isVerified && (
        <div className="mt-6 overflow-hidden rounded-2xl bg-warning-strong/10">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3.5">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning-strong/15 text-warning-soft">
                <ShieldCheck className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="text-body font-semibold text-fg">
                  {isPending
                    ? t('settings.verify_banner_pending_title', {
                        defaultValue: 'Verification under review',
                      })
                    : t('settings.verify_banner_title', {
                        defaultValue: 'Verify your identity to get paid',
                      })}
                </h2>
                <p className="mt-1 max-w-[60ch] text-meta leading-relaxed text-fg-muted">
                  {isPending
                    ? t('settings.verify_banner_pending_body', {
                        defaultValue:
                          'We’re reviewing your details. You can keep building events in the meantime, and we’ll email you as soon as it clears.',
                      })
                    : t('settings.verify_banner_body', {
                        defaultValue:
                          'A one-time identity check. Free events and drafts work without it. Only paid ticket sales are held until it’s done.',
                      })}
                </p>
              </div>
            </div>
            {!isPending && (
              <Link
                href="/organizer/verify"
                className="shrink-0 rounded bg-inverse px-5 py-2.5 text-center text-sm font-semibold text-on-inverse transition-opacity hover:opacity-90"
              >
                {t('settings.verify_banner_cta', { defaultValue: 'Start verification' })}
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="mt-8 space-y-8">
        <SettingsGroup
          title={t('settings.group_you', { defaultValue: 'you & your brand' })}
          rows={[
            {
              href: '/organizer/settings/profile',
              icon: User,
              title: t('settings.profile'),
              desc: t('settings.profile_desc'),
            },
            {
              href: '/organizer/settings/organization',
              icon: Building2,
              title: t('settings.organization_brand'),
              desc: t('settings.organization_brand_desc'),
            },
          ]}
        />

        {isOwner && (
        <SettingsGroup
          title={t('settings.group_money', { defaultValue: 'getting paid' })}
          rows={[
            {
              href: '/organizer/settings/payouts',
              icon: CreditCard,
              title: t('settings.payments_payouts'),
              desc: t('settings.payments_payouts_desc'),
            },
            {
              href: '/organizer/verify',
              icon: ShieldCheck,
              title: t('settings.verification_title'),
              desc: t('settings.verification_desc'),
              // Only flag it here when the banner above isn't already shouting.
              hint: isPending ? t('settings.pending') : undefined,
            },
          ]}
        />
        )}

        <SettingsGroup
          title={t('settings.group_events', { defaultValue: 'running your events' })}
          rows={[
            {
              href: '/organizer/settings/defaults',
              icon: SettingsIcon,
              title: t('settings.event_defaults'),
              desc: t('settings.event_defaults_desc'),
            },
            {
              href: '/organizer/settings/team',
              icon: Users,
              title: t('settings.team_permissions'),
              desc: t('settings.team_permissions_desc'),
            },
            {
              href: '/organizer/settings/notifications',
              icon: Bell,
              title: t('settings.notifications'),
              desc: t('settings.notifications_desc'),
            },
          ]}
        />

        <SettingsGroup
          title={t('settings.group_account', { defaultValue: 'account' })}
          rows={[
            {
              href: '/organizer/settings/security',
              icon: Lock,
              title: t('settings.security'),
              desc: t('settings.security_desc'),
            },
          ]}
        />
      </div>

      {/* Danger zone: set apart by distance and a red edge rather than a full
          red box, which read as an error the organizer had already caused. */}
      {isOwner && (
      <Link
        href="/organizer/settings/danger-zone"
        className="group mt-8 flex items-center gap-4 rounded-2xl bg-danger-strong/[0.04] px-4 py-4 ring-1 ring-danger-strong/20 transition-colors hover:bg-danger-strong/[0.09] focus:outline-none focus-visible:ring-2 focus-visible:ring-danger sm:px-5"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-danger-strong/10 text-danger-soft">
          <AlertTriangle className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold text-danger-soft">
            {t('settings.danger_zone')}
          </span>
          <span className="mt-0.5 block text-meta leading-snug text-fg-subtle">
            {t('settings.danger_zone_desc')}
          </span>
        </span>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-danger-soft/40 transition-colors group-hover:text-danger-soft/80"
          aria-hidden
        />
      </Link>
      )}

      {/* Support is not a status and not a setting — it belongs at the end, the
          way a footer answers "and if none of this helped". */}
      <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <p className="text-meta text-fg-subtle">{t('settings.need_help')}</p>
        <Link
          href="/support"
          className="inline-flex items-center gap-1.5 text-meta font-semibold text-fg-soft underline decoration-fg-faint underline-offset-4 transition-colors hover:text-fg"
        >
          <HelpCircle className="h-4 w-4" aria-hidden />
          {t('settings.contact_support')}
        </Link>
      </div>
    </>
  )
}
