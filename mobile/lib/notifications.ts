import { db } from '../config/firebase';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import type { Notification } from '../types/notifications';

function extractInviteTokenFromUrl(url: unknown): string {
  if (typeof url !== 'string' || !url) return ''
  try {
    const parsed = new URL(url)
    return parsed.searchParams.get('token') || ''
  } catch {
    return ''
  }
}

/**
 * Get notifications for a user
 */
export async function getUserNotifications(
  userId: string,
  limitCount: number = 50
): Promise<Notification[]> {
  try {
    const notificationsRef = collection(db, 'users', userId, 'notifications');
    const q = query(
      notificationsRef,
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );

    const snapshot = await getDocs(q);
    const notifications: Notification[] = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      notifications.push({
        id: doc.id,
        userId,
        type: data.type,
        title: data.title,
        message: data.message,
        actionUrl: data.actionUrl,
        metadata: data.metadata,
        eventId: data.eventId,
        ticketId: data.ticketId,
        isRead: data.isRead ?? false,
        readAt: data.readAt?.toDate?.()?.toISOString() || data.readAt,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
      });
    });

    return notifications;
  } catch (error) {
    console.error('Error getting notifications:', error);
    return [];
  }
}

/**
 * Get unread notification count for a user
 */
export async function getUnreadCount(userId: string): Promise<number> {
  try {
    const notificationsRef = collection(db, 'users', userId, 'notifications');
    const q = query(
      notificationsRef,
      where('isRead', '==', false)
    );

    const snapshot = await getDocs(q);
    return snapshot.size;
  } catch (error) {
    console.error('Error getting unread count:', error);
    return 0;
  }
}

/**
 * Mark a notification as read
 */
export async function markAsRead(userId: string, notificationId: string): Promise<void> {
  try {
    const notificationRef = doc(db, 'users', userId, 'notifications', notificationId);
    await updateDoc(notificationRef, {
      isRead: true,
      readAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    throw error;
  }
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllAsRead(userId: string): Promise<void> {
  try {
    const notificationsRef = collection(db, 'users', userId, 'notifications');
    const q = query(
      notificationsRef,
      where('isRead', '==', false)
    );

    const snapshot = await getDocs(q);
    const readAt = new Date().toISOString();

    // A batch holds at most 500 writes; one big batch failed outright for a
    // long-unread inbox.
    for (let i = 0; i < snapshot.docs.length; i += 450) {
      const batch = writeBatch(db);
      snapshot.docs.slice(i, i + 450).forEach((document) => {
        batch.update(document.ref, { isRead: true, readAt });
      });
      await batch.commit();
    }
  } catch (error) {
    console.error('Error marking all as read:', error);
    throw error;
  }
}

/**
 * Delete a single notification for a user.
 */
export async function deleteNotification(userId: string, notificationId: string): Promise<void> {
  try {
    const notificationRef = doc(db, 'users', userId, 'notifications', notificationId)
    await deleteDoc(notificationRef)
  } catch (error) {
    console.error('Error deleting notification:', error)
    throw error
  }
}

/**
 * Best-effort: delete any staff invite notifications matching the invite token.
 * This is used for deep-link redeems where we don't have the notificationId.
 */
export async function deleteStaffInviteNotificationsByToken(
  userId: string,
  details: { eventId: string; token: string }
): Promise<number> {
  const notificationsRef = collection(db, 'users', userId, 'notifications')
  let deleted = 0

  try {
    // We can't reliably query on every possible metadata shape, so we:
    // 1) narrow by type and eventId (top-level or metadata)
    // 2) filter client-side by token

    const queries = [
      query(notificationsRef, where('type', '==', 'staff_invite'), where('eventId', '==', details.eventId)),
      query(notificationsRef, where('type', '==', 'staff_invite'), where('metadata.eventId', '==', details.eventId)),
    ]

    const seen = new Set<string>()
    const docsToDelete: Array<{ ref: any; id: string }> = []

    for (const q of queries) {
      const snapshot = await getDocs(q)
      snapshot.forEach((document) => {
        if (seen.has(document.id)) return
        seen.add(document.id)

        const data: any = document.data() || {}
        const tokenFromMetadata = typeof data?.metadata?.token === 'string' ? String(data.metadata.token) : ''
        const tokenFromMetadataUrl = extractInviteTokenFromUrl(data?.metadata?.url)
        const tokenFromActionUrl = extractInviteTokenFromUrl(data?.actionUrl)
        const tokenFromMetaAlt = typeof data?.metadata?.inviteToken === 'string' ? String(data.metadata.inviteToken) : ''

        const token = tokenFromMetadata || tokenFromMetaAlt || tokenFromMetadataUrl || tokenFromActionUrl
        if (token && token === details.token) {
          docsToDelete.push({ ref: document.ref, id: document.id })
        }
      })
    }

    if (docsToDelete.length === 0) return 0

    const batch = writeBatch(db)
    for (const d of docsToDelete) {
      batch.delete(d.ref)
      deleted += 1
    }
    await batch.commit()
    return deleted
  } catch (error) {
    console.error('Error deleting staff invite notifications:', error)
    return deleted
  }
}

/**
 * Best-effort: delete staff invite notifications for a given event.
 * Useful when the notification payload doesn't store the invite token.
 */
export async function deleteStaffInviteNotificationsByEvent(
  userId: string,
  details: { eventId: string }
): Promise<number> {
  const notificationsRef = collection(db, 'users', userId, 'notifications')
  let deleted = 0

  try {
    const queries = [
      query(notificationsRef, where('type', '==', 'staff_invite'), where('eventId', '==', details.eventId)),
      query(notificationsRef, where('type', '==', 'staff_invite'), where('metadata.eventId', '==', details.eventId)),
    ]

    const seen = new Set<string>()
    const docsToDelete: Array<{ ref: any; id: string }> = []

    for (const q of queries) {
      const snapshot = await getDocs(q)
      snapshot.forEach((document) => {
        if (seen.has(document.id)) return
        seen.add(document.id)
        docsToDelete.push({ ref: document.ref, id: document.id })
      })
    }

    if (docsToDelete.length === 0) return 0

    const batch = writeBatch(db)
    for (const d of docsToDelete) {
      batch.delete(d.ref)
      deleted += 1
    }
    await batch.commit()
    return deleted
  } catch (error) {
    console.error('Error deleting staff invite notifications for event:', error)
    return deleted
  }
}

/**
 * Delete all notifications for a user.
 *
 * Note: Firestore batches are limited (500 ops). We loop in chunks.
 */
export async function clearAllNotifications(userId: string): Promise<number> {
  const notificationsRef = collection(db, 'users', userId, 'notifications');
  let deleted = 0;

  try {
    // Keep deleting until the collection is empty.
    // Use a chunk size safely below 500 to leave room for any future ops.
    const CHUNK_SIZE = 450;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const q = query(notificationsRef, limit(CHUNK_SIZE));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        break;
      }

      const batch = writeBatch(db);
      snapshot.forEach((document) => {
        batch.delete(document.ref);
        deleted += 1;
      });

      await batch.commit();
    }

    return deleted;
  } catch (error) {
    console.error('Error clearing all notifications:', error);
    throw error;
  }
}
