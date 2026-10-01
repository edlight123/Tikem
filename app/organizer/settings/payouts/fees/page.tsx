import { ChevronRight, Info } from 'lucide-react'
import Link from 'next/link'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import {
  calculateBuyerPricing,
  calculateCappedPlatformFee,
  formatCurrency,
  formatFeePercentage,
} from '@/lib/fees'
import { DEFAULT_PLATFORM_SETTINGS } from '@/types/platform-settings'
import { resolveServerLanguage, tServer } from '@/lib/serverT'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Worked examples come from the SAME functions that price a real checkout
 * (lib/fees.ts), so this page cannot drift from what the platform actually
 * charges — the previous hand-written figures quoted a 2.5% platform fee that had
 * not been true for some time.
 *
 * Two examples, because there are two fee models (lib/country-support.ts):
 * US/CA/FR add the fee on top and the organizer keeps the face value; Haiti
 * deducts it, and the buyer pays exactly the advertised price.
 */
const US_FEES = DEFAULT_PLATFORM_SETTINGS.usCanada
const HT_FEES = DEFAULT_PLATFORM_SETTINGS.haiti

/** The rate differs by market: 10% in the US/Canada, 5% in Haiti. */
const usPlatformFeePercent = formatFeePercentage(US_FEES.platformFeePercentage)
const htPlatformFeePercent = formatFeePercentage(HT_FEES.platformFeePercentage)

/** The per-ticket ceiling, which is what keeps an expensive ticket from carrying an expensive fee. */
const usFeeCapMinor = US_FEES.platformFeeCapMinorByCurrency?.USD ?? null
const htFeeCapMinor = HT_FEES.platformFeeCapMinorByCurrency?.HTG ?? null

/** A $20 ticket in a buyer-pays market. */
const usExample = calculateBuyerPricing(20_00, 'buyer', US_FEES.platformFeePercentage, {
  capMinorPerTicket: usFeeCapMinor,
  quantity: 1,
})
/** The platform's cut of a 1,000 HTG ticket in Haiti, where the organizer bears it. */
const htExamplePlatformFee = calculateCappedPlatformFee(
  1000_00,
  HT_FEES.platformFeePercentage,
  { capMinorPerTicket: htFeeCapMinor, quantity: 1 }
)

export default async function PayoutFeesPage() {
  const payoutPath = '/organizer/settings/payouts/fees'

  const lang = await resolveServerLanguage()
  const t = (path: string, fallback: string) => tServer(lang, path, fallback)

  // Verify authentication
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')?.value

  if (!sessionCookie) {
    redirect(`/auth/login?redirect=${encodeURIComponent(payoutPath)}`)
  }

  let authUser
  try {
    const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true)
    authUser = decodedClaims
  } catch (error) {
    console.error('Error verifying session:', error)
    redirect(`/auth/login?redirect=${encodeURIComponent(payoutPath)}`)
  }

  // Ensure this user is an organizer (attendees should go through the upgrade flow)
  try {
    const userDoc = await adminDb.collection('users').doc(authUser.uid).get()
    const role = userDoc.exists ? userDoc.data()?.role : null
    if (role !== 'organizer') {
      redirect(`/organizer?redirect=${encodeURIComponent(payoutPath)}`)
    }
  } catch (error) {
    console.error('Error checking user role:', error)
    redirect(`/organizer?redirect=${encodeURIComponent(payoutPath)}`)
  }

  const navbarUser = {
    id: authUser.uid,
    email: authUser.email || '',
    full_name: authUser.name || authUser.email || '',
    role: 'organizer' as const,
  }

  return (
    <div className="bg-[#0a0a0a]">
      {/* Header */}
      <div className="bg-white/[0.03] border-b border-white/10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-white/60 mb-3">
            <Link href="/organizer/settings" className="hover:text-white">
              {t('fees_page.breadcrumb_settings', 'Settings')}
            </Link>
            <ChevronRight className="w-4 h-4" />
            <Link href="/organizer/settings/payouts" className="hover:text-white">
              {t('fees_page.breadcrumb_payouts', 'Payouts')}
            </Link>
            <ChevronRight className="w-4 h-4" />
            <span className="text-white font-medium">{t('fees_page.title', 'Fees & Rules')}</span>
          </div>

          {/* Title */}
          <h1 className="font-display text-[clamp(28px,4vw,40px)] leading-[1.04] text-white mb-2">
            {t('fees_page.title', 'Fees & Rules')}
          </h1>
          <p className="text-white/60">
            {t('fees_page.subtitle', 'Understanding platform fees, processing costs, and payout schedules.')}
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          
          {/* Who pays the fee — the thing that decides every number below */}
          <div className="rounded-xl bg-white/[0.03] p-6">
            <h2 className="text-lg font-semibold text-white mb-3">
              {t('fees_page.who_pays_title', 'Who pays the fee')}
            </h2>
            <div className="space-y-3 text-white/70">
              <p>
                {t(
                  'fees_page.who_pays_intro',
                  'It depends on where your event is, and it is not a setting you choose. Each market follows what buyers there expect.'
                )}
              </p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li>
                  <strong>{t('fees_page.us_ca_fr_label', 'United States, Canada, France:')}</strong>{' '}
                  {t(
                    'fees_page.who_pays_us_a',
                    'the fee is added on top at checkout, so you receive the'
                  )}{' '}
                  <strong>{t('fees_page.who_pays_us_strong', 'full ticket price')}</strong>
                  {t(
                    'fees_page.who_pays_us_b',
                    '. Price a ticket at $20 and you receive $20; your buyer sees the total, with the fee shown as a separate line, before they pay.'
                  )}
                </li>
                <li>
                  <strong>{t('fees_page.haiti_label', 'Haiti:')}</strong>{' '}
                  {t(
                    'fees_page.who_pays_ht_a',
                    'the buyer pays exactly the price you advertised and the fee comes out of your proceeds. Price a ticket at 1,000 HTG and the buyer pays 1,000 HTG, of which you receive'
                  )}{' '}
                  <strong>{t('fees_page.who_pays_ht_strong', '1,000 HTG minus fees')}</strong>
                  {t(
                    'fees_page.who_pays_ht_b',
                    '. An advertised price carries trust in a cash-oriented market, so it means what it says.'
                  )}
                </li>
              </ul>
              <p className="text-sm text-white/60">
                {t(
                  'fees_page.who_pays_free_note',
                  'Free events are never charged a fee under either model.'
                )}
              </p>
            </div>
          </div>

          {/* Platform Fee Card */}
          <div className="rounded-xl bg-white/[0.03] p-6">
            <h2 className="text-lg font-semibold text-white mb-3">
              {t('fees_page.platform_fee', 'Platform fee')}
            </h2>
            <div className="space-y-3 text-white/70">
              <p>
                {t('fees_page.platform_fee_a', 'Tikèm charges a')}{' '}
                <strong>
                  {t('fees_page.platform_fee_us_strong', '{{percent}} platform fee').replace(
                    '{{percent}}',
                    usPlatformFeePercent
                  )}
                </strong>{' '}
                {t(
                  'fees_page.platform_fee_b',
                  'on paid ticket sales in the United States, Canada and France, and'
                )}{' '}
                <strong>{htPlatformFeePercent}</strong>{' '}
                {t(
                  'fees_page.platform_fee_c',
                  'in Haiti. This helps us maintain and improve the platform, provide customer support, and continue developing new features.'
                )}
              </p>
              <p>
                {t('fees_page.cap_a', 'The fee is')}{' '}
                <strong>{t('fees_page.cap_strong', 'capped per ticket')}</strong>{' '}
                {t(
                  'fees_page.cap_b',
                  ', never more than {{usCap}} on a US ticket or {{htCap}} in Haiti. An expensive ticket costs us no more to sell than a cheap one, so the percentage stops climbing.'
                )
                  .replace(
                    '{{usCap}}',
                    usFeeCapMinor !== null ? formatCurrency(usFeeCapMinor, 'USD') : ', '
                  )
                  .replace(
                    '{{htCap}}',
                    htFeeCapMinor !== null ? formatCurrency(htFeeCapMinor, 'HTG') : ', '
                  )}
              </p>
              <p>
                {t(
                  'fees_page.who_chooses_a',
                  'You choose who pays it. By default, buyers in the United States, Canada and France pay it on top of your price, and in Haiti it comes out of your payout, but every event has a'
                )}{' '}
                <strong>
                  &ldquo;{t('fees_page.pass_fee_switch', 'Pass the service fee to buyers')}&rdquo;
                </strong>{' '}
                {t('fees_page.who_chooses_b', 'switch, so the choice is yours per event.')}
              </p>
            </div>
          </div>

          {/* Processing Fee Card */}
          <div className="rounded-xl bg-white/[0.03] p-6">
            <h2 className="text-lg font-semibold text-white mb-3">
              {t('fees_page.processing_fee', 'Payment processing fee')}
            </h2>
            <div className="space-y-3 text-white/70">
              <p>
                {t('fees_page.processing_intro', 'Payment processing fees vary by payment method:')}
              </p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li>
                  <strong>{t('fees_page.cards_label', 'Credit/Debit cards:')}</strong>{' '}
                  {t('fees_page.cards_value', '2.9% + HTG 15 per transaction')}
                </li>
                <li>
                  <strong>{t('fees_page.moncash_label', 'MonCash:')}</strong>{' '}
                  {t('fees_page.moncash_value', '2.5% per transaction')}
                </li>
              </ul>
              <p className="text-sm text-white/60">
                {t(
                  'fees_page.processing_note',
                  'Tikèm pays these out of its own fee, in every country and whoever bears the fee — they are never added to your buyer\'s total or deducted from your payout.'
                )}
              </p>
            </div>
          </div>

          {/* Payout Schedule Card */}
          <div className="rounded-xl bg-white/[0.03] p-6">
            <h2 className="text-lg font-semibold text-white mb-3">
              {t('fees_page.payout_schedule', 'Payout schedule')}
            </h2>
            <div className="space-y-3 text-white/70">
              <p>
                {t('fees_page.schedule_a', 'Payouts are processed')}{' '}
                <strong>{t('fees_page.schedule_strong', '7 days after your event ends')}</strong>
                {t(
                  'fees_page.schedule_b',
                  '. This holding period allows time for any refund requests or payment disputes to be resolved.'
                )}
              </p>
              <p>
                {t(
                  'fees_page.schedule_c',
                  'Once the holding period is complete, you can request a payout from your organizer dashboard. Payouts are typically processed within'
                )}{' '}
                <strong>{t('fees_page.schedule_strong2', '3-5 business days')}</strong>.
              </p>
              <div className="border border-brand-500/30 rounded-lg p-4 mt-4">
                <div className="flex gap-3">
                  <Info className="w-5 h-5 text-brand-300 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-brand-300">
                    <strong>{t('fees_page.note_label', 'Note:')}</strong>{' '}
                    {t(
                      'fees_page.note_body',
                      'For free events, there are no fees charged. Platform and processing fees only apply to paid ticket sales.'
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Example Calculation Card — one per fee model, so neither reads as the rule */}
          <div className="rounded-xl bg-white/[0.03] p-6">
            <h2 className="text-lg font-semibold text-white mb-3">
              {t('fees_page.examples_title', 'Example calculations')}
            </h2>

            <div className="space-y-5">
              {/* Buyer pays — US / Canada / France */}
              <div>
                <h3 className="text-sm font-semibold text-white mb-2">
                  {t(
                    'fees_page.example_us_title',
                    'United States, Canada, France: the buyer pays the fee'
                  )}
                </h3>
                <div className="rounded-lg bg-white/[0.03] p-4 font-mono text-sm">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-white/60">
                        {t('fees_page.your_ticket_price', 'Your ticket price:')}
                      </span>
                      <span className="text-white font-semibold">
                        {formatCurrency(usExample.faceValue, 'USD')}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/60">
                        {t('fees_page.fee_added_at_checkout', 'Fee added at checkout:')}
                      </span>
                      <span className="text-white font-semibold">
                        + {formatCurrency(usExample.buyerFee, 'USD')}
                      </span>
                    </div>
                    <div className="border-t border-white/10 my-2"></div>
                    <div className="flex justify-between">
                      <span className="text-white/60">
                        {t('fees_page.your_buyer_pays', 'Your buyer pays:')}
                      </span>
                      <span className="text-white font-semibold">
                        {formatCurrency(usExample.chargeAmount, 'USD')}
                      </span>
                    </div>
                    <div className="flex justify-between text-lg">
                      <span className="text-white font-semibold">
                        {t('fees_page.you_receive', 'You receive:')}
                      </span>
                      <span className="text-emerald-300 font-bold">
                        {formatCurrency(usExample.organizerNet, 'USD')}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-sm text-white/60">
                  {t(
                    'fees_page.example_us_note',
                    'You receive the full {{amount}}. Your buyer sees the total, with the fee itemized, before they pay, never at the last step.'
                  ).replace('{{amount}}', formatCurrency(usExample.faceValue, 'USD'))}
                </p>
              </div>

              {/* Organizer pays — Haiti */}
              <div>
                <h3 className="text-sm font-semibold text-white mb-2">
                  {t('fees_page.example_ht_title', 'Haiti: the fee comes out of your proceeds')}
                </h3>
                <div className="rounded-lg bg-white/[0.03] p-4 font-mono text-sm">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-white/60">
                        {t('fees_page.your_ticket_price', 'Your ticket price:')}
                      </span>
                      <span className="text-white font-semibold">HTG 1,000</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/60">
                        {t('fees_page.your_buyer_pays', 'Your buyer pays:')}
                      </span>
                      <span className="text-white font-semibold">HTG 1,000</span>
                    </div>
                    <div className="border-t border-white/10 my-2"></div>
                    <div className="flex justify-between text-red-300">
                      <span>
                        {t('fees_page.example_platform_fee_line', 'Platform fee ({{percent}}):').replace(
                          '{{percent}}',
                          htPlatformFeePercent
                        )}
                      </span>
                      <span>- {formatCurrency(htExamplePlatformFee, 'HTG')}</span>
                    </div>
                    <div className="border-t border-white/10 my-2"></div>
                    <div className="flex justify-between text-lg">
                      <span className="text-white font-semibold">
                        {t('fees_page.you_receive', 'You receive:')}
                      </span>
                      <span className="text-emerald-300 font-bold">
                        {formatCurrency(1000_00 - htExamplePlatformFee, 'HTG')}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-sm text-white/60">
                  {t(
                    'fees_page.example_ht_note',
                    'You receive 1,000 HTG minus the platform fee. The advertised price is what your buyer is charged, to the gourde.'
                  )}
                </p>
              </div>

              <p className="text-sm text-white/60">
                {t(
                  'fees_page.examples_note',
                  'Simplified examples. Actual processing fees vary with the payment method your attendees use.'
                )}
              </p>
            </div>
          </div>

          {/* Refunds Note Card */}
          <div className="rounded-xl bg-white/[0.03] p-6">
            <h2 className="text-lg font-semibold text-white mb-3">
              {t('fees_page.refunds_title', 'Refunds')}
            </h2>
            <div className="space-y-3 text-white/70">
              <p>
                {t('fees_page.refunds_intro', 'When you issue a refund to an attendee:')}
              </p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li>
                  {t('fees_page.refunds_b1', 'The platform fee is refunded to you (not charged)')}
                </li>
                <li>
                  {t('fees_page.refunds_b2_a', 'Processing fees are')}{' '}
                  <strong>{t('fees_page.refunds_b2_strong', 'not refundable')}</strong>{' '}
                  {t('fees_page.refunds_b2_b', 'as they were already paid to payment processors')}
                </li>
                <li>
                  {t('fees_page.refunds_b3', 'The refunded amount is deducted from your next payout')}
                </li>
              </ul>
            </div>
          </div>

          {/* Back Link */}
          <div className="pt-4">
            <Link
              href="/organizer/settings/payouts"
              className="inline-flex items-center gap-2 text-sm font-medium text-brand-300 hover:text-brand-300"
            >
              ← {t('fees_page.back_to_payouts', 'Back to Payouts')}
            </Link>
          </div>
        </div>
      </div>    </div>
  )
}
