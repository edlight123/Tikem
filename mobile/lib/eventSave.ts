import { isDeviceOnlyImageUri } from './localImageUri';
import { withTimeout } from './withTimeout';

/**
 * The pieces of an event save that decide what the organizer sees, kept pure
 * so they can be tested without a device.
 */

/** A new flyer that didn't reach Storage. The save stops; nothing is written. */
export class PosterUploadError extends Error {
  code = 'poster-upload-failed';
  photoUpload = true;
  constructor(cause?: unknown) {
    super('Failed to upload event image');
    (this as any).cause = cause;
  }
}

/** How long the flyer upload may take before the save gives up and says so. */
export const POSTER_UPLOAD_TIMEOUT_MS = 90_000;
/** How long the whole edit save may take (upload, tiers, the event write). */
export const EVENT_SAVE_TIMEOUT_MS = 150_000;

/**
 * The flyer URL an EDIT saves. A photo still on the phone is uploaded first
 * (each upload goes to a new file, so its URL is new and no cache shows the old
 * flyer); a hosted URL is kept as is. When the upload fails or stalls the save
 * fails: the event keeps the flyer it had (before, the failure was swallowed
 * and the event was saved with NO flyer, under a "Success" message).
 */
export async function resolvePosterForUpdate(
  uri: string | null | undefined,
  upload: (localUri: string) => Promise<string>,
  timeoutMs: number = POSTER_UPLOAD_TIMEOUT_MS,
): Promise<string> {
  const value = uri || '';
  if (!isDeviceOnlyImageUri(value)) return value;
  let url: string;
  try {
    url = await withTimeout(upload(value), timeoutMs);
  } catch (e) {
    throw new PosterUploadError(e);
  }
  if (!/^https?:\/\//i.test(url || '')) throw new PosterUploadError(new Error('no download URL'));
  return url;
}

/**
 * One save at a time. A second tap while the first is still uploading used to
 * start a second save; each ended in "Success" with a Back, and the second
 * Back left the event's page for the dashboard. Returns undefined for a call
 * made while another is running.
 */
export function createSingleFlight() {
  let running = false;
  return {
    get busy() {
      return running;
    },
    async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
      if (running) return undefined;
      running = true;
      try {
        return await fn();
      } finally {
        running = false;
      }
    },
  };
}

/**
 * Save, then (and only then) report success; on failure report it and stay.
 * `onSaved` is where the caller shows "Saved" and navigates away.
 */
export async function saveThenLeave(steps: {
  save: () => Promise<void>;
  onSaved: () => void;
  onFailed: (error: any) => void;
  timeoutMs?: number;
}): Promise<'saved' | 'failed'> {
  try {
    await withTimeout(steps.save(), steps.timeoutMs ?? EVENT_SAVE_TIMEOUT_MS);
  } catch (e) {
    steps.onFailed(e);
    return 'failed';
  }
  steps.onSaved();
  return 'saved';
}
