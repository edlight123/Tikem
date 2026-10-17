// Reading the address book and matching it against Tikèm, shared by the
// Connections "Find" tab and the event invite sheet. Contacts stay on the
// phone: only their numbers go to /api/connections/match-contacts (matched
// against verified numbers, never stored), and the names never leave.
//
// The match result is kept in memory for a few hours per account: the server
// meters lookups per day (3,000 numbers), and reopening the invite sheet
// should not spend that budget again.

import * as Contacts from 'expo-contacts';
import { matchContacts } from './api/social';
import type { ContactMatch } from '../types/social';

export interface DeviceContact {
  id: string;
  name: string;
  /** First number, used to address WhatsApp / Messages. */
  phone: string;
  /** Every number on the card, as the address book stores it. */
  phones: string[];
}

export type ContactsPermission = 'granted' | 'denied' | 'undetermined';

const MATCH_TTL_MS = 6 * 60 * 60 * 1000;
let cache: { uid: string; at: number; contacts: DeviceContact[]; matches: ContactMatch[] } | null = null;

/** Current permission, without asking. */
export async function contactsPermission(): Promise<ContactsPermission> {
  try {
    const { status } = await Contacts.getPermissionsAsync();
    return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'undetermined';
  }
}

/** Ask (the system prompt shows once; afterwards this just reports). */
export async function requestContactsPermission(): Promise<boolean> {
  try {
    const { status } = await Contacts.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

/** Named contacts with at least one number, sorted by name. */
export async function readDeviceContacts(): Promise<DeviceContact[]> {
  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
  });
  const list: DeviceContact[] = [];
  data.forEach((c, i) => {
    const phones = (c.phoneNumbers || []).map((p) => p.number || '').filter(Boolean);
    const name = String(c.name || '').trim();
    if (phones.length && name) list.push({ id: String(c.id || i), name, phone: phones[0], phones });
  });
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Read the address book and match it, reusing a recent result for the same
 * account unless `force`. Throws only if reading the contacts fails; a
 * failed match call returns the matches made so far.
 */
export async function syncContacts(
  uid: string,
  { force = false }: { force?: boolean } = {}
): Promise<{ contacts: DeviceContact[]; matches: ContactMatch[] }> {
  if (!force && cache && cache.uid === uid && Date.now() - cache.at < MATCH_TTL_MS) {
    return { contacts: cache.contacts, matches: cache.matches };
  }
  const contacts = await readDeviceContacts();
  const phones = contacts.flatMap((c) => c.phones);
  const matches = phones.length ? await matchContacts(phones).catch(() => []) : [];
  cache = { uid, at: Date.now(), contacts, matches };
  return { contacts, matches };
}

/** Patch one match in the cache (a friend request just went out). */
export function updateCachedMatch(uid: string, matchUid: string, patch: Partial<ContactMatch>): void {
  if (!cache || cache.uid !== uid) return;
  cache.matches = cache.matches.map((m) => (m.uid === matchUid ? { ...m, ...patch } : m));
}
