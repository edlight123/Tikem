/**
 * Ops emails for MonCash prefunding: the Monday brief and the low-balance
 * alert. Internal (to OPS_ALERT_EMAILS), English, like the FX / MonCash
 * monitor. They only REPORT — nothing here contacts Digicel or moves money.
 *
 * Pure: content and timing only. Sending lives in the cron routes.
 */

import { renderEmail, title, p, gap, button, rowsBlock, appUrl } from '@/lib/email-kit/layout'
import { haitiDay, haitiParts } from '@/lib/payouts/haiti-business-time'
import { formatHtg, type PrefundingPlan } from '@/lib/payouts/prefunding-plan'

export const PREFUNDING_PAGE_PATH = '/admin/money/moncash-funding'

/** The Monday brief's local send hour in Haiti. */
export const BRIEF_HOUR_HAITI = 8

/**
 * Vercel crons run in UTC and Haiti observes DST (UTC-4 in summer, UTC-5 in
 * winter), so the cron fires at BOTH 12:00 and 13:00 UTC on Mondays and the
 * route sends only on the run where it is 8 AM in Port-au-Prince.
 */
export function isBriefHour(now: Date, hour = BRIEF_HOUR_HAITI): boolean {
  const p = haitiParts(now)
  return p.weekday === 1 && p.hour === hour
}

/** Idempotency keys (ops_monitor_runs doc ids), per Haiti day. */
export const briefRunId = (now: Date) => `prefunding-brief-${haitiDay(now)}`
export const lowBalanceRunId = (now: Date) => `prefunding-low-balance-${haitiDay(now)}`

function numbersBlock(plan: PrefundingPlan): string {
  return rowsBlock([
    {
      label: 'Pool balance (live)',
      value: plan.poolBalanceHtg === null ? 'unavailable' : formatHtg(plan.poolBalanceHtg),
    },
    { label: `Minimum (next ${plan.settings.minimumHorizonBusinessDays} business days)`, value: formatHtg(plan.minimum.amountHtg), strong: true },
    { label: `Recommended (next ${plan.settings.recommendedHorizonDays} days + buffer)`, value: formatHtg(plan.recommended.amountHtg) },
    { label: 'Maximum safe to move', value: formatHtg(plan.maximum.amountHtg) },
  ])
}

function warningLines(plan: PrefundingPlan): string[] {
  const shown = plan.warnings.filter((w) => w.severity !== 'info' || w.code === 'minimum_exceeds_maximum')
  return shown.flatMap((w) => [gap(10), p(`${w.severity === 'critical' ? 'Critical' : 'Note'}: ${w.message}`)])
}

export function buildBriefEmail(plan: PrefundingPlan): { subject: string; html: string } {
  const day = haitiDay(new Date(plan.computedAt))
  const critical = plan.warnings.filter((w) => w.severity === 'critical').length
  const headline = plan.nothingDue
    ? 'Nothing due: no organizer MonCash money is owed this week.'
    : plan.minimum.amountHtg > 0
      ? `Request at least ${formatHtg(plan.minimum.amountHtg)} by ${plan.cutoff.label} (Haiti).`
      : 'The pool covers the next two business days.'
  const subject = `[Tikèm ops] MonCash prefunding brief: ${
    plan.nothingDue ? 'nothing due' : `min ${formatHtg(plan.minimum.amountHtg)} · rec ${formatHtg(plan.recommended.amountHtg)}`
  }${critical ? ` · ${critical} critical` : ''} (${day})`
  const html = renderEmail({
    lang: 'en',
    title: 'MonCash prefunding brief',
    preheader: headline,
    status: { label: critical ? 'Needs attention' : 'Weekly brief', tone: critical ? 'amber' : 'grey' },
    footer: 'account',
    blocks: [
      title('MonCash prefunding', 30),
      gap(14),
      p(headline),
      gap(18),
      numbersBlock(plan),
      ...warningLines(plan),
      gap(14),
      p(
        'Minimum and recommended are what to ask Digicel to move from the merchant account into PANTHEON SERVICES PREFUNDED; the maximum is organizer money for ended, released events only. Nothing is sent to Digicel automatically: generate the request on the admin page.'
      ),
      gap(24),
      button('Open MonCash funding', `${appUrl()}${PREFUNDING_PAGE_PATH}`),
    ],
  })
  return { subject, html }
}

export function buildLowBalanceEmail(plan: PrefundingPlan): { subject: string; html: string } {
  const day = haitiDay(new Date(plan.computedAt))
  const need = formatHtg(plan.minimum.poolNeedMinor, 'minor')
  const bal = plan.poolBalanceHtg === null ? 'unavailable' : formatHtg(plan.poolBalanceHtg)
  const subject = `[Tikèm ops] MonCash prefunded pool low: ${bal} vs ${need} needed (${day})`
  const html = renderEmail({
    lang: 'en',
    title: 'MonCash prefunded pool is low',
    preheader: `The pool holds ${bal}; payouts due within ${plan.settings.minimumHorizonBusinessDays} business days need ${need}.`,
    status: { label: 'Needs attention', tone: 'amber' },
    footer: 'account',
    blocks: [
      title('Prefunded pool is low', 30),
      gap(14),
      p(
        `The pool holds ${bal}; payouts that become withdrawable within ${plan.settings.minimumHorizonBusinessDays} business days need ${need} (with Digicel's transfer fee). Next Digicel cutoff: ${plan.cutoff.label} (Haiti).`
      ),
      gap(18),
      numbersBlock(plan),
      ...warningLines(plan),
      gap(24),
      button('Open MonCash funding', `${appUrl()}${PREFUNDING_PAGE_PATH}`),
      gap(10),
      p('You will get this at most once a day.'),
    ],
  })
  return { subject, html }
}
