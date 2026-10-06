import AsyncStorage from '@react-native-async-storage/async-storage';
import { backendFetch } from './api/backend';
import { enqueueCheckIn, scrubDoorRow, type DoorRow, type DoorVerdict, type QueuedCheckIn } from './doorList';

/**
 * Server-backed door path for staff who may check people in but not read the
 * attendee list. The scanner uses it when the member doc says
 * permissions.viewAttendees is not true, or when a direct tickets read is
 * denied. Owners and full-access staff keep the Firestore path.
 *
 *   - fetchDoorList: GET /api/staff/events/:id/door-list, mirrored to
 *     AsyncStorage like the scanner's manifest so a scan still validates
 *     after connectivity drops.
 *   - postCheckIn: POST /api/staff/events/:id/check-in (a server transaction).
 *   - The offline queue: a check-in that cannot reach the server is stored
 *     on the device and replayed by flushCheckInQueue when back online.
 */

const LIST_TIMEOUT_MS = 8000;
const CHECK_IN_TIMEOUT_MS = 6000;

export type DoorListPayload = {
  event: { id: string; title: string; allowReentry: boolean };
  rows: DoorRow[];
  generatedAt: string;
};

export type CheckInResponse = {
  verdict: DoorVerdict;
  row: DoorRow | null;
  /** ALREADY_CHECKED_IN by this same user (e.g. an earlier timed-out request that landed). */
  mine?: boolean;
};

export class DoorOfflineError extends Error {
  constructor() {
    super('offline');
    this.name = 'DoorOfflineError';
  }
}

/** Auth / permission failures that retrying will not fix. */
export class DoorAccessError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'DoorAccessError';
    this.status = status;
  }
}

async function fetchWithTimeout(path: string, init: Parameters<typeof backendFetch>[1], ms: number) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      backendFetch(path, { ...(init || {}), signal: controller?.signal as any }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller?.abort();
          reject(new DoorOfflineError());
        }, ms);
      }),
    ]);
  } catch (e) {
    if (e instanceof DoorOfflineError) throw e;
    // backendFetch throws only on a network failure (and on abort).
    throw new DoorOfflineError();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const listKey = (eventId: string) => `door_list_${eventId}`;

export async function fetchDoorList(eventId: string): Promise<DoorListPayload> {
  const res = await fetchWithTimeout(`/api/staff/events/${encodeURIComponent(eventId)}/door-list`, {}, LIST_TIMEOUT_MS);
  const json: any = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new DoorAccessError(res.status, String(json?.error || 'Forbidden'));
  }
  if (!res.ok || !json || !Array.isArray(json.rows)) throw new DoorOfflineError();
  const payload: DoorListPayload = {
    event: {
      id: String(json.event?.id || eventId),
      title: String(json.event?.title || ''),
      allowReentry: Boolean(json.event?.allowReentry),
    },
    // scrubDoorRow: an older server sent the raw admitting code; keep only its hash.
    rows: (json.rows as DoorRow[]).map(scrubDoorRow),
    generatedAt: String(json.generatedAt || new Date().toISOString()),
  };
  await saveDoorList(eventId, payload);
  return payload;
}

export async function saveDoorList(eventId: string, payload: DoorListPayload): Promise<void> {
  try {
    await AsyncStorage.setItem(listKey(eventId), JSON.stringify(payload));
  } catch {
    // a convenience; the in-memory list still works
  }
}

export async function loadCachedDoorList(eventId: string): Promise<DoorListPayload | null> {
  try {
    const raw = await AsyncStorage.getItem(listKey(eventId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    // A list cached by an older build holds every ticket's raw admitting code.
    // Rewrite it to hashes and persist that, so the raw codes leave the device.
    const legacy = (parsed.rows as DoorRow[]).some((r) => r && r.code !== undefined);
    const payload: DoorListPayload = { ...parsed, rows: (parsed.rows as DoorRow[]).map(scrubDoorRow) };
    if (legacy) await saveDoorList(eventId, payload);
    return payload;
  } catch {
    return null;
  }
}

export async function clearCachedDoorList(eventId: string): Promise<void> {
  await AsyncStorage.removeItem(listKey(eventId)).catch(() => {});
}

export async function postCheckIn(
  eventId: string,
  body: {
    ticketId: string;
    /** The raw scanned code (scans only). Sending it is what opts this client into TRANSFERRED / INVALID_CODE verdicts. */
    code?: string | null;
    method: 'scan' | 'manual';
    entryPoint?: string | null;
    reentry?: boolean;
    override?: boolean;
  },
): Promise<CheckInResponse> {
  const res = await fetchWithTimeout(
    `/api/staff/events/${encodeURIComponent(eventId)}/check-in`,
    { method: 'POST', body: JSON.stringify(body) },
    CHECK_IN_TIMEOUT_MS,
  );
  const json: any = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 400) {
    throw new DoorAccessError(res.status, String(json?.error || 'Forbidden'));
  }
  if (!res.ok || !json?.verdict) throw new DoorOfflineError();
  return { verdict: json.verdict as DoorVerdict, row: (json.row as DoorRow) || null, mine: Boolean(json.mine) };
}

// ---------------------------------------------------------------------------
// Offline queue
// ---------------------------------------------------------------------------

const queueKey = (uid: string) => `door_checkin_queue_${uid}`;

export async function readCheckInQueue(uid: string): Promise<QueuedCheckIn[]> {
  try {
    const raw = await AsyncStorage.getItem(queueKey(uid));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeCheckInQueue(uid: string, queue: QueuedCheckIn[]): Promise<void> {
  if (queue.length === 0) await AsyncStorage.removeItem(queueKey(uid)).catch(() => {});
  else await AsyncStorage.setItem(queueKey(uid), JSON.stringify(queue)).catch(() => {});
}

// Serialises queue read-modify-write so a flush and a new offline scan never
// overwrite each other.
let queueLock: Promise<unknown> = Promise.resolve();
function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = queueLock.then(fn, fn);
  queueLock = next.catch(() => {});
  return next;
}

export function queueCheckIn(uid: string, item: Omit<QueuedCheckIn, 'key' | 'queuedAt'>): Promise<number> {
  return withQueueLock(async () => {
    const queue = await readCheckInQueue(uid);
    const next = enqueueCheckIn(queue, {
      ...item,
      key: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      queuedAt: new Date().toISOString(),
    });
    await writeCheckInQueue(uid, next);
    return next.filter((q) => q.eventId === item.eventId).length;
  });
}

export async function pendingCount(uid: string, eventId: string): Promise<number> {
  const queue = await readCheckInQueue(uid);
  return queue.filter((q) => q.eventId === eventId).length;
}

export type FlushReport = {
  synced: number;
  /** Refused on sync: already in on another device, refunded meanwhile, etc. */
  conflicts: Array<{ item: QueuedCheckIn; verdict: DoorVerdict }>;
  /** Left in the queue (still offline). */
  remaining: number;
};

/**
 * Replay queued check-ins in order. Stops at the first network failure and
 * keeps the rest; drops an item the server judged (any verdict) or one it will
 * never accept (no longer staff, event gone).
 */
export function flushCheckInQueue(uid: string, eventId?: string): Promise<FlushReport> {
  return withQueueLock(async () => {
    const queue = await readCheckInQueue(uid);
    const report: FlushReport = { synced: 0, conflicts: [], remaining: 0 };
    const keep: QueuedCheckIn[] = [];
    let offline = false;

    for (const item of queue) {
      if (offline || (eventId && item.eventId !== eventId)) {
        keep.push(item);
        continue;
      }
      try {
        const res = await postCheckIn(item.eventId, {
          ticketId: item.ticketId,
          ...(item.code ? { code: item.code } : {}),
          method: item.method,
          entryPoint: item.entryPoint,
          reentry: item.reentry,
          override: item.override,
        });
        if (res.verdict === 'CHECKED_IN' || (res.verdict === 'ALREADY_CHECKED_IN' && res.mine)) report.synced += 1;
        else report.conflicts.push({ item, verdict: res.verdict });
      } catch (e) {
        if (e instanceof DoorAccessError) {
          report.conflicts.push({ item, verdict: 'NOT_FOUND' });
        } else {
          offline = true;
          keep.push(item);
        }
      }
    }

    await writeCheckInQueue(uid, keep);
    report.remaining = keep.filter((q) => !eventId || q.eventId === eventId).length;
    return report;
  });
}
