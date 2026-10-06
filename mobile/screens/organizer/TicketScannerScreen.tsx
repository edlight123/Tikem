import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  ScrollView,
  Switch,
} from 'react-native';
import { colors as T, radius, spacing } from '../../theme/tokens';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { db } from '../../config/firebase';
import { doc, getDoc, getDocs, query, collection, where } from 'firebase/firestore';
import { auth } from '../../config/firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useI18n } from '../../contexts/I18nContext';
import { RADIUS } from '../../config/brand';
import WhitePillCTA from '../../components/WhitePillCTA';
import { SecondaryPill } from '../../components/auth/SecondaryPill';
import EmptyState from '../../components/EmptyState';
import StatTriplet from '../../components/StatTriplet';
import StatusChip from '../../components/StatusChip';
import ManualLookupSheet, { DoorGuest } from '../../components/scanner/ManualLookupSheet';
import DoorResultOverlay, { DoorResult } from '../../components/scanner/DoorResultOverlay';
import {
  ENTRY_POINTS,
  ScanOutcome,
  parseTicketId,
  scanOutcomeFeedback,
  scanReadFeedback,
} from '../../lib/scanner';
import {
  DoorRow,
  findDoorRow,
  isRefundHeldRow,
  judgeDoorRow,
  judgeScannedCodeAgainstRow,
  markRowCheckedIn,
  DoorVerdict,
  ticketQrVersionOf,
} from '../../lib/doorList';
import {
  DoorAccessError,
  DoorListPayload,
  fetchDoorList,
  flushCheckInQueue,
  loadCachedDoorList,
  pendingCount,
  postCheckIn,
  queueCheckIn,
  readCheckInQueue,
  saveDoorList,
} from '../../lib/doorCheckIn';
import { Camera, DoorOpen, Search, Vibrate, VibrateOff } from 'lucide-react-native';

type RouteParams = {
  TicketScanner: {
    eventId: string;
    /** Open the find-a-guest sheet on arrival (Scan screen's "Find a guest by name"). */
    openLookup?: boolean;
    /** Start in door mode (Scan screen's "Door mode"). */
    doorMode?: boolean;
  };
};

type CheckInMethod = 'scan' | 'manual';

type ScanResult = {
  // CHECKED_IN = admitted just now on this device (emerald). ALREADY_CHECKED_IN
  // = was already in when read (amber). They used to share one status, so a
  // successful check-in and a duplicate looked identical.
  status:
    | 'VALID'
    | 'CHECKED_IN'
    | 'ALREADY_CHECKED_IN'
    | 'EXPIRED'
    | 'CANCELLED'
    | 'WRONG_EVENT'
    | 'NOT_FOUND'
    | 'ERROR';
  attendeeName?: string;
  tierName?: string;
  message?: string;
  checkedInTime?: Date;
  ticketId?: string;
  // HARD validity block derived from the resolved tier's valid_from /
  // valid_until ENTRY window. When set on a VALID ticket, the default green
  // "Confirm check-in" action is disabled and the sheet shows this reason
  // (red/error, with the date); a valid staff member can still admit via an
  // explicit, less-prominent override that calls handleConfirmCheckIn.
  validityBlock?: string;
  /** How this ticket reached the scanner — recorded as check_in_method. */
  method?: CheckInMethod;
  /**
   * The raw string the camera read. Sent with the check-in so the server
   * judges its QR version (a code from before a transfer never admits).
   */
  code?: string;
};

/**
 * 'full'  = owner / staff with view-attendees: reads tickets from Firestore.
 * 'door'  = staff with check-in only: the server's door list + check-in API,
 *           because Firestore rules (rightly) refuse them a tickets read.
 */
type AccessMode = 'full' | 'door';

/** What a commit did: written (or queued), or refused by the server's re-check. */
type CommitOutcome = { synced: boolean; refused?: ScanResult };

type RecentScan = {
  key: string;
  name: string;
  outcome: ScanOutcome;
  label: string;
  at: Date;
};

// Same rule the scanner has always used to admit a ticket: legacy tickets
// without a status pass, as do the live vocabulary (valid | confirmed | active).
function isLiveStatus(raw: unknown): boolean {
  const s = String(raw ?? '').trim().toLowerCase();
  return s === '' || s === 'valid' || s === 'active' || s === 'confirmed';
}

const PREFS_KEY = 'scanner_door_prefs';
// A QR still in frame after its verdict closes must not be read again as a
// duplicate (mirrors useScanController's duplicateWindowMs on the web).
const DUPLICATE_WINDOW_MS = 3500;

// Given a resolved tier object, return a human block reason when `now` is
// outside its valid_from / valid_until entry window, or undefined when the
// tier is missing, carries no window, or we are in-window (empty bound = open).
function computeTierValidityBlock(
  tier: any,
  locale: string,
  t: (key: string) => string,
): string | undefined {
  if (!tier) return undefined;

  const now = new Date();
  const from = tier.valid_from ? new Date(tier.valid_from) : null;
  const until = tier.valid_until ? new Date(tier.valid_until) : null;

  if (from && !isNaN(from.getTime()) && now < from) {
    return `${t('organizerCreateEventFlow.canvas.ticketNotYetValid')} ${from.toLocaleString(locale)}`;
  }
  if (until && !isNaN(until.getTime()) && now > until) {
    return `${t('organizerCreateEventFlow.canvas.ticketExpired')} ${until.toLocaleString(locale)}`;
  }
  return undefined;
}

// Resolve a ticket's tier PREFERRING `tier_id`: match it within the event's
// embedded ticket_tiers, else fetch ticket_tiers/{tier_id}. Fall back to a
// name match against the event's tiers for older tickets lacking a tier_id.
async function resolveTicketTier(
  eventTiers: any[],
  tierId: string | undefined,
  tierName: string,
): Promise<any | undefined> {
  const tiers = Array.isArray(eventTiers) ? eventTiers : [];

  if (typeof tierId === 'string' && tierId.length > 0) {
    const byId = tiers.find(
      (x) => String(x?.id ?? x?.tier_id ?? x?.tierId ?? '') === tierId,
    );
    if (byId) return byId;
    try {
      const tierSnap = await getDoc(doc(db, 'ticket_tiers', tierId));
      if (tierSnap.exists()) return tierSnap.data();
    } catch (e) {
      console.warn('Failed to resolve tier from ticket_tiers:', e);
    }
  }

  const norm = (s: any) => String(s ?? '').trim().toLowerCase();
  const target = norm(tierName);
  if (!target) return undefined;
  return tiers.find((x) => norm(x?.name) === target);
}

export default function TicketScannerScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const route = useRoute<RouteProp<RouteParams, 'TicketScanner'>>();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { eventId, openLookup, doorMode: startInDoorMode } = route.params;

  const { t, language } = useI18n();
  const locale = language === 'fr' ? 'fr-FR' : language === 'ht' ? 'fr-HT' : 'en-US';

  const overrideLabel = t('organizerTicketScanner.actions.overrideCheckIn');

  const [permission, requestPermission] = useCameraPermissions();
  const [flashOn, setFlashOn] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  // The camera can fire several reads before a state update lands; the ref is
  // the real lock.
  const processingRef = useRef(false);
  const lastScanRef = useRef<{ id: string | null; at: number }>({ id: null, at: 0 });
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  // Offline support. `offlineReady` is how many guests we pre-loaded into the
  // cache; `isOffline` flips true the moment a read/write is served from cache
  // (i.e. no connectivity) so staff get a clear "scans will sync" signal.
  const [offlineReady, setOfflineReady] = useState<number | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  // Guest list for manual lookup + door counters. Built from the same
  // pre-warm read that fills the offline cache; email stays in memory only.
  const [guests, setGuests] = useState<DoorGuest[] | null>(null);
  const [listUnavailable, setListUnavailable] = useState(false);
  const [showLookup, setShowLookup] = useState(false);

  // Door mode (web parity: components/scan/DoorModeInterface).
  const [doorMode, setDoorMode] = useState(false);
  const [entryPoint, setEntryPoint] = useState<string>(ENTRY_POINTS[0].value);
  const [hapticsOn, setHapticsOn] = useState(true);
  const [doorResult, setDoorResult] = useState<DoorResult | null>(null);
  const doorTicketRef = useRef<{
    ticketId: string;
    method: CheckInMethod;
    name?: string;
    tier?: string;
    code?: string;
  } | null>(null);
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);
  const eventMetaRef = useRef<{ allowReentry: boolean }>({ allowReentry: false });
  const [eventTitle, setEventTitle] = useState<string>('');

  // Door-only access (check-in permission without view-attendees). The ref is
  // what the scan path reads; the state drives the UI.
  const [accessMode, setAccessMode] = useState<AccessMode | null>(null);
  const accessModeRef = useRef<AccessMode | null>(null);
  const doorRowsRef = useRef<DoorRow[] | null>(null);
  const doorListAtRef = useRef<string>('');
  const [pendingSync, setPendingSync] = useState(0);
  const uid = auth.currentUser?.uid || '';

  useEffect(() => {
    if (permission && !permission.granted) {
      requestPermission();
    }
  }, [permission]);

  // Per-device door preferences (a convenience — nothing depends on them).
  useEffect(() => {
    AsyncStorage.getItem(PREFS_KEY)
      .then((raw) => {
        if (!raw) return;
        const p = JSON.parse(raw);
        if (typeof p.doorMode === 'boolean') setDoorMode(p.doorMode);
        if (typeof p.hapticsOn === 'boolean') setHapticsOn(p.hapticsOn);
        if (ENTRY_POINTS.some((e) => e.value === p.entryPoint)) setEntryPoint(p.entryPoint);
      })
      .catch(() => {})
      // An explicit "Door mode" from the Scan screen wins over the saved pref.
      .finally(() => {
        if (startInDoorMode) setDoorMode(true);
      });
  }, []);

  useEffect(() => {
    if (openLookup) setShowLookup(true);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(PREFS_KEY, JSON.stringify({ doorMode, hapticsOn, entryPoint })).catch(() => {});
  }, [doorMode, hapticsOn, entryPoint]);

  // Event title for the header + whether re-entry is allowed (web reads
  // events.allow_reentry the same way). Cache-served when offline.
  useEffect(() => {
    getDoc(doc(db, 'events', eventId))
      .then((snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as any;
        setEventTitle(String(data?.title || ''));
        eventMetaRef.current = { allowReentry: Boolean(data?.allow_reentry) };
      })
      .catch(() => {});
  }, [eventId]);

  // Pre-warm the whole guest list for this event on mount. This pulls every
  // ticket into Firestore's in-session cache so a QR can still be validated
  // after connectivity drops, and mirrors a lightweight manifest into
  // AsyncStorage so attendee name/tier still render even on a cache miss.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Door-only staff never attempt the tickets read: rules would refuse it.
      const mode = await resolveAccessMode();
      if (cancelled) return;
      if (mode === 'door') {
        enterDoorMode();
        await loadDoorList({ isCancelled: () => cancelled });
        return;
      }
      setMode('full');
      // Check-ins this device queued offline on an earlier visit read as
      // "already in" until they sync, same as on the door list.
      if (uid) {
        const queued = (await readCheckInQueue(uid)).filter((q) => q.eventId === eventId);
        for (const q of queued) admittedRef.current.add(q.ticketId);
        if (!cancelled) setPendingSync(queued.length);
      }
      if (cancelled) return;
      try {
        const snap = await getDocs(query(collection(db, 'tickets'), where('event_id', '==', eventId)));
        if (cancelled) return;
        const manifest: Record<
          string,
          { name: string; tier: string; status: string; checkedIn: boolean; qrVersion: number; code: string }
        > = {};
        const list: DoorGuest[] = [];
        snap.forEach((d) => {
          const x = d.data() as any;
          // Do NOT persist attendee email (or any other PII beyond what the
          // scanner needs to validate/display). Fall back to a generic label
          // rather than caching the email address on disk.
          manifest[d.id] = {
            name: x.attendee_name || x.user_name || x.userName || '',
            tier: x.tier_name || x.ticket_tier_name || x.ticket_type || x.ticketType || x.tierName || '',
            status: x.status || 'active',
            checkedIn: !!x.checked_in_at || x.checked_in === true,
            // The ticket's CURRENT code and QR version, so a code from before
            // a transfer reads as transferred even when judged offline.
            qrVersion: ticketQrVersionOf(x),
            code: String(x.qr_code || x.qr_code_data || d.id),
          };
          // The in-memory lookup list may carry the email so staff can search
          // by it; it is dropped with the screen and never written to disk.
          if (admittedRef.current.has(d.id)) manifest[d.id].checkedIn = true;
          list.push({
            ticketId: d.id,
            name: manifest[d.id].name,
            email: String(x.attendee_email || x.user_email || x.guest_email || ''),
            tier: manifest[d.id].tier,
            checkedIn: manifest[d.id].checkedIn,
            live: isLiveStatus(x.status),
          });
        });
        setOfflineReady(snap.size);
        setIsOffline(snap.metadata.fromCache);
        setGuests(list);
        setListUnavailable(false);
        await AsyncStorage.setItem(`scanner_manifest_${eventId}`, JSON.stringify(manifest));
        syncQueue();
      } catch (e: any) {
        // Rules refused the read (e.g. an admin, or a member doc we could not
        // read): this user is door-only here. Switch to the server door list.
        if (e?.code === 'permission-denied') {
          if (cancelled) return;
          enterDoorMode();
          await loadDoorList({ isCancelled: () => cancelled });
          return;
        }
        // No connectivity and nothing cached yet — fall back to any manifest we
        // stored on a previous (online) visit so offline validation still works.
        try {
          const raw = await AsyncStorage.getItem(`scanner_manifest_${eventId}`);
          if (!cancelled && raw) {
            const manifest = JSON.parse(raw) as Record<string, { name: string; tier: string; status: string; checkedIn: boolean }>;
            setOfflineReady(Object.keys(manifest).length);
            setIsOffline(true);
            setGuests(
              Object.entries(manifest).map(([id, m]) => ({
                ticketId: id,
                name: m.name || '',
                email: '',
                tier: m.tier || '',
                checkedIn: !!m.checkedIn || admittedRef.current.has(id),
                live: isLiveStatus(m.status),
              })),
            );
          } else if (!cancelled) {
            setListUnavailable(true);
            setGuests([]);
          }
        } catch {
          if (!cancelled) {
            setListUnavailable(true);
            setGuests([]);
          }
        }
      }
    })();
    // The saved manifest and door list are KEPT on unmount (keyed by event, and
    // holding name/tier only, never email): they exist so that reopening the
    // scanner with no signal can still validate. Deleting them here meant the
    // offline fallback never had anything to read. Each is overwritten by the
    // next online load.
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // Replay queued check-ins while the screen is open (every access mode now
  // commits through the server, so every mode can have a queue). Every 15s try
  // the queue; in door mode, once a minute (or right after a sync) also pull a
  // fresh list so check-ins made at other doors show as "already in".
  useEffect(() => {
    if (!accessMode || !uid) return;
    let ticks = 0;
    const timer = setInterval(async () => {
      ticks += 1;
      const report = await syncQueue();
      if (accessMode !== 'door') return;
      if ((report && report.synced + report.conflicts.length > 0 && report.remaining === 0) || ticks % 4 === 0) {
        await loadDoorList({ silent: true });
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [accessMode, uid, eventId]);

  const feedback = useCallback(
    (outcome: ScanOutcome) => {
      if (hapticsOn) scanOutcomeFeedback(outcome);
    },
    [hapticsOn],
  );

  const recordScan = (name: string | undefined, outcome: ScanOutcome, label: string) => {
    setRecentScans((prev) =>
      [
        { key: `${Date.now()}-${Math.random()}`, name: name || t('common.attendee'), outcome, label, at: new Date() },
        ...prev,
      ].slice(0, 20),
    );
  };

  // Tickets this device admitted (or queued) this session. The full-access
  // path validates from Firestore, whose offline cache does not see a check-in
  // made through the server API, so a re-scan consults this set too.
  const admittedRef = useRef<Set<string>>(new Set());

  const markGuestCheckedIn = (ticketId: string) => {
    admittedRef.current.add(ticketId);
    setGuests((prev) =>
      prev ? prev.map((g) => (g.ticketId === ticketId ? { ...g, checkedIn: true } : g)) : prev,
    );
    if (doorRowsRef.current) {
      doorRowsRef.current = markRowCheckedIn(doorRowsRef.current, ticketId);
      persistDoorList();
    }
  };

  // ---------------------------------------------------------------------------
  // Door-only access (check-in permission, no view-attendees permission)
  // ---------------------------------------------------------------------------

  const offlineRef = useRef(false);
  useEffect(() => {
    offlineRef.current = isOffline;
  }, [isOffline]);

  const setMode = (m: AccessMode) => {
    accessModeRef.current = m;
    setAccessMode(m);
  };
  const enterDoorMode = () => setMode('door');

  /**
   * The member doc is readable by its own user, so the scanner can tell up
   * front whether this person may read tickets. Organizer, owner role or
   * viewAttendees === true keeps the Firestore path; check-in-only staff use
   * the door list. Anything unreadable starts on the Firestore path, which
   * drops to the door list if rules deny the read.
   */
  const resolveAccessMode = async (): Promise<AccessMode> => {
    if (!uid) return 'full';
    try {
      const eventSnap = await getDoc(doc(db, 'events', eventId));
      const ev = eventSnap.exists() ? (eventSnap.data() as any) : null;
      if (ev && (ev.organizer_id === uid || ev.organizerId === uid)) return 'full';
      const memberSnap = await getDoc(doc(db, 'events', eventId, 'members', uid));
      if (!memberSnap.exists()) return 'full';
      const m = memberSnap.data() as any;
      if (m?.role === 'owner') return 'full';
      return m?.permissions?.viewAttendees === true ? 'full' : 'door';
    } catch {
      return 'full';
    }
  };

  const eventTitleRef = useRef('');
  useEffect(() => {
    eventTitleRef.current = eventTitle;
  }, [eventTitle]);

  const persistDoorList = () => {
    const rows = doorRowsRef.current;
    if (!rows) return;
    saveDoorList(eventId, {
      event: { id: eventId, title: eventTitleRef.current, allowReentry: eventMetaRef.current.allowReentry },
      rows,
      generatedAt: doorListAtRef.current || new Date().toISOString(),
    });
  };

  const applyDoorList = (payload: DoorListPayload, fromCache: boolean) => {
    doorRowsRef.current = payload.rows;
    doorListAtRef.current = payload.generatedAt;
    eventMetaRef.current = { allowReentry: payload.event.allowReentry };
    if (payload.event.title) setEventTitle(payload.event.title);
    // Name and tier only: the door list carries no email to search by.
    setGuests(
      payload.rows.map((r) => ({
        ticketId: r.id,
        name: r.name,
        email: '',
        tier: r.tier,
        checkedIn: r.checkedIn,
        live: r.live,
      })),
    );
    setOfflineReady(payload.rows.length);
    setListUnavailable(false);
    setIsOffline(fromCache);
  };

  const loadDoorList = async (opts: { silent?: boolean; isCancelled?: () => boolean } = {}) => {
    try {
      const payload = await fetchDoorList(eventId);
      if (opts.isCancelled?.()) return;
      // A fresh list does not know about check-ins still sitting in this
      // device's queue. Keep those guests "in" so a re-scan is not re-admitted.
      let rows = payload.rows;
      if (uid) {
        const queued = (await readCheckInQueue(uid)).filter((q) => q.eventId === eventId);
        for (const q of queued) rows = markRowCheckedIn(rows, q.ticketId);
      }
      applyDoorList({ ...payload, rows }, false);
      persistDoorList();
    } catch (e) {
      if (opts.isCancelled?.()) return;
      if (e instanceof DoorAccessError) {
        if (!opts.silent) {
          setListUnavailable(true);
          setGuests([]);
        }
      } else if (opts.silent) {
        setIsOffline(true);
      } else {
        const cached = await loadCachedDoorList(eventId);
        if (opts.isCancelled?.()) return;
        if (cached) {
          applyDoorList(cached, true);
        } else {
          setIsOffline(true);
          setListUnavailable(true);
          setGuests([]);
        }
      }
    }
    if (uid) setPendingSync(await pendingCount(uid, eventId));
    if (!opts.silent) syncQueue();
  };

  const syncingRef = useRef(false);
  const syncQueue = async () => {
    if (!uid || syncingRef.current) return null;
    syncingRef.current = true;
    try {
      if ((await pendingCount(uid, eventId)) === 0) {
        setPendingSync(0);
        return null;
      }
      const report = await flushCheckInQueue(uid, eventId);
      setPendingSync(report.remaining);
      if (report.synced + report.conflicts.length > 0) setIsOffline(report.remaining > 0);
      // A guest admitted here offline but refused when it synced (already in at
      // another door, refunded meanwhile) shows in the recent list.
      for (const c of report.conflicts) {
        const elsewhere = c.verdict === 'ALREADY_CHECKED_IN';
        recordScan(
          c.item.name,
          elsewhere ? 'warning' : 'invalid',
          elsewhere ? t('doorScanner.sync.alreadyInElsewhere') : t('doorScanner.sync.refusedOnSync'),
        );
      }
      return report;
    } catch {
      return null;
    } finally {
      syncingRef.current = false;
    }
  };

  const doorVerdictToResult = (row: DoorRow | null, verdict: DoorVerdict, method: CheckInMethod): ScanResult => {
    const attendeeName = row?.name || t('common.attendee');
    const tierName = row?.tier || t('common.generalAdmission');
    switch (verdict) {
      case 'NOT_FOUND':
        return { status: 'NOT_FOUND', message: t('doorScanner.door.notOnList') };
      case 'WRONG_EVENT':
        return { status: 'WRONG_EVENT', message: t('organizerTicketScanner.results.wrongEvent') };
      case 'EXPIRED':
        return { status: 'EXPIRED', attendeeName, tierName, message: t('organizerTicketScanner.results.expired') };
      case 'CANCELLED':
        return {
          status: 'CANCELLED',
          attendeeName,
          tierName,
          message: isRefundHeldRow(row)
            ? t('organizerTicketScanner.results.refundInProgress')
            : t('organizerTicketScanner.results.cancelled'),
        };
      // Distinct from "already in": the person holding this code is not the
      // ticket's holder any more, so no name is shown.
      case 'TRANSFERRED':
        return { status: 'CANCELLED', message: t('organizerTicketScanner.results.transferredCode') };
      case 'INVALID_CODE':
        return { status: 'NOT_FOUND', message: t('organizerTicketScanner.results.invalidCode') };
      case 'ALREADY_CHECKED_IN': {
        const at = row?.checkedInAt ? new Date(row.checkedInAt) : undefined;
        const checkedInTime = at && !isNaN(at.getTime()) ? at : undefined;
        return {
          status: 'ALREADY_CHECKED_IN',
          attendeeName,
          tierName,
          ticketId: row?.id,
          method,
          checkedInTime,
          message: checkedInTime
            ? `${t('organizerTicketScanner.results.alreadyCheckedInAtPrefix')}${checkedInTime.toLocaleString(locale)}`
            : t('organizerTicketScanner.results.alreadyCheckedIn'),
        };
      }
      case 'OUTSIDE_WINDOW':
        return {
          status: 'VALID',
          attendeeName,
          tierName,
          ticketId: row?.id,
          method,
          validityBlock:
            computeTierValidityBlock({ valid_from: row?.validFrom, valid_until: row?.validUntil }, locale, t) ||
            t('organizerCreateEventFlow.canvas.ticketExpired'),
        };
      default:
        return { status: 'VALID', attendeeName, tierName, ticketId: row?.id, method };
    }
  };

  /** Door-mode twin of validateTicket: judged against the door list (works offline). */
  const validateFromDoorList = async (scanned: string, method: CheckInMethod, code?: string): Promise<ScanResult> => {
    let row = doorRowsRef.current ? findDoorRow(doorRowsRef.current, scanned) : null;
    // Not on the list yet (bought after it loaded): refresh once while online.
    if (!row && !offlineRef.current) {
      await loadDoorList({ silent: true });
      row = doorRowsRef.current ? findDoorRow(doorRowsRef.current, scanned) : null;
    }
    if (!doorRowsRef.current) {
      return { status: 'ERROR', message: t('organizerTicketScanner.results.offlineNotCached') };
    }
    const codeCheck = row && method === 'scan' && code ? judgeScannedCodeAgainstRow(code, row) : undefined;
    const { verdict } = judgeDoorRow(row, { allowReentry: eventMetaRef.current.allowReentry, codeCheck });
    return doorVerdictToResult(row, verdict, method);
  };

  /**
   * Server commit (every access mode): the server re-judges inside a transaction. If the server
   * cannot be reached, the check-in is queued on the device (and marked in
   * locally so a re-scan reads "already in"), then synced when back online.
   */
  const commitDoorCheckIn = async (
    ticketId: string,
    method: CheckInMethod,
    opts: { reentry?: boolean; override?: boolean; code?: string },
  ): Promise<CommitOutcome> => {
    const body = {
      ticketId,
      // The raw scanned code, so the server judges its QR version. A manual
      // pick by name has none.
      code: method === 'scan' && opts.code ? opts.code : null,
      method,
      // The entry point is only chosen in door mode, so only door mode records it.
      entryPoint: doorMode ? entryPoint : null,
      reentry: Boolean(opts.reentry),
      override: Boolean(opts.override),
    };
    try {
      const res = await postCheckIn(eventId, body);
      setIsOffline(false);
      if (res.verdict === 'CHECKED_IN' || (res.verdict === 'ALREADY_CHECKED_IN' && res.mine)) {
        markGuestCheckedIn(ticketId);
        return { synced: true };
      }
      // Refused on the server's re-check (another door got there first, or the
      // list was stale). The server's row is the truth.
      if (res.row) {
        const fresh = res.row;
        if (doorRowsRef.current) {
          doorRowsRef.current = doorRowsRef.current.map((r) => (r.id === fresh.id ? fresh : r));
        }
        if (fresh.checkedIn) markGuestCheckedIn(fresh.id);
      }
      return { synced: true, refused: doorVerdictToResult(res.row, res.verdict, method) };
    } catch (e) {
      if (e instanceof DoorAccessError) throw new Error(t('doorScanner.door.noAccess'));
      const name = doorRowsRef.current?.find((r) => r.id === ticketId)?.name || '';
      const count = uid ? await queueCheckIn(uid, { eventId, name, ...body }) : 0;
      setPendingSync(count);
      setIsOffline(true);
      markGuestCheckedIn(ticketId);
      return { synced: false };
    }
  };

  /**
   * Read and judge one ticket. The ONE validation path: the camera and the
   * manual lookup both come through here, so a hand-picked guest gets exactly
   * the checks a scanned QR gets (event, expiry, duplicate, status, entry
   * window). Offline this is served from the cache warmed on mount.
   */
  const validateTicket = async (ticketId: string, method: CheckInMethod, code?: string): Promise<ScanResult> => {
    if (accessModeRef.current === 'door') return validateFromDoorList(ticketId, method, code);
    try {
      // Get ticket from Firestore. Offline this is served from the in-session
      // cache warmed on mount; `fromCache` tells us we're offline so the banner
      // and check-in flow can adapt.
      const ticketRef = doc(db, 'tickets', ticketId);
      const ticketSnap = await getDoc(ticketRef);
      setIsOffline(ticketSnap.metadata.fromCache);

      if (!ticketSnap.exists()) {
        return {
          status: 'NOT_FOUND',
          message: t('organizerTicketScanner.results.notFound'),
        };
      }

      const ticketData = ticketSnap.data();

      const attendeeName =
        ticketData.attendee_name ||
        ticketData.user_name ||
        ticketData.userName ||
        ticketData.user_email ||
        t('common.attendee');

      let tierName =
        ticketData.tier_name ||
        ticketData.ticket_tier_name ||
        ticketData.ticket_type ||
        ticketData.ticketType ||
        ticketData.tierName ||
        '';

      const tierId = ticketData.ticket_tier_id || ticketData.tier_id || ticketData.ticketTierId;
      if (!tierName && typeof tierId === 'string' && tierId.length > 0) {
        try {
          const tierSnap = await getDoc(doc(db, 'ticket_tiers', tierId));
          if (tierSnap.exists()) {
            const tierData = tierSnap.data() as any;
            tierName = tierData?.name || tierName;
          }
        } catch (e) {
          console.warn('Failed to resolve tier from ticket_tiers:', e);
        }
      }

      if (!tierName) {
        tierName = t('common.generalAdmission');
      }

      // Verify ticket belongs to this event
      if (ticketData.event_id !== eventId) {
        return {
          status: 'WRONG_EVENT',
          message: t('organizerTicketScanner.results.wrongEvent'),
        };
      }

      // The scanned code against the ticket's CURRENT code: once a ticket has
      // changed hands, a code from before the transfer never admits. Judged
      // before "already in" so it reads as transferred, not as a duplicate.
      if (method === 'scan' && code) {
        const codeCheck = judgeScannedCodeAgainstRow(code, {
          id: ticketSnap.id,
          code: String(ticketData.qr_code || ticketData.qr_code_data || ticketSnap.id),
          qrVersion: ticketQrVersionOf(ticketData),
        });
        if (codeCheck !== 'OK') return doorVerdictToResult(null, codeCheck, method);
      }

      // Check if event has ended (ticket expired)
      const now = new Date();
      const eventEnd = new Date(ticketData.end_datetime || ticketData.event_date || ticketData.start_datetime);
      if (now > eventEnd) {
        return {
          status: 'EXPIRED',
          attendeeName,
          tierName,
          message: t('organizerTicketScanner.results.expired'),
        };
      }

      // Check if already checked in. Offline, a pending serverTimestamp() write
      // reads back as null, so checked_in_at can be missing on a ticket that was
      // just checked in on this device — treat the boolean checked_in === true as
      // authoritative too, otherwise the same QR would admit the guest twice.
      if (ticketData.checked_in_at || ticketData.checked_in === true || admittedRef.current.has(ticketId)) {
        const checkedInTime = ticketData.checked_in_at
          ? (ticketData.checked_in_at.toDate
              ? ticketData.checked_in_at.toDate()
              : new Date(ticketData.checked_in_at))
          : undefined;

        return {
          status: 'ALREADY_CHECKED_IN',
          attendeeName,
          tierName,
          ticketId,
          method,
          checkedInTime,
          message: checkedInTime
            ? `${t('organizerTicketScanner.results.alreadyCheckedInAtPrefix')}${checkedInTime.toLocaleString(locale)}`
            : t('organizerTicketScanner.results.alreadyCheckedIn'),
        };
      }

      // Check ticket status. Only genuinely sellable/valid tickets may proceed to
      // check-in. Legacy tickets predate the status field, so a missing/empty
      // status is allowed; anything else (refunded, revoked, void, cancelled, …)
      // is blocked so the scanner can't admit a refunded or voided ticket.
      if (!isLiveStatus(ticketData.status)) {
        return {
          status: 'CANCELLED',
          attendeeName,
          tierName,
          message: t('organizerTicketScanner.results.cancelled'),
        };
      }

      // HARD validity-window check. Resolve the tier PREFERRING ticket.tier_id
      // (match the event's embedded ticket_tiers or fetch ticket_tiers/{id}),
      // falling back to a name match for older tickets. If `now` is outside the
      // tier's entry window this becomes a hard block (staff can still override).
      let validityBlock: string | undefined;
      try {
        const eventSnap = await getDoc(doc(db, 'events', eventId));
        const eventTiers = eventSnap.exists() ? (eventSnap.data()?.ticket_tiers || []) : [];
        const rawTierName =
          ticketData.tier_name ||
          ticketData.ticket_tier_name ||
          ticketData.ticket_type ||
          ticketData.ticketType ||
          ticketData.tierName ||
          tierName;
        const resolvedTier = await resolveTicketTier(eventTiers, tierId, rawTierName);
        validityBlock = computeTierValidityBlock(resolvedTier, locale, t);
      } catch (e) {
        console.warn('Failed to resolve tier validity window:', e);
      }

      // Valid ticket - ready to check in. When validityBlock is set, the sheet
      // hard-blocks the default confirm and only admits via an explicit override.
      return {
        status: 'VALID',
        attendeeName,
        tierName,
        ticketId,
        validityBlock,
        method,
      };
    } catch (error: any) {
      // Rules refused this ticket read: this user is door-only here.
      if (error?.code === 'permission-denied') {
        enterDoorMode();
        await loadDoorList();
        return validateFromDoorList(ticketId, method, code);
      }
      console.error('Error checking in ticket:', error);
      // 'unavailable' = offline and this ticket wasn't in the pre-loaded cache
      // (e.g. app relaunched with no signal). Guide staff to reconnect once.
      const offlineMiss = error?.code === 'unavailable';
      if (offlineMiss) setIsOffline(true);
      return {
        status: 'ERROR',
        message: offlineMiss
          ? t('organizerTicketScanner.results.offlineNotCached')
          : error.message || t('organizerTicketScanner.results.scanFailed'),
      };
    }
  };

  /**
   * Write the check-in. Every access mode goes through the server's check-in
   * API (POST /api/staff/events/:id/check-in), which re-judges the ticket and
   * writes inside a Firestore transaction, so two devices can never both admit
   * the same ticket. A direct client check-then-write could not guarantee that.
   * When the server cannot be reached the check-in is queued on the device and
   * replayed on reconnect (see commitDoorCheckIn / syncQueue).
   */
  const commitCheckIn = async (
    ticketId: string,
    method: CheckInMethod,
    opts: { reentry?: boolean; override?: boolean; code?: string } = {},
  ): Promise<CommitOutcome> => commitDoorCheckIn(ticketId, method, opts);

  const entryLabel = (value: string) => {
    const match = ENTRY_POINTS.find((e) => e.value === value);
    return match ? t(match.labelKey) : value;
  };

  const toDoorResult = (r: ScanResult): DoorResult => {
    if (r.status === 'ALREADY_CHECKED_IN') {
      return {
        outcome: 'warning',
        headline: t('doorScanner.result.alreadyIn'),
        name: r.attendeeName,
        tier: r.tierName,
        detail: r.message,
        allowReentry: eventMetaRef.current.allowReentry && !!r.ticketId,
      };
    }
    return {
      outcome: 'invalid',
      headline: t('doorScanner.result.invalid'),
      name: r.attendeeName,
      tier: r.tierName,
      detail: r.message,
    };
  };

  const admitInDoorMode = async (r: ScanResult, opts: { reentry?: boolean } = {}) => {
    if (!r.ticketId) return;
    const method = r.method ?? 'scan';
    try {
      const { synced, refused } = await commitCheckIn(r.ticketId, method, { ...opts, code: r.code });
      if (refused) {
        feedback(outcomeOf(refused));
        recordScan(refused.attendeeName || r.attendeeName, outcomeOf(refused), recentLabelOf(refused));
        setDoorResult(toDoorResult(refused));
        return;
      }
      feedback('valid');
      recordScan(r.attendeeName, 'valid', t('doorScanner.recent.admitted'));
      setDoorResult({
        outcome: 'valid',
        headline: t('doorScanner.result.valid'),
        name: r.attendeeName,
        tier: r.tierName,
        detail: synced
          ? t('doorScanner.result.checkedInNow')
          : t('organizerTicketScanner.results.checkInQueued'),
        entryPoint: entryLabel(entryPoint),
      });
    } catch (error: any) {
      console.error('Error checking in ticket:', error);
      feedback('invalid');
      recordScan(r.attendeeName, 'invalid', t('doorScanner.recent.failed'));
      setDoorResult({
        outcome: 'invalid',
        headline: t('doorScanner.result.invalid'),
        name: r.attendeeName,
        detail: error?.message || t('organizerTicketScanner.results.checkInFailed'),
      });
    }
  };

  const outcomeOf = (r: ScanResult): ScanOutcome =>
    r.status === 'ALREADY_CHECKED_IN' ? 'warning' : r.status === 'VALID' || r.status === 'CHECKED_IN' ? 'valid' : 'invalid';

  const recentLabelOf = (r: ScanResult): string =>
    r.status === 'ALREADY_CHECKED_IN'
      ? t('doorScanner.recent.alreadyIn')
      : t('doorScanner.recent.refused');

  /** Shared by the camera and the manual lookup. */
  const runScan = async (ticketId: string, method: CheckInMethod, code?: string) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);
    lastScanRef.current = { id: ticketId, at: Date.now() };

    const result = await validateTicket(ticketId, method, code);
    if (code) result.code = code;

    if (doorMode) {
      if (result.status === 'VALID' && !result.validityBlock) {
        doorTicketRef.current = { ticketId, method, name: result.attendeeName, tier: result.tierName, code };
        await admitInDoorMode(result);
        return;
      }
      if (result.status !== 'VALID') {
        doorTicketRef.current = { ticketId, method, name: result.attendeeName, tier: result.tierName, code };
        feedback(outcomeOf(result));
        recordScan(result.attendeeName, outcomeOf(result), recentLabelOf(result));
        setDoorResult(toDoorResult(result));
        return;
      }
      // Outside its entry window: never auto-admitted. Falls through to the
      // sheet, where the confirm is disabled and only the override admits.
    }

    if (result.status !== 'VALID') {
      feedback(outcomeOf(result));
      recordScan(result.attendeeName, outcomeOf(result), recentLabelOf(result));
    } else if (result.validityBlock) {
      feedback('invalid');
    }
    setScanResult(result);
  };

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    // Prevent multiple scans
    if (processingRef.current || isProcessing) return;

    const ticketId = parseTicketId(data) ?? data;
    const last = lastScanRef.current;
    if (last.id === ticketId && Date.now() - last.at < DUPLICATE_WINDOW_MS) return;

    if (hapticsOn) scanReadFeedback();
    await runScan(ticketId, 'scan', String(data ?? ''));
  };

  const handleManualSelect = (ticketId: string) => {
    // The sheet closes first; give its slide-out a beat so the verdict (sheet
    // or door overlay) doesn't collide with it.
    setTimeout(() => {
      runScan(ticketId, 'manual');
    }, 350);
  };

  /** The server's re-check refused a check-in the sheet offered: show why. */
  const showRefused = (refused: ScanResult) => {
    feedback(outcomeOf(refused));
    recordScan(refused.attendeeName, outcomeOf(refused), recentLabelOf(refused));
    setScanResult(refused);
  };

  const handleConfirmCheckIn = async () => {
    if (!scanResult || scanResult.status !== 'VALID' || !scanResult.ticketId) return;

    try {
      const { synced, refused } = await commitCheckIn(scanResult.ticketId, scanResult.method ?? 'scan', {
        // The override button shares this handler. Outside the entry window it
        // is the only way in, and the server must be told it was deliberate.
        override: Boolean(scanResult.validityBlock),
        code: scanResult.code,
      });
      if (refused) {
        showRefused(refused);
        return;
      }
      feedback('valid');
      recordScan(scanResult.attendeeName, 'valid', t('doorScanner.recent.admitted'));

      // Show success state briefly ("checked in" when synced, "will sync" offline)
      setScanResult({
        ...scanResult,
        status: 'CHECKED_IN',
        message: synced
          ? t('organizerTicketScanner.results.checkInSuccessful')
          : t('organizerTicketScanner.results.checkInQueued'),
      });

      // Auto-close after 1.5 seconds (cancelled if staff close it first, so a
      // stale timer can never close the NEXT guest's sheet).
      scheduleSheetClose();
    } catch (error: any) {
      console.error('Error checking in ticket:', error);
      feedback('invalid');
      setScanResult({
        status: 'ERROR',
        message: error.message || t('organizerTicketScanner.results.checkInFailed'),
      });
    }
  };

  const handleAllowReentrySheet = async () => {
    if (!scanResult?.ticketId) return;
    try {
      const { synced, refused } = await commitCheckIn(scanResult.ticketId, scanResult.method ?? 'scan', {
        reentry: true,
        code: scanResult.code,
      });
      if (refused) {
        showRefused(refused);
        return;
      }
      feedback('valid');
      recordScan(scanResult.attendeeName, 'valid', t('doorScanner.recent.reentry'));
      setScanResult({
        ...scanResult,
        status: 'CHECKED_IN',
        message: synced
          ? t('organizerTicketScanner.results.checkInSuccessful')
          : t('organizerTicketScanner.results.checkInQueued'),
      });
      scheduleSheetClose();
    } catch (error: any) {
      feedback('invalid');
      setScanResult({
        status: 'ERROR',
        message: error.message || t('organizerTicketScanner.results.checkInFailed'),
      });
    }
  };

  const handleAllowReentryDoor = async () => {
    const target = doorTicketRef.current;
    if (!target) return;
    setDoorResult(null);
    await admitInDoorMode(
      {
        status: 'VALID',
        ticketId: target.ticketId,
        method: target.method,
        attendeeName: target.name,
        tierName: target.tier,
        code: target.code,
      },
      { reentry: true },
    );
  };

  const releaseScanner = () => {
    lastScanRef.current = { ...lastScanRef.current, at: Date.now() };
    processingRef.current = false;
    setIsProcessing(false);
  };

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSheetClose = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => handleCloseSheet(), 1500);
  };

  const handleCloseSheet = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setScanResult(null);
    releaseScanner();
  };

  const handleDismissDoor = () => {
    setDoorResult(null);
    doorTicketRef.current = null;
    releaseScanner();
  };

  // Door counters — live tickets only, so a refund doesn't inflate "remaining".
  const counts = useMemo(() => {
    if (!guests) return null;
    const live = guests.filter((g) => g.live);
    const checkedIn = live.filter((g) => g.checkedIn).length;
    return { total: live.length, checkedIn, remaining: live.length - checkedIn };
  }, [guests]);

  const sheetTone =
    scanResult?.status === 'VALID'
      ? scanResult?.validityBlock
        ? T.red
        : T.emerald
      : scanResult?.status === 'CHECKED_IN'
        ? T.emerald
        : scanResult?.status === 'ALREADY_CHECKED_IN'
          ? T.amber
          : T.red;

  const sheetIcon =
    scanResult?.status === 'CHECKED_IN' || (scanResult?.status === 'VALID' && !scanResult?.validityBlock)
      ? 'checkmark-circle'
      : scanResult?.status === 'ALREADY_CHECKED_IN'
        ? 'warning'
        : 'alert-circle';

  if (!permission) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>{t('organizerTicketScanner.permissions.requesting')}</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <EmptyState
          icon={Camera}
          title={t('organizerTicketScanner.permissions.required')}
          actionLabel={t('organizerTicketScanner.permissions.grant')}
          onAction={requestPermission}
        />
      </View>
    );
  }

  const statusOfOutcome = (o: ScanOutcome) => (o === 'valid' ? 'success' : o === 'warning' ? 'pending' : 'error');
  const blocked = isProcessing || showLookup || doorResult !== null || scanResult !== null;

  return (
    <View style={styles.container}>
      <View style={styles.cameraSection}>
        <CameraView
          style={styles.camera}
          facing="back"
          enableTorch={flashOn}
          onBarcodeScanned={blocked ? undefined : handleBarCodeScanned}
          barcodeScannerSettings={{
            barcodeTypes: ['qr'],
          }}
        >
          <View style={styles.overlay}>
            {/* Scanning frame */}
            <View style={styles.scanFrame}>
              <View style={[styles.corner, styles.cornerTopLeft]} />
              <View style={[styles.corner, styles.cornerTopRight]} />
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              <View style={[styles.corner, styles.cornerBottomRight]} />
            </View>

            {/* Door mode wears its state on the viewfinder: a live dot + the
                entry point, so the phone on the stand says where it is. */}
            {doorMode && (
              <View style={[styles.doorBadge, { top: insets.top + 12 }]}>
                <View style={styles.doorBadgeDot} />
                <Text style={styles.doorBadgeText} numberOfLines={1}>
                  {t('doorScanner.doorMode')} · {entryLabel(entryPoint)}
                </Text>
              </View>
            )}

            {/* Instructions */}
            <View style={styles.instructionContainer}>
              <Text style={styles.instruction}>
                {isProcessing
                  ? t('organizerTicketScanner.instructions.processing')
                  : t('organizerTicketScanner.instructions.positionQr')}
              </Text>
            </View>
          </View>
        </CameraView>
      </View>

      <View style={[styles.bottomChrome, { paddingBottom: insets.bottom }]}>
        {/* Header below camera */}
        <View style={styles.belowHeader}>
          <TouchableOpacity
            style={styles.belowHeaderButton}
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <Ionicons name="close" size={26} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.belowHeaderTitleWrap}>
            <Text style={styles.belowHeaderTitle} numberOfLines={1}>{t('organizerTicketScanner.headerTitle')}</Text>
            {!!eventTitle && <Text style={styles.belowHeaderSubtitle} numberOfLines={1}>{eventTitle}</Text>}
          </View>
          <TouchableOpacity
            style={styles.belowHeaderButton}
            onPress={() => setHapticsOn((v) => !v)}
            accessibilityRole="switch"
            accessibilityState={{ checked: hapticsOn }}
            accessibilityLabel={t('doorScanner.haptics')}
          >
            {hapticsOn ? (
              <Vibrate size={20} color={colors.text} />
            ) : (
              <VibrateOff size={20} color={colors.textTertiary} />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.belowHeaderButton}
            onPress={() => setFlashOn(!flashOn)}
            accessibilityRole="switch"
            accessibilityState={{ checked: flashOn }}
          >
            <Ionicons name={flashOn ? 'flash' : 'flash-off'} size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Tools: manual lookup + door mode. */}
        <View style={styles.toolsRow}>
          <TouchableOpacity
            style={[styles.tool, styles.toolGrow]}
            onPress={() => setShowLookup(true)}
            accessibilityRole="button"
            disabled={isProcessing}
          >
            <Search size={18} color={colors.text} />
            <Text style={styles.toolText} numberOfLines={1}>{t('doorScanner.manualLookup')}</Text>
          </TouchableOpacity>
          <View style={styles.tool}>
            <DoorOpen size={18} color={doorMode ? T.accent : colors.textSecondary} />
            <Text style={styles.toolText} numberOfLines={1}>{t('doorScanner.doorMode')}</Text>
            <Switch
              value={doorMode}
              onValueChange={setDoorMode}
              trackColor={{ false: T.border, true: T.accent }}
              thumbColor={T.white}
              ios_backgroundColor={T.border}
              accessibilityLabel={t('doorScanner.doorMode')}
              style={styles.toolSwitch}
            />
          </View>
        </View>

        {doorMode && (
          <View style={styles.doorPanel}>
            <StatTriplet
              items={[
                {
                  label: t('doorScanner.counters.checkedIn'),
                  value: counts ? counts.checkedIn : listUnavailable ? '—' : null,
                  tone: 'emerald',
                },
                {
                  label: t('doorScanner.counters.remaining'),
                  value: counts ? counts.remaining : listUnavailable ? '—' : null,
                },
                {
                  label: t('doorScanner.counters.total'),
                  value: counts ? counts.total : listUnavailable ? '—' : null,
                },
              ]}
            />

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.entryRow}
            >
              {ENTRY_POINTS.map((e) => {
                const active = e.value === entryPoint;
                return (
                  <TouchableOpacity
                    key={e.value}
                    style={[styles.entryChip, active && styles.entryChipActive]}
                    onPress={() => setEntryPoint(e.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.entryChipText, active && styles.entryChipTextActive]}>
                      {t(e.labelKey)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.recentCard}>
              <Text style={styles.recentTitle}>{t('doorScanner.recent.title')}</Text>
              {recentScans.length === 0 ? (
                <Text style={styles.recentEmpty}>{t('doorScanner.recent.empty')}</Text>
              ) : (
                recentScans.slice(0, 3).map((r) => (
                  <View key={r.key} style={styles.recentRow}>
                    <Text style={styles.recentName} numberOfLines={1}>{r.name}</Text>
                    <StatusChip status={statusOfOutcome(r.outcome)} label={r.label} />
                    <Text style={styles.recentTime}>
                      {r.at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </View>
        )}

        {/* Connectivity / offline-readiness strip. Red when offline (scans queue
            and sync on reconnect); neutral once the guest list is cached. */}
        {(isOffline || offlineReady !== null) && (
          <View style={[styles.statusStrip, isOffline && styles.statusStripOffline]}>
            <Ionicons
              name={isOffline ? 'cloud-offline-outline' : 'cloud-done-outline'}
              size={15}
              color={isOffline ? colors.error : colors.textSecondary}
            />
            <Text style={[styles.statusStripText, isOffline && { color: colors.error }]} numberOfLines={1}>
              {isOffline
                ? t('organizerTicketScanner.offline.banner')
                : t('organizerTicketScanner.offline.ready').replace('{count}', String(offlineReady ?? 0))}
            </Text>
          </View>
        )}

        {/* Check-ins this phone admitted while offline and has not delivered
            yet. Cleared as the queue syncs. */}
        {pendingSync > 0 && (
          <View style={[styles.statusStrip, { backgroundColor: T.amberMuted }]}>
            <Ionicons name="sync-outline" size={15} color={T.amber} />
            <Text style={[styles.statusStripText, { color: T.amber }]} numberOfLines={1}>
              {(pendingSync === 1 ? t('doorScanner.sync.pendingOne') : t('doorScanner.sync.pendingMany')).replace(
                '{count}',
                String(pendingSync),
              )}
            </Text>
          </View>
        )}
      </View>

      <ManualLookupSheet
        visible={showLookup}
        onClose={() => setShowLookup(false)}
        guests={guests ?? []}
        listUnavailable={listUnavailable}
        doorOnly={accessMode === 'door'}
        onSelect={handleManualSelect}
      />

      <DoorResultOverlay
        result={doorResult}
        onDismiss={handleDismissDoor}
        onAllowReentry={handleAllowReentryDoor}
      />

      {/* Bottom sheet modal */}
      <Modal
        visible={scanResult !== null}
        transparent
        animationType="slide"
        onRequestClose={handleCloseSheet}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={handleCloseSheet}
          />
          <View style={[styles.bottomSheet, { paddingBottom: Math.max(40, insets.bottom + 16) }]}>
            <View style={styles.sheetGrabber} />
            {/* Status Icon — locked colours: emerald admitted, amber already
                in, red refused / outside its entry window. */}
            <View style={styles.sheetHeader}>
              <Ionicons name={sheetIcon as any} size={64} color={sheetTone} />
            </View>

            {/* Ticket Details */}
            <View style={styles.sheetContent}>
              {scanResult?.attendeeName && (
                <Text style={styles.attendeeName} numberOfLines={2}>{scanResult.attendeeName}</Text>
              )}
              {scanResult?.tierName && (
                <Text style={styles.tierName} numberOfLines={1}>{scanResult.tierName}</Text>
              )}
              {scanResult?.method === 'manual' && scanResult?.status === 'VALID' && (
                <View style={styles.manualNote}>
                  <StatusChip status="neutral" label={t('doorScanner.manualCheckIn')} />
                </View>
              )}
              {scanResult?.message && (
                <Text style={styles.message}>{scanResult.message}</Text>
              )}

              {isProcessing && scanResult?.status === 'VALID' && (
                <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
              )}
            </View>

            {/* HARD validity block banner — shown prominently in red/error with
                the date when the ticket is outside its tier's entry window. */}
            {scanResult?.status === 'VALID' && scanResult?.validityBlock && (
              <View style={styles.validityBlock}>
                <Ionicons name="alert-circle" size={20} color={colors.error} />
                <Text style={styles.validityBlockText}>{scanResult.validityBlock}</Text>
              </View>
            )}

            {/* Action Buttons */}
            <View style={styles.sheetActions}>
              {scanResult?.status === 'VALID' ? (
                scanResult?.validityBlock ? (
                  // Out-of-window: the default confirm is DISABLED. Staff may
                  // still admit via the explicit, less-prominent override.
                  <>
                    <WhitePillCTA label={t('organizerTicketScanner.actions.confirm')} disabled />
                    <TouchableOpacity
                      style={[styles.actionButton, styles.overrideButton]}
                      onPress={handleConfirmCheckIn}
                    >
                      <Text style={styles.overrideButtonText}>{overrideLabel}</Text>
                    </TouchableOpacity>
                    <SecondaryPill label={t('common.cancel')} onPress={handleCloseSheet} />
                  </>
                ) : (
                  <>
                    <WhitePillCTA
                      label={t('organizerTicketScanner.actions.confirm')}
                      onPress={handleConfirmCheckIn}
                    />
                    <SecondaryPill label={t('common.cancel')} onPress={handleCloseSheet} />
                  </>
                )
              ) : scanResult?.status === 'ALREADY_CHECKED_IN' &&
                eventMetaRef.current.allowReentry &&
                scanResult?.ticketId ? (
                <>
                  <WhitePillCTA label={t('common.close')} onPress={handleCloseSheet} />
                  <SecondaryPill label={t('doorScanner.result.allowReentry')} onPress={handleAllowReentrySheet} />
                </>
              ) : (
                <WhitePillCTA label={t('common.close')} onPress={handleCloseSheet} />
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  message: {
    fontSize: 16,
    color: colors.text,
    textAlign: 'center',
    marginVertical: 20,
    paddingHorizontal: 40,
  },
  cameraSection: {
    flex: 1,
    width: '100%',
  },
  camera: {
    flex: 1,
    width: '100%',
  },
  bottomChrome: {
    width: '100%',
    backgroundColor: colors.surface,
  },
  belowHeader: {
    height: 64,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  belowHeaderButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  belowHeaderTitleWrap: {
    flex: 1,
    marginHorizontal: 8,
    alignItems: 'center',
  },
  belowHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  belowHeaderSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  toolsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  // Filled tool surfaces one step up from the chrome — no hairline boxes.
  tool: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 14,
    borderRadius: radius.button,
    backgroundColor: T.surfaceRaised,
  },
  toolGrow: {
    flex: 1,
  },
  toolText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    flexShrink: 1,
  },
  toolSwitch: {
    transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }],
  },
  doorPanel: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  entryRow: {
    gap: spacing.sm,
  },
  entryChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.chip,
    backgroundColor: T.surfaceRaised,
  },
  // A chosen chip is the one place pure white is allowed (POSH fill ladder).
  entryChipActive: {
    backgroundColor: T.white,
  },
  entryChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  entryChipTextActive: {
    color: T.onWhite,
  },
  recentCard: {
    borderRadius: radius.lg,
    backgroundColor: T.surfaceRaised,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  recentTitle: {
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  recentEmpty: {
    fontSize: 13,
    color: colors.textTertiary,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  recentName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  recentTime: {
    fontSize: 12,
    color: colors.textTertiary,
    fontVariant: ['tabular-nums'],
    minWidth: 52,
    textAlign: 'right',
  },
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  statusStripOffline: {
    backgroundColor: `${colors.error}14`,
  },
  statusStripText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  doorBadge: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.chip,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    maxWidth: '86%',
  },
  doorBadgeDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: T.accent,
  },
  doorBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: T.white,
  },
  scanFrame: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  corner: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderColor: colors.white,
  },
  cornerTopLeft: {
    top: '30%',
    left: '15%',
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  cornerTopRight: {
    top: '30%',
    right: '15%',
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  cornerBottomLeft: {
    bottom: '30%',
    left: '15%',
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  cornerBottomRight: {
    bottom: '30%',
    right: '15%',
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  instructionContainer: {
    position: 'absolute',
    bottom: 32,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  instruction: {
    fontSize: 16,
    color: colors.white,
    textAlign: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalBackdrop: {
    flex: 1,
  },
  bottomSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: RADIUS['2xl'],
    borderTopRightRadius: RADIUS['2xl'],
    paddingTop: 12,
    paddingBottom: 40,
    paddingHorizontal: 24,
    minHeight: 300,
  },
  sheetGrabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 16,
  },
  sheetHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  sheetContent: {
    alignItems: 'center',
    marginBottom: 24,
  },
  attendeeName: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  tierName: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 16,
    textAlign: 'center',
  },
  manualNote: {
    marginBottom: 8,
  },
  loader: {
    marginTop: 16,
  },
  validityBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.errorLight,
    borderRadius: RADIUS.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  validityBlockText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.error,
  },
  sheetActions: {
    gap: 12,
  },
  actionButton: {
    paddingVertical: 16,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  // A red FILL, not a red hairline around nothing.
  overrideButton: {
    backgroundColor: T.redMuted,
  },
  overrideButtonText: {
    color: colors.error,
    fontSize: 15,
    fontWeight: '600',
  },
});
