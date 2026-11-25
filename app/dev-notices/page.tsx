// TEMPORARY visual-check page. Delete before commit.
import { activeNationalDay } from '@/lib/nationalDays'
import { AttendanceDefaultBanner } from '@/components/profile/AttendanceDefaultBanner'
import { FindFriendsCard } from '@/components/profile/DashboardModules'
import NationalDayBanner from '@/components/home/NationalDayBanner'
import { OldAttendanceDefaultBanner } from './OldAttendance'
import { OldFindFriendsCard } from './OldFindFriends'
import OldNationalDayBanner from './OldNationalDay'

export const dynamic = 'force-dynamic'

export default function Page({ searchParams }: { searchParams: { v?: string } }) {
  const before = searchParams.v === 'before'
  const day = activeNationalDay(new Date(), null, { force: 'vertieres' })!
  return (
    <main className="min-h-screen bg-canvas pb-16 pt-6">
      {before ? (
        <>
          <OldNationalDayBanner active={day} href="/discover" eventCount={3} />
          <div className="mx-auto max-w-7xl space-y-6 px-4 pt-6 sm:px-6 lg:px-8">
            <OldAttendanceDefaultBanner show />
            <OldFindFriendsCard />
          </div>
        </>
      ) : (
        <>
          <NationalDayBanner active={day} href="/discover" eventCount={3} />
          <div className="mx-auto max-w-7xl px-4 pt-3 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-3">
              <AttendanceDefaultBanner show />
              <FindFriendsCard />
            </div>
            {/* The same strips in a narrower column, as on /profile at lg. */}
            <div className="mt-10 grid grid-cols-1 gap-x-12 gap-y-3 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="flex min-w-0 flex-col gap-3">
                <AttendanceDefaultBanner show />
                <FindFriendsCard />
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                <AttendanceDefaultBanner show />
                <FindFriendsCard />
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  )
}
