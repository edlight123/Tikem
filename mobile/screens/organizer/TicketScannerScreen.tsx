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
import { doc, updateDoc, getDoc, serverTimestamp, getDocs, query, collection, where } from 'firebase/firestore';
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
import { Camera, DoorOpen, Search, Vibrate, VibrateOff } from 'lucide-react-native';

type RouteParams = {
  TicketScanner: {
    eventId: string;
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
};

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
  const { eventId } = route.params;

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
  const doorTicketRef = useRef<{ ticketId: string; method: CheckInMethod; name?: string; tier?: string } | null>(null);
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);
  const eventMetaRef = useRef<{ allowReentry: boolean }>({ allowReentry: false });
  const [eventTitle, setEventTitle] = useState<string>('');

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
      .catch(() => {});
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
      try {
        const snap = await getDocs(query(collection(db, 'tickets'), where('event_id', '==', eventId)));
        if (cancelled) return;
        const manifest: Record<string, { name: string; tier: string; status: string; checkedIn: boolean }> = {};
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
          };
          // The in-memory lookup list may carry the email so staff can search
          // by it; it is dropped with the screen and never written to disk.
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
      } catch (e) {
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
                checkedIn: !!m.checkedIn,
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
    // On unmount, drop the cached guest manifest so the (reduced) PII isn't left
    // sitting in AsyncStorage after the scanning session ends.
    return () => {
      cancelled = true;
      AsyncStorage.removeItem(`scanner_manifest_${eventId}`).catch(() => {});
    };
  }, [eventId]);

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

  const markGuestCheckedIn = (ticketId: string) => {
    setGuests((prev) =>
      prev ? prev.map((g) => (g.ticketId === ticketId ? { ...g, checkedIn: true } : g)) : prev,
    );
  };

  /**
   * Read and judge one ticket. The ONE validation path: the camera and the
   * manual lookup both come through here, so a hand-picked guest gets exactly
   * the checks a scanned QR gets (event, expiry, duplicate, status, entry
   * window). Offline this is served from the cache warmed on mount.
   */
  const validateTicket = async (ticketId: string, method: CheckInMethod): Promise<ScanResult> => {
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
      if (ticketData.checked_in_at || ticketData.checked_in === true) {
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
   * Write the check-in. Same fields the web's checkInTicket writes (and that
   * firestore.rules lets door staff touch): checked_in, checked_in_at,
   * checked_in_by, check_in_method, entry_point, updated_at, reentry_override.
   *
   * Firestore's updateDoc promise only settles once the write reaches the
   * server, so offline `await` would hang forever. Fire it and race against a
   * short timeout: the write is applied to the local cache immediately (so a
   * re-scan shows ALREADY_CHECKED_IN) and Firestore syncs it on reconnect.
   * A detached catch swallows a late rejection once the race has moved on.
   */
  const commitCheckIn = async (
    ticketId: string,
    method: CheckInMethod,
    opts: { reentry?: boolean } = {},
  ): Promise<{ synced: boolean }> => {
    const payload: Record<string, any> = {
      checked_in: true,
      checked_in_at: serverTimestamp(),
      checked_in_by: auth.currentUser?.uid || null,
      // 'scan' when the camera read a real QR, 'manual' when staff picked the
      // guest off the list — payout review reads this.
      check_in_method: method,
      updated_at: serverTimestamp(),
    };
    // The entry point is only chosen in door mode, so only door mode records it.
    if (doorMode) payload.entry_point = entryPoint;
    if (opts.reentry) payload.reentry_override = true;

    const writePromise = updateDoc(doc(db, 'tickets', ticketId), payload);
    writePromise.catch((e) => console.warn('Deferred check-in write failed:', e));

    let synced = false;
    await Promise.race([
      writePromise.then(() => {
        synced = true;
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 1200)),
    ]);
    if (!synced) setIsOffline(true);
    markGuestCheckedIn(ticketId);
    return { synced };
  };

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
      const { synced } = await commitCheckIn(r.ticketId, method, opts);
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
  const runScan = async (ticketId: string, method: CheckInMethod) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);
    lastScanRef.current = { id: ticketId, at: Date.now() };

    const result = await validateTicket(ticketId, method);

    if (doorMode) {
      if (result.status === 'VALID' && !result.validityBlock) {
        doorTicketRef.current = { ticketId, method, name: result.attendeeName, tier: result.tierName };
        await admitInDoorMode(result);
        return;
      }
      if (result.status !== 'VALID') {
        doorTicketRef.current = { ticketId, method, name: result.attendeeName, tier: result.tierName };
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
    await runScan(ticketId, 'scan');
  };

  const handleManualSelect = (ticketId: string) => {
    // The sheet closes first; give its slide-out a beat so the verdict (sheet
    // or door overlay) doesn't collide with it.
    setTimeout(() => {
      runScan(ticketId, 'manual');
    }, 350);
  };

  const handleConfirmCheckIn = async () => {
    if (!scanResult || scanResult.status !== 'VALID' || !scanResult.ticketId) return;

    try {
      const { synced } = await commitCheckIn(scanResult.ticketId, scanResult.method ?? 'scan');
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
      const { synced } = await commitCheckIn(scanResult.ticketId, scanResult.method ?? 'scan', { reentry: true });
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
      { status: 'VALID', ticketId: target.ticketId, method: target.method, attendeeName: target.name, tierName: target.tier },
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
      </View>

      <ManualLookupSheet
        visible={showLookup}
        onClose={() => setShowLookup(false)}
        guests={guests ?? []}
        listUnavailable={listUnavailable}
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
