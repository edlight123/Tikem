import AsyncStorage from '@react-native-async-storage/async-storage';

import { getOrganizerEvents, type OrganizerEvent } from './api/organizer';
import { backendJson } from './api/backend';
import { earningsCurrency, withdrawableMinor, type EventEarningsRow } from './eventEarnings';

/**
 * Data behind the organizer Earnings hub, computed off-screen and cached so the
 * hub renders instantly when opened.
 *
 * The hub needs the organizer's events plus one /earnings call per event that
 * has sold something, plus recent payouts. That is many round trips, so the
 * dashboard prefetches it (prefetchEarningsHub) and the hub hydrates from the
 * last snapshot (getCachedEarningsHub) before refreshing in the background.
 * Snapshots live in memory per user and are persisted to AsyncStorage so a cold
 * start still opens on real numbers.
 */

export type EventMoney = {
  /** Withdrawable now, minor units (the figure the per-event withdraw routes accept). */
  availableMinor: number;
  /** Net earned over the event's life, minor units. */
  netMinor: number | null;
  grossMinor: number;
  withdrawnMinor: number;
  currency: string;
  /** Settlement state from the earnings row ('ready' | 'pending' | 'locked'). */
  settlementStatus: string | null;
};

export type PayoutHistoryItem = {
  id: string;
  amount: number;
  status: string;
  method?: string;
  currency?: string;
  createdAt: string;
};

/** The slice of an event the hub renders; kept small so the snapshot serialises cleanly. */
export type HubEvent = Pick<
  OrganizerEvent,
  'id' | 'title' | 'start_datetime' | 'status' | 'tickets_sold' | 'banner_image_url' | 'cover_image_url'
>;

export type EarningsHubSnapshot = {
  /** Most recent first. */
  events: HubEvent[];
  /** Keyed by event id; events with no sales or no earnings row are absent. */
  money: Record<string, EventMoney>;
  /** Latest three payouts, or null when the history could not be loaded. */
  payouts: PayoutHistoryItem[] | null;
  /** Every per-event earnings request failed: the balance is unknown, not zero. */
  moneyFailed: boolean;
  fetchedAt: number;
};

const STORAGE_PREFIX = '@tikem/earningsHub/v1/';
/** How many per-event earnings requests run at once. */
const FETCH_CONCURRENCY = 5;

const memory = new Map<string, EarningsHubSnapshot>();
const inFlight = new Map<string, Promise<EarningsHubSnapshot>>();

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Whether an event can have anything on its earnings row. A draft has never
 * sold, and an event with zero tickets sold has no money to show, so neither
 * costs a request. An event whose counter is missing is still fetched.
 */
function hasSales(e: HubEvent): boolean {
  const sold = typeof e.tickets_sold === 'number' ? e.tickets_sold : null;
  if (e.status === 'draft') return (sold || 0) > 0;
  return sold == null || sold > 0;
}

function toMoney(row: EventEarningsRow): EventMoney {
  const net = typeof row.netAmount === 'number' && Number.isFinite(row.netAmount) ? row.netAmount : null;
  return {
    availableMinor: withdrawableMinor(row),
    netMinor: net,
    grossMinor: Math.max(0, Number(row.grossSales || 0)),
    withdrawnMinor: Math.max(0, Number(row.withdrawnAmount || 0)),
    currency: earningsCurrency(row),
    settlementStatus: row.settlementStatus ? String(row.settlementStatus) : null,
  };
}

async function fetchPayouts(): Promise<PayoutHistoryItem[] | null> {
  try {
    const d = await backendJson<{ payouts?: PayoutHistoryItem[] }>('/api/organizer/payout-history');
    return (d?.payouts || [])
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 3);
  } catch {
    return null;
  }
}

async function persist(userId: string, snap: EarningsHubSnapshot) {
  try {
    await AsyncStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(snap));
  } catch {
    // Persistence is a convenience; the in-memory copy still serves this session.
  }
}

/** Fetches a fresh snapshot, stores it, and returns it. Always hits the network. */
export async function loadEarningsHub(userId: string): Promise<EarningsHubSnapshot> {
  const previous = memory.get(userId) || null;
  const payoutsP = fetchPayouts();

  const rows = await getOrganizerEvents(userId, 100);
  // getOrganizerEvents resolves [] on a network error. Don't let a blip wipe a
  // good snapshot: keep the cached one rather than showing an empty hub.
  if (rows.length === 0 && previous && previous.events.length > 0) {
    throw new Error('Organizer events came back empty; keeping cached earnings');
  }

  const events: HubEvent[] = rows
    .map((e) => ({
      id: e.id,
      title: e.title,
      start_datetime: e.start_datetime,
      status: e.status,
      tickets_sold: e.tickets_sold,
      banner_image_url: e.banner_image_url,
      cover_image_url: e.cover_image_url,
    }))
    // Most recent first: the event you're settling is almost always the latest.
    .sort((a, b) => new Date(b.start_datetime).getTime() - new Date(a.start_datetime).getTime());

  const priced = events.filter(hasSales);
  let failures = 0;
  const results = await mapLimited(priced, FETCH_CONCURRENCY, async (e) => {
    try {
      const res = await backendJson<{ earnings: EventEarningsRow | null }>(
        `/api/organizer/events/${e.id}/earnings`
      );
      return [e.id, res?.earnings ? toMoney(res.earnings) : null] as const;
    } catch {
      failures += 1;
      return [e.id, null] as const;
    }
  });

  const money: Record<string, EventMoney> = {};
  for (const [id, m] of results) if (m) money[id] = m;

  const payouts = await payoutsP;
  const snap: EarningsHubSnapshot = {
    events,
    money,
    // A failed history load keeps the last known list instead of hiding it.
    payouts: payouts ?? previous?.payouts ?? null,
    moneyFailed: priced.length > 0 && failures === priced.length,
    fetchedAt: Date.now(),
  };

  // A refresh where every earnings call failed should not replace known
  // balances with an "unavailable" state.
  if (snap.moneyFailed && previous && !previous.moneyFailed) {
    const kept = { ...previous, events, payouts: snap.payouts };
    memory.set(userId, kept);
    return kept;
  }

  memory.set(userId, snap);
  persist(userId, snap);
  return snap;
}

/** Last known snapshot for this user: memory first, then AsyncStorage. Null when none. */
export async function getCachedEarningsHub(userId: string): Promise<EarningsHubSnapshot | null> {
  const hot = memory.get(userId);
  if (hot) return hot;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EarningsHubSnapshot;
    if (!parsed || !Array.isArray(parsed.events) || typeof parsed.money !== 'object') return null;
    // A fresher in-memory copy may have landed while storage was being read.
    const now = memory.get(userId);
    if (now) return now;
    memory.set(userId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

/** Synchronous memory-only read, for a first render with no flash. */
export function peekEarningsHub(userId: string): EarningsHubSnapshot | null {
  return memory.get(userId) || null;
}

/**
 * Starts (or joins) a refresh for this user and returns it. Concurrent callers
 * share one request, so the dashboard prefetch and the hub's focus refresh
 * never double the network work.
 */
export function refreshEarningsHub(userId: string): Promise<EarningsHubSnapshot> {
  const existing = inFlight.get(userId);
  if (existing) return existing;
  const p = loadEarningsHub(userId).finally(() => {
    inFlight.delete(userId);
  });
  inFlight.set(userId, p);
  return p;
}

/** Fire-and-forget warm-up, e.g. from the organizer dashboard. */
export function prefetchEarningsHub(userId: string | null | undefined): void {
  if (!userId) return;
  refreshEarningsHub(userId).catch(() => {
    // Silent: the hub retries on focus and falls back to its cached snapshot.
  });
}
