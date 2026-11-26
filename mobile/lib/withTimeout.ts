/**
 * Give up on a promise after `ms` (owner, TestFlight 2026-11-24: an event page
 * "stays like this", on its skeleton, for good). Firestore's getDoc can wait
 * indefinitely on a stalled connection instead of failing; a screen that
 * awaits it must be able to say so and offer Retry. The original promise keeps
 * running; only its answer is ignored.
 */
export class TimeoutError extends Error {
  code = 'deadline-exceeded';
  constructor() {
    super('timeout');
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), ms);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

/** How long a detail page waits for its main document before showing Retry. */
export const DETAIL_TIMEOUT_MS = 12000;
