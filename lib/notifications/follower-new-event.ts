/**
 * The words of the "an organizer you follow published a new event" push, in
 * the follower's own language (users/{uid}.language). Pure. Sent through
 * sendDiscretionary, category 'organizer_follow' (switch
 * notify_followed_organizers), from app/api/events/[id]/publish.
 */
import { commonT } from '@/lib/commonT'

export function followerNewEventCopy(
  lang: unknown,
  organizerName: string,
  eventTitle: string
): { title: string; body: string } {
  const t = commonT(lang)
  const organizer = String(organizerName || '').trim().slice(0, 80) || t('pushCopy.newEvent.someone')
  return {
    title: t('pushCopy.newEvent.title', { organizer }),
    body: String(eventTitle || '').trim().slice(0, 140) || t('pushCopy.newEvent.fallbackBody'),
  }
}
