import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * A small on-device log of JS errors (the app has no crash reporting yet:
 * no Sentry, no Crashlytics). The last few are kept in AsyncStorage so the
 * error screen can show what happened, and a tester's screenshot carries it.
 *
 * Also wraps React Native's global handler, so uncaught errors outside
 * render (timers, promise callbacks that throw synchronously) land here too
 * before the default handling runs.
 */

export const ERROR_LOG_KEY = 'tikra_error_log_v1';
const MAX_ENTRIES = 10;

export interface ErrorLogEntry {
  at: number;
  message: string;
  stack?: string;
  componentStack?: string;
  fatal?: boolean;
  source: 'render' | 'global';
  platform: string;
  updateId?: string | null;
}

function updateId(): string | null {
  try {
    // Lazy: expo-updates is native and absent in tests and on web.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-updates').updateId ?? null;
  } catch {
    return null;
  }
}

function clip(s: string | undefined, n: number): string | undefined {
  return s && s.length > n ? s.slice(0, n) : s;
}

/** Turns anything thrown into a short, storable entry. */
export function toErrorLogEntry(
  error: unknown,
  extra: { source: ErrorLogEntry['source']; componentStack?: string | null; fatal?: boolean },
): ErrorLogEntry {
  const e = error as { message?: unknown; stack?: unknown; name?: unknown } | null | undefined;
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : typeof e?.message === 'string'
          ? e.message
          : 'Unknown error';
  return {
    at: Date.now(),
    message: clip(message, 500) as string,
    stack: clip(typeof e?.stack === 'string' ? e.stack : undefined, 2000),
    componentStack: clip(extra.componentStack ?? undefined, 2000),
    fatal: extra.fatal,
    source: extra.source,
    platform: Platform.OS,
    updateId: updateId(),
  };
}

/** Newest first, capped. */
export function appendEntry(list: ErrorLogEntry[], entry: ErrorLogEntry, max = MAX_ENTRIES): ErrorLogEntry[] {
  return [entry, ...list].slice(0, max);
}

export async function readErrorLog(): Promise<ErrorLogEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(ERROR_LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function logError(
  error: unknown,
  extra: { source: ErrorLogEntry['source']; componentStack?: string | null; fatal?: boolean },
): Promise<void> {
  const entry = toErrorLogEntry(error, extra);
  try {
    console.error(`[tikra:${entry.source}]`, entry.message, entry.componentStack ?? '');
  } catch {}
  try {
    const list = await readErrorLog();
    await AsyncStorage.setItem(ERROR_LOG_KEY, JSON.stringify(appendEntry(list, entry)));
  } catch {}
}

let installed = false;

/** Route uncaught JS errors through logError, then the original handler. */
export function installGlobalErrorLogging(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
      setGlobalHandler?: (h: (error: unknown, isFatal?: boolean) => void) => void;
    };
  };
  const utils = g.ErrorUtils;
  if (!utils?.getGlobalHandler || !utils.setGlobalHandler) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    void logError(error, { source: 'global', fatal: !!isFatal });
    previous?.(error, isFatal);
  });
}
