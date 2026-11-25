import AsyncStorage from '@react-native-async-storage/async-storage';
import { backendFetch, backendJson } from './api/backend';
import type { PrintedBatchSummary } from './printedBundle';
import {
  enqueueActivation,
  syncActivationQueue,
  type ActivationResponse,
  type PostOutcome,
  type QueuedActivation,
  type SyncReport,
} from './physicalTickets';

/**
 * Network + storage for selling printed tickets (lib/physicalTickets.ts holds
 * the pure rules). Same shape as lib/doorCheckIn.ts: a timeout counts as
 * offline, a judged answer is a 200, auth/input refusals are 4xx.
 */

const TIMEOUT_MS = 7000;

async function postWithTimeout(path: string, body: unknown): Promise<Response | null> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      backendFetch(path, { method: 'POST', body: JSON.stringify(body), signal: controller?.signal as any }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          controller?.abort();
          resolve(null);
        }, TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null; // network failure / abort
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** POST one activation. Never throws. */
export async function postActivation(item: QueuedActivation, opts: { offline?: boolean } = {}): Promise<PostOutcome> {
  const res = await postWithTimeout(`/api/staff/events/${encodeURIComponent(item.eventId)}/physical/activate`, {
    ...(item.code ? { code: item.code } : {}),
    ...(item.serial ? { serial: item.serial } : {}),
    name: item.name,
    phone: item.phone,
    method: item.method,
    clientRef: item.clientRef,
    clientActivatedAt: item.clientActivatedAt,
    offline: opts.offline === true,
  });
  if (!res) return { type: 'offline' };
  const json: any = await res.json().catch(() => null);
  if (res.status >= 500) return { type: 'offline' };
  if (!res.ok) return { type: 'denied', status: res.status };
  if (!json || typeof json.ok !== 'boolean') return { type: 'offline' };
  return { type: 'judged', response: json as ActivationResponse };
}

// ---------------------------------------------------------------------------
// Queue persistence (per signed-in account)
// ---------------------------------------------------------------------------

const queueKey = (uid: string) => `physical_activation_queue_${uid}`;

export async function readActivationQueue(uid: string): Promise<QueuedActivation[]> {
  try {
    const raw = await AsyncStorage.getItem(queueKey(uid));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeActivationQueue(uid: string, queue: QueuedActivation[]): Promise<void> {
  if (queue.length === 0) await AsyncStorage.removeItem(queueKey(uid)).catch(() => {});
  else await AsyncStorage.setItem(queueKey(uid), JSON.stringify(queue)).catch(() => {});
}

let lock: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = lock.then(fn, fn);
  lock = next.catch(() => {});
  return next;
}

/** Queue an activation made offline. `duplicate`: this phone already queued a sale of that ticket. */
export function queueActivation(uid: string, item: QueuedActivation): Promise<{ duplicate: boolean; pending: number }> {
  return withLock(async () => {
    const { queue, duplicate } = enqueueActivation(await readActivationQueue(uid), item);
    if (!duplicate) await writeActivationQueue(uid, queue);
    return { duplicate, pending: queue.filter((q) => q.eventId === item.eventId).length };
  });
}

export async function pendingActivations(uid: string, eventId: string): Promise<number> {
  return (await readActivationQueue(uid)).filter((q) => q.eventId === eventId).length;
}

export function flushActivationQueue(uid: string, eventId?: string): Promise<SyncReport> {
  return withLock(async () => {
    const report = await syncActivationQueue(
      await readActivationQueue(uid),
      (item) => postActivation(item, { offline: true }),
      { eventId },
    );
    await writeActivationQueue(uid, report.queue);
    return report;
  });
}

export type SellerAssignment = {
  batchId: string;
  eventId: string;
  eventTitle: string;
  tierName: string;
  status: string;
  ranges: Array<{ from: number; to: number; fromSerial: string; toSerial: string }>;
};

/** The printed-ticket ranges assigned to the signed-in seller. Empty on any failure. */
export async function fetchSellerAssignments(): Promise<SellerAssignment[]> {
  try {
    const res = await backendFetch('/api/staff/physical/assignments');
    if (!res.ok) return [];
    const json: any = await res.json().catch(() => null);
    return Array.isArray(json?.assignments) ? (json.assignments as SellerAssignment[]) : [];
  } catch {
    return [];
  }
}

/**
 * The event's printed batches with their counts (GET
 * /api/organizer/events/{id}/physical-batches: owner, admin, manager). null
 * when it cannot be read (no access, offline): callers then fall back to the
 * ticket docs and hide the batch list.
 */
export async function fetchPrintedBatches(eventId: string): Promise<PrintedBatchSummary[] | null> {
  try {
    const json = await backendJson<{ batches?: PrintedBatchSummary[] }>(
      `/api/organizer/events/${encodeURIComponent(eventId)}/physical-batches`
    );
    return Array.isArray(json?.batches) ? json.batches : null;
  } catch {
    return null;
  }
}
