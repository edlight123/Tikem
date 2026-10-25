/**
 * The organization the signed-in person is acting for in organizer mode
 * (docs/specs/org-teams.md). One app-wide store, same pattern as
 * blockedOrganizers / songAutoplay: every organizer screen reads
 * `useActiveOrg()` and reloads when the org changes.
 *
 *   - Loads GET /api/organizer/orgs (own org + teams + the server's pick). That
 *     call also accepts open invites sent to a verified email, so it runs on
 *     sign-in and whenever the app comes back to the foreground.
 *   - Remembers the chosen org per account in AsyncStorage
 *     (tikem_active_org_<uid>, cleared on sign-out by AuthContext).
 *   - Tells the API client which org to send as X-Tikem-Org (only when the
 *     org is not the person's own).
 *
 * With no team at all, the person is their own org: orgId = their uid, role
 * owner. That keeps every account that never joined a team exactly as before.
 */
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../config/firebase';
import { backendJson } from './api/backend';
import { orgCan, type OrgAction, type OrgRole } from './orgTeamRoles';
import {
  orgOptionsFrom,
  pickActiveOrg,
  setActingOrgHeader,
  type OrgOption,
  type OrgsResponse,
} from './activeOrgState';

export type { OrgOption } from './activeOrgState';

/** AsyncStorage key prefix; AuthContext removes it on sign-out. */
export const ACTIVE_ORG_KEY_PREFIX = 'tikem_active_org_';
const storageKey = (uid: string) => `${ACTIVE_ORG_KEY_PREFIX}${uid}`;

/** Re-ask the server at most this often on foreground. */
const FOREGROUND_REFRESH_MS = 60 * 1000;

interface Snapshot {
  uid: string | null;
  /** The server answered at least once for this account (or the cache did). */
  loaded: boolean;
  options: OrgOption[];
  /** The chosen option; null = acting as their own org by default. */
  chosen: OrgOption | null;
}

interface Stored {
  orgId: string | null;
  options: OrgOption[];
}

let state: Snapshot = { uid: null, loaded: false, options: [], chosen: null };
const listeners = new Set<() => void>();
let started = false;
let lastFetch = 0;
let inflight: Promise<void> | null = null;

function emit(next: Snapshot) {
  state = next;
  const c = next.chosen;
  setActingOrgHeader(c && next.uid && c.orgId !== next.uid ? c.orgId : null);
  listeners.forEach((l) => l());
}

async function persist(uid: string, orgId: string | null, options: OrgOption[]) {
  const value: Stored = { orgId, options };
  await AsyncStorage.setItem(storageKey(uid), JSON.stringify(value)).catch(() => {});
}

async function readStored(uid: string): Promise<Stored | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(uid));
    if (!raw) return null;
    const v = JSON.parse(raw);
    return {
      orgId: typeof v?.orgId === 'string' ? v.orgId : null,
      options: Array.isArray(v?.options) ? v.options : [],
    };
  } catch {
    return null;
  }
}

async function fetchOrgs(uid: string): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await backendJson<OrgsResponse>('/api/organizer/orgs');
      if (state.uid !== uid) return; // signed out / switched account meanwhile
      const options = orgOptionsFrom(res);
      const stored = await readStored(uid);
      const chosen = pickActiveOrg(options, state.chosen?.orgId ?? stored?.orgId, res?.active?.orgId);
      lastFetch = Date.now();
      emit({ uid, loaded: true, options, chosen });
      await persist(uid, chosen?.orgId ?? null, options);
    } catch (err) {
      // Offline or an older server: keep whatever we have, never block the app.
      if (state.uid === uid && !state.loaded) emit({ ...state, loaded: true });
      console.warn('[activeOrg] could not load orgs', (err as any)?.message || err);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function ensureStarted() {
  if (started) return;
  started = true;
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      emit({ uid: null, loaded: false, options: [], chosen: null });
      return;
    }
    if (state.uid === user.uid) return;
    emit({ uid: user.uid, loaded: false, options: [], chosen: null });
    const uid = user.uid;
    // Paint from the last answer at once, then ask the server.
    readStored(uid)
      .then((stored) => {
        if (state.uid !== uid || state.loaded || !stored) return;
        const chosen = pickActiveOrg(stored.options, stored.orgId);
        emit({ uid, loaded: true, options: stored.options, chosen });
      })
      .finally(() => {
        if (state.uid === uid) void fetchOrgs(uid);
      });
  });
  AppState.addEventListener('change', (s) => {
    if (s !== 'active' || !state.uid) return;
    if (Date.now() - lastFetch < FOREGROUND_REFRESH_MS) return;
    void fetchOrgs(state.uid);
  });
}

function subscribe(listener: () => void) {
  ensureStarted();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface ActiveOrg {
  /** The org's id (its owner's uid, what events carry as organizer_id). Null signed out. */
  orgId: string | null;
  role: OrgRole | null;
  orgName: string;
  isOwner: boolean;
  /** Orgs this person can run in organizer mode (own + admin/manager teams). */
  options: OrgOption[];
  /** True once the org list is known (cached or fetched). */
  loaded: boolean;
  /** Acts for at least one team as admin/manager (opens organizer mode). */
  hasTeamAccess: boolean;
  /**
   * May see the acting org's finances: the owner, or an admin the owner
   * granted read-only finances. Read-only unless isOwner.
   */
  financeView: boolean;
  can: (action: OrgAction) => boolean;
  switchTo: (orgId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/** Plain read of the acting org, for code outside React. */
export function getActiveOrgSnapshot(): { orgId: string | null; role: OrgRole | null } {
  ensureStarted();
  const s = state;
  if (!s.uid) return { orgId: null, role: null };
  return s.chosen ? { orgId: s.chosen.orgId, role: s.chosen.role } : { orgId: s.uid, role: 'owner' };
}

export async function switchActiveOrg(orgId: string): Promise<void> {
  const s = state;
  if (!s.uid) return;
  const next = s.options.find((o) => o.orgId === orgId);
  if (!next || next.orgId === s.chosen?.orgId) return;
  emit({ ...s, chosen: next });
  await persist(s.uid, next.orgId, s.options);
}

export async function refreshActiveOrgs(): Promise<void> {
  ensureStarted();
  if (state.uid) await fetchOrgs(state.uid);
}

const getSnapshot = () => state;

export function useActiveOrg(): ActiveOrg {
  ensureStarted();
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const chosen = s.chosen;
  const orgId = s.uid ? chosen?.orgId ?? s.uid : null;
  const role: OrgRole | null = s.uid ? chosen?.role ?? 'owner' : null;
  const isOwner = !!s.uid && orgId === s.uid;
  return {
    orgId,
    role,
    orgName: chosen?.orgName ?? '',
    isOwner,
    options: s.options,
    loaded: s.loaded,
    hasTeamAccess: s.options.some((o) => o.role === 'admin' || o.role === 'manager'),
    financeView: isOwner || (role === 'admin' && chosen?.financeView === true),
    can: (action: OrgAction) => orgCan(role, action),
    switchTo: switchActiveOrg,
    refresh: refreshActiveOrgs,
  };
}
