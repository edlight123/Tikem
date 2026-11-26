/**
 * The push when someone sends you a friend request, or accepts yours (the
 * in-app notification already existed; the push did not). Ported from Tikra.
 * In the recipient's own language (pushCopy.friendRequest.* in the website's
 * common dictionaries), through the notification policy (their Friends switch
 * notify_friend_invites, quiet hours), and never from someone they blocked
 * (the request route refuses those first). Tapping it opens Friends in the
 * app (tikem://connections, mobile/navigation/linkingConfig).
 */
import { adminDb } from '@/lib/firebase/admin'
import { commonT } from '@/lib/commonT'
import { decideSend } from '@/lib/notifications/policy'
import { sendPushNotification } from '@/lib/notification-triggers'

export type FriendPushKind = 'request' | 'accepted'

/** The words of the push, in `lang`. Pure. */
export function friendPushCopy(kind: FriendPushKind, actorName: string, lang: unknown): { title: string; body: string } {
  const t = commonT(lang)
  const name = String(actorName || '').trim().slice(0, 60) || t('pushCopy.friendRequest.someone')
  return kind === 'request'
    ? { title: t('pushCopy.friendRequest.requestTitle'), body: t('pushCopy.friendRequest.requestBody', { name }) }
    : { title: t('pushCopy.friendRequest.acceptedTitle'), body: t('pushCopy.friendRequest.acceptedBody', { name }) }
}

export async function pushFriendRequest(
  targetUid: string,
  actor: { id: string; name: string },
  kind: FriendPushKind
): Promise<boolean> {
  try {
    const snap = await adminDb.collection('users').doc(targetUid).get()
    const user = snap.exists ? (snap.data() as Record<string, any>) : null
    if (!decideSend({ user, category: 'friend_request' }).send) return false
    const copy = friendPushCopy(kind, actor.name, user?.language)
    await sendPushNotification(
      targetUid,
      copy.title,
      copy.body,
      kind === 'request' ? '/connections?initialTab=requests' : '/connections',
      { type: kind === 'request' ? 'connection_request' : 'connection_accepted', actorId: actor.id }
    )
    return true
  } catch (e) {
    console.warn('[friend-push] failed', (e as Error)?.message)
    return false
  }
}
