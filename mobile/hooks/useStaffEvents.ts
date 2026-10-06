import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { backendJson } from '../lib/api/backend';
import { useI18n } from '../contexts/I18nContext';
import { getStaffEventIds } from '../lib/staffAssignments';

type StaffMemberDoc = {
  uid?: string;
  eventId?: string;
  role?: string;
  permissions?: { checkin?: boolean; viewAttendees?: boolean };
};

export type StaffEventSummary = {
  id: string;
  title: string;
  start_datetime?: any;
  venue_name?: string;
  city?: string;
  banner_image_url?: string | null;
  cover_image_url?: string | null;
};

export interface UseStaffEventsResult {
  events: StaffEventSummary[];
  loading: boolean;
  /** True while a pull-to-refresh (silent) reload is in flight. */
  refreshing: boolean;
  error: boolean;
  /** Pull-to-refresh handler (silent reload; toggles `refreshing`). */
  refresh: () => Promise<void>;
}

/**
 * Shared staff-events loader — the common Firestore logic previously duplicated
 * in `screens/staff/StaffEventsScreen` and `screens/staff/StaffScanScreen`.
 *
 * Mirrors those screens exactly:
 *  1. Discover assignments from the server (GET /api/staff/events, an Admin
 *     SDK `members` collectionGroup query on `uid`), so an event assigned on
 *     another device shows up here.
 *  2. Merge locally persisted eventIds (added on successful invite redeem);
 *     these are the offline fallback when the server cannot be reached.
 *  3. Verify per-event access by reading the direct member doc; a member with
 *     `permissions.checkin === false` is excluded (missing → allowed, back-compat).
 *  4. Hydrate each allowed event's summary from its `events/{id}` doc.
 *
 * Loads on mount and on focus (silent), and exposes a pull-to-refresh `refresh`.
 */
export function useStaffEvents(): UseStaffEventsResult {
  const { t } = useI18n();
  const uid = auth.currentUser?.uid || null;

  const [events, setEvents] = useState<StaffEventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const loadEvents = useCallback(
    async (options?: { silent?: boolean; isCancelled?: () => boolean }) => {
      if (!uid) {
        setEvents([]);
        setLoading(false);
        return;
      }

      const silent = Boolean(options?.silent);
      if (!silent) setLoading(true);

      try {
        const eventIds: string[] = [];

        // Primary path: the server's view of every assignment for this uid.
        // The client-side collectionGroup query this replaced filtered on
        // `__name__ == uid`, which Firestore rejects for a collection group (it
        // needs a full document path), so it always failed and only events
        // redeemed on THIS device ever appeared.
        try {
          const res = await backendJson<{ eventIds?: string[] }>('/api/staff/events');
          for (const id of Array.isArray(res?.eventIds) ? res.eventIds : []) {
            if (id) eventIds.push(String(id));
          }
        } catch (e) {
          // Offline or server error: the locally persisted list below still works.
          console.warn('[useStaffEvents] /api/staff/events failed; using local assignments', e);
        }

        // Fallback: include locally persisted eventIds (added on successful invite redeem).
        const persisted = await getStaffEventIds();
        for (const id of persisted) eventIds.push(id);

        const uniqueEventIds = Array.from(new Set(eventIds)).filter(Boolean);

        // Verify access per event by reading the direct member doc. The reads
        // are independent per id, so fan them out in parallel instead of awaiting
        // each in sequence. One unreadable id (a stale local entry, an event
        // deleted since) must not take the whole list down with it.
        const memberSnaps = await Promise.all(
          uniqueEventIds.map((eventId) =>
            getDoc(doc(db, 'events', eventId, 'members', uid)).catch(() => null)
          )
        );
        // Every read failed (offline with nothing cached): an error, not "none".
        if (memberSnaps.length > 0 && memberSnaps.every((snap) => snap === null)) {
          throw new Error('Could not read any staff assignment');
        }
        const allowedEventIds: string[] = [];
        memberSnaps.forEach((memberSnap, i) => {
          if (!memberSnap || !memberSnap.exists()) return;
          const member = memberSnap.data() as StaffMemberDoc;
          const checkinFlag = member?.permissions?.checkin;
          // Back-compat: missing permissions should not hide assigned events.
          if (checkinFlag === false) return;
          allowedEventIds.push(uniqueEventIds[i]);
        });

        // Hydrate each allowed event's summary — again independent per id.
        const eventSnaps = await Promise.all(
          allowedEventIds.map((eventId) => getDoc(doc(db, 'events', eventId)).catch(() => null))
        );
        const loaded: StaffEventSummary[] = [];
        eventSnaps.forEach((eventSnap) => {
          if (!eventSnap || !eventSnap.exists()) return;
          const data = eventSnap.data() as any;
          loaded.push({
            id: eventSnap.id,
            title: data?.title || t('common.event'),
            start_datetime: data?.start_datetime,
            venue_name: data?.venue_name || '',
            city: data?.city || '',
            banner_image_url: data?.banner_image_url || null,
            cover_image_url: data?.cover_image_url || null,
          });
        });

        if (options?.isCancelled?.()) return;
        setError(false);
        setEvents(loaded);
      } catch (e) {
        if (options?.isCancelled?.()) return;
        setError(true);
        setEvents([]);
      } finally {
        if (options?.isCancelled?.()) return;
        if (!silent) setLoading(false);
      }
    },
    [uid, t]
  );

  useEffect(() => {
    let cancelled = false;
    loadEvents({ isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [loadEvents]);

  // Refresh after redeeming an invite or returning to this tab.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadEvents({ silent: true, isCancelled: () => cancelled });
      return () => {
        cancelled = true;
      };
    }, [loadEvents])
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadEvents({ silent: true });
    } finally {
      setRefreshing(false);
    }
  }, [loadEvents]);

  return { events, loading, refreshing, error, refresh };
}

export default useStaffEvents;
