'use client'

import { ConsolePanel } from '@/components/admin/console'
import { formatDate } from './format'

/** The account facts an admin checks before acting on the buttons above. */
export default function OrganizerAccountCard({
  id,
  user,
  isBanned,
  canPost,
}: {
  id: string
  user: any
  isBanned: boolean
  canPost: boolean
}) {
  return (
    <ConsolePanel className="p-4 sm:p-5">
      <h2 className="label-mono mb-4 text-eyebrow uppercase tracking-[0.18em] text-console-faint">
        Account Information
      </h2>
      <dl className="space-y-3">
        <div>
          <dt className="text-xs text-console-mut">User ID</dt>
          <dd className="text-sm text-console-text font-code break-all">{id}</dd>
        </div>
        <div>
          <dt className="text-xs text-console-mut">Phone</dt>
          <dd className="text-sm text-console-text">{user.phone_number || 'Not provided'}</dd>
        </div>
        <div>
          <dt className="text-xs text-console-mut">Account Status</dt>
          <dd
            className={`label-mono uppercase text-sm font-semibold ${isBanned ? 'text-console-red' : 'text-console-green'}`}
          >
            {isBanned ? 'Banned' : 'Active'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-console-mut">Can Create Events</dt>
          <dd
            className={`label-mono uppercase text-sm font-semibold ${canPost ? 'text-console-green' : 'text-console-red'}`}
          >
            {canPost ? 'Yes' : 'No'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-console-mut">Joined</dt>
          <dd className="font-mono tabular-nums text-sm text-console-text">{formatDate(user.created_at)}</dd>
        </div>
        <div>
          <dt className="text-xs text-console-mut">Last Updated</dt>
          <dd className="font-mono tabular-nums text-sm text-console-text">{formatDate(user.updated_at)}</dd>
        </div>
      </dl>
    </ConsolePanel>
  )
}
