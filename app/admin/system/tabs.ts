/**
 * The System hub's tab strip — declared once so its screens cannot drift.
 *
 * System is the console's back-of-house: what the platform is configured to do,
 * and the tools for poking at it directly.
 *
 * Dev tools is conditional, and deliberately so. The route itself is gated
 * server-side by `app/admin/system/dev/layout.tsx` (`requireDevTools`), so an
 * admin without the permission could never open it — but a tab that is always
 * on screen advertises a door that most admins can only walk into a wall
 * through. Callers pass the same `requireDevTools` answer the layout uses, so
 * the strip shows the tab to exactly the people the route lets in.
 *
 * Order matters: `/admin/system` is the hub index and must come first.
 */
export function systemTabs(canUseDevTools: boolean) {
  return [
    { href: '/admin/system', label: 'Settings' },
    { href: '/admin/system/printed-tickets', label: 'Printed tickets' },
    { href: '/admin/system/door-team', label: 'Door team' },
    ...(canUseDevTools ? [{ href: '/admin/system/dev', label: 'Dev tools' }] : []),
  ]
}
