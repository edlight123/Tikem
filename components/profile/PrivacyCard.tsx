'use client'

import { useState } from 'react'
import { Lock, Users, Globe, Phone, UserPlus } from 'lucide-react'
import type { UserProfile } from '@/lib/firestore/user-profile'
import { DEFAULT_PRIVACY, type AttendanceVisibility, type ProfileVisibility } from '@/types/social'
import { ProfileSection, Panel, PanelRows, SwitchRow, FieldLabel } from './ui'

interface PrivacyCardProps {
  profile: UserProfile
  onUpdate: (updates: Partial<UserProfile>) => Promise<void>
}

const ATTENDANCE_OPTIONS: Array<{
  value: AttendanceVisibility
  label: string
  description: string
  Icon: typeof Lock
}> = [
  {
    value: 'nobody',
    label: 'Private',
    description: 'No one can see the events you\'re attending',
    Icon: Lock,
  },
  {
    value: 'friends',
    label: 'Friends only',
    description: 'Only your friends can see you\'re going',
    Icon: Users,
  },
  {
    value: 'everyone',
    label: 'Everyone',
    description: 'Show me in the public "Who\'s going" list',
    Icon: Globe,
  },
]

/**
 * Privacy: one three-way choice, then two switches.
 *
 * Before: the three choices were `border border-white/10` boxes with no fill,
 * and the chosen one differed by swapping that hairline for `border-teal-500
 * ring-1 ring-teal-500` — a one-pixel difference between chosen and unchosen, on
 * the page's most consequential control. The house rule is explicit about this
 * exact failure: selection changes the FILL, and the teal ring is the accent on
 * top. The two switches also painted their knob `bg-white/[0.03]`, so the knob
 * was invisible at both ends of the track.
 */
export function PrivacyCard({ profile, onUpdate }: PrivacyCardProps) {
  const initial = { ...DEFAULT_PRIVACY, ...(profile.privacy || {}) }
  const [privacy, setPrivacy] = useState(initial)
  const [isUpdating, setIsUpdating] = useState(false)
  const [discoverable, setDiscoverable] = useState(profile.discoverable !== false)

  const persist = async (next: typeof privacy) => {
    const previous = privacy
    setPrivacy(next)
    setIsUpdating(true)
    try {
      await onUpdate({ privacy: next })
    } catch (error) {
      console.error('Failed to update privacy:', error)
      setPrivacy(previous)
    } finally {
      setIsUpdating(false)
    }
  }

  const setAttendance = (value: AttendanceVisibility) => persist({ ...privacy, attendance_visibility: value })
  const setProfileVisibility = (value: ProfileVisibility) => persist({ ...privacy, profile_visibility: value })
  // Top-level users.discoverable, not part of `privacy`: it gates "people you
  // may know" and "friends going" (lib/social/suggestions.ts).
  const toggleSuggestions = async () => {
    const next = !discoverable
    setDiscoverable(next)
    setIsUpdating(true)
    try {
      await onUpdate({ discoverable: next })
    } catch (error) {
      console.error('Failed to update discoverability:', error)
      setDiscoverable(!next)
    } finally {
      setIsUpdating(false)
    }
  }
  const toggleDiscoverable = () => persist({ ...privacy, discoverable_by_phone: !privacy.discoverable_by_phone })

  return (
    <ProfileSection
      title="Privacy"
      description="You control who sees your activity. Everything is private by default."
    >
      {/* Attendance visibility */}
      <FieldLabel className="mb-2.5">Who can see events I&apos;m going to</FieldLabel>
      <div className="space-y-2" role="radiogroup" aria-label="Who can see events I'm going to">
        {ATTENDANCE_OPTIONS.map(({ value, label, description, Icon }) => {
          const active = privacy.attendance_visibility === value
          // gap-2.5 / p-3 below, not gap-3 / p-3.5: the description column was
          // 266px on a 402px phone and "No one can see the events you're
          // attending" needs 266.7px, so the FIRST of three otherwise identical
          // options dropped its last word to a second line and stood a row
          // taller than its siblings. Eight pixels back gives all three one
          // line without touching the type, the 36px tile or the marker.
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setAttendance(value)}
              disabled={isUpdating}
              className={`flex w-full items-start gap-2.5 rounded-2xl p-3 text-left transition-colors disabled:opacity-60 ${
                active
                  ? 'bg-white/[0.08] ring-1 ring-inset ring-brand-400/50'
                  : 'bg-white/[0.055] hover:bg-white/[0.12]'
              }`}
            >
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
                  active ? 'bg-brand-500/20 text-brand-300' : 'bg-white/[0.06] text-white/50'
                }`}
              >
                <Icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block !text-[15px] font-semibold text-white">{label}</span>
                <span className="mt-0.5 block !text-[13px] !leading-relaxed text-white/50">
                  {description}
                </span>
              </span>
              {/* The marker: a filled teal dot when chosen, a quiet ring when not. */}
              <span
                className={`mt-1 h-4 w-4 shrink-0 rounded-full ${
                  active
                    ? 'bg-brand-400 ring-1 ring-brand-400'
                    : 'ring-1 ring-inset ring-white/25'
                }`}
                aria-hidden
              />
            </button>
          )
        })}
      </div>
      <p className="mt-2 !text-[12px] text-white/35">
        This controls the &quot;Who&apos;s going&quot; section on events.
      </p>

      {/* The two switches */}
      <Panel className="mt-4">
        <PanelRows>
          <SwitchRow
            title="Public profile"
            description="Let anyone view your profile, bio, and social links. When off, only friends can see them."
            checked={privacy.profile_visibility === 'public'}
            onChange={() =>
              setProfileVisibility(privacy.profile_visibility === 'public' ? 'private' : 'public')
            }
            disabled={isUpdating}
          />
          <SwitchRow
            title="Find me by phone number"
            description="Let people who already have your number find you when they sync contacts. Your number is never shown."
            icon={Phone}
            checked={privacy.discoverable_by_phone}
            onChange={toggleDiscoverable}
            disabled={isUpdating}
          />
          <SwitchRow
            title="Suggest me to people I may know"
            description="Let people who share friends or events with you see you in friend suggestions, and let friends see that you are going. When off, you stay out of both."
            icon={UserPlus}
            checked={discoverable}
            onChange={toggleSuggestions}
            disabled={isUpdating}
          />
        </PanelRows>
      </Panel>
    </ProfileSection>
  )
}
