/**
 * The Money hub's tab strip — one array, six screens.
 *
 * The rail bundles `payoutReview`, `disbursements` and `withdrawals` into a
 * single `payouts` group but can only link to ONE href, so two of those three
 * screens had no route into them from the rail at all. This hub is the group's
 * front door and this array is its map; every page under /admin/money renders
 * the same strip from here so the screens cannot drift apart.
 *
 * Order is the order of the work: the decision you make most often first, the
 * rules that produced it last.
 */
export const MONEY_TABS: { href: string; label: string }[] = [
  { href: '/admin/money', label: 'Review' },
  { href: '/admin/money/disbursements', label: 'Disbursements' },
  { href: '/admin/money/withdrawals', label: 'Withdrawals' },
  { href: '/admin/money/disputes', label: 'Disputes' },
  { href: '/admin/money/refunds', label: 'Refunds' },
  { href: '/admin/money/release-rules', label: 'Release rules' },
]
