/**
 * Import events, natively. Paste a link to an event (or an Eventbrite, Luma
 * or Meetup page), pick what was found, and it lands as drafts to check
 * before publishing. Eventbrite is native too: only the account sign-in opens
 * a web view (IntegrationWebView), then returns here. Same APIs as the
 * website's /organizer/import.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Link2 } from 'lucide-react-native';
import { API_BASE_URL, backendJson } from '../../lib/api/backend';
import { integrationWebOrigin } from '../../lib/integrationWeb';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import SectionHeader from '../../components/SectionHeader';
import WhitePillCTA from '../../components/WhitePillCTA';
import { Touchable } from '../../components/ui/Touchable';
import { colors as T, radius } from '../../theme/tokens';

type Found = { uid: string; title: string; start: string; venue: string; city: string; online: boolean; price: number | null; currency: string | null };
type Created = { id: string; title: string; skipped?: boolean; flags?: string[]; sourceCurrency?: string | null };
type EbEvent = { id: string; title: string; start: string; venue: string; online: boolean; currency: string | null; tiers: Array<{ name: string; price: number }> };
type EbState = { available: boolean; connected: boolean; expired?: boolean; events: EbEvent[] };
type EbSyncResult = { ok: boolean; reason?: string | null; created: number; updated: number; rate_limited: boolean };
type EbSync = { connected: boolean; auto_sync: boolean; last_synced_at: string | null; last_sync_result: EbSyncResult | null };

const SYNC_API = '/api/organizer/integrations/eventbrite/sync';
const EB_API = '/api/organizer/import/eventbrite';

export default function ImportEventsScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { t, language } = useI18n();

  const [url, setUrl] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Created[] | null>(null);

  const [eb, setEb] = useState<EbState | null>(null);
  const [ebPicked, setEbPicked] = useState<Set<string>>(new Set());
  const [ebBusy, setEbBusy] = useState(false);
  const [ebError, setEbError] = useState('');
  const [ebDone, setEbDone] = useState<Created[] | null>(null);
  const [ebNote, setEbNote] = useState('');
  const [sync, setSync] = useState<EbSync | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');

  const errorText = (e: any) => {
    const code = typeof e?.code === 'string' ? e.code : '';
    const key = `organizerImport.errors.${code}`;
    const v = code ? t(key) : '';
    return v && v !== key ? v : t('organizerImport.genericError');
  };

  const loadEb = useCallback(() => {
    backendJson<EbState>(EB_API)
      .then((d) => {
        setEb({ available: d?.available !== false, connected: !!d?.connected, expired: !!d?.expired, events: d?.events || [] });
        setEbPicked(new Set((d?.events || []).map((e) => e.id)));
      })
      .catch(() => setEb({ available: false, connected: false, events: [] }));
    backendJson<EbSync>(SYNC_API).then(setSync).catch(() => setSync(null));
  }, []);
  useFocusEffect(useCallback(() => loadEb(), [loadEb]));

  // Back from the Eventbrite sign-in (IntegrationWebView sets this param).
  const ebResult: string | undefined = route.params?.eventbriteResult;
  const ebResultAt: number | undefined = route.params?.at;
  useEffect(() => {
    if (!ebResult) return;
    setEbNote(
      ebResult === 'connected'
        ? t('organizerImport.connected')
        : ebResult === 'cancelled'
          ? t('organizerImport.connectCancelled')
          : t('organizerImport.connectFailed')
    );
  }, [ebResult, ebResultAt, t]);

  const find = async () => {
    if (!url.trim() || busy) return;
    setDone(null);
    setFound(null);
    setBusy(true);
    setError('');
    try {
      const d = await backendJson<{ events: Found[] }>('/api/organizer/import', { method: 'POST', body: JSON.stringify({ url: url.trim() }) });
      setFound(d.events || []);
      setPicked(new Set((d.events || []).map((x) => x.uid)));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const importNow = async () => {
    setBusy(true);
    setError('');
    try {
      const d = await backendJson<{ created: Created[] }>('/api/organizer/import', { method: 'POST', body: JSON.stringify({ url: url.trim(), uids: [...picked] }) });
      setDone(d.created || []);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const importEb = async () => {
    setEbBusy(true);
    setEbError('');
    try {
      const d = await backendJson<{ created: Created[] }>(EB_API, { method: 'POST', body: JSON.stringify({ ids: [...ebPicked] }) });
      setEbDone(d.created || []);
    } catch (e) {
      setEbError(errorText(e));
    } finally {
      setEbBusy(false);
    }
  };

  const disconnectEb = async () => {
    await backendJson(EB_API, { method: 'DELETE' }).catch(() => null);
    setEb((s) => (s ? { ...s, connected: false, events: [] } : s));
    setSync(null);
    setEbDone(null);
    setEbNote('');
  };

  const connectEb = () =>
    navigation.navigate('IntegrationWebView', {
      url: `${integrationWebOrigin(API_BASE_URL)}/api/integrations/eventbrite/start`,
      title: 'Eventbrite',
      returnTo: 'ImportEvents',
    });

  const syncNow = async () => {
    setSyncing(true);
    setSyncNote('');
    try {
      const d = await backendJson<EbSync & { result: EbSyncResult }>(SYNC_API, { method: 'POST' });
      setSync({ connected: d.connected, auto_sync: d.auto_sync, last_synced_at: d.last_synced_at, last_sync_result: d.last_sync_result });
      const r = d.result;
      setSyncNote(
        !r?.ok
          ? t('organizerImport.syncFailed')
          : r.rate_limited
            ? t('organizerImport.syncLimited')
            : t((r.created || 0) + (r.updated || 0) === 1 ? 'organizerImport.syncDoneOne' : 'organizerImport.syncDoneOther', {
                count: (r.created || 0) + (r.updated || 0),
              })
      );
      loadEb();
    } catch (e: any) {
      setSyncNote(e?.status === 429 ? t('organizerImport.errors.rate_limited') : t('organizerImport.syncFailed'));
    } finally {
      setSyncing(false);
    }
  };

  const toggleAutoSync = async (on: boolean) => {
    setSync((s) => (s ? { ...s, auto_sync: on } : s));
    try {
      await backendJson(SYNC_API, { method: 'PATCH', body: JSON.stringify({ auto_sync: on }) });
    } catch {
      setSync((s) => (s ? { ...s, auto_sync: !on } : s));
    }
  };

  const fmt = (iso: string, withDay: boolean) => {
    try {
      return new Intl.DateTimeFormat(language || 'en', {
        ...(withDay ? { weekday: 'short' as const } : {}),
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(iso));
    } catch {
      return '';
    }
  };
  const priceOf = (f: Found) => (f.price == null ? '' : f.price === 0 ? t('common.free') : `${f.price} ${f.currency || ''}`.trim());
  const count = (one: string, other: string, n: number) => t(n === 1 ? one : other, { count: n });

  const toggle = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };

  const renderPickList = (
    items: Array<{ id: string; title: string; meta: string }>,
    sel: Set<string>,
    setSel: (s: Set<string>) => void
  ) => (
    <View>
      <View style={styles.listHead}>
        <Text style={styles.meta}>{count('organizerImport.foundOne', 'organizerImport.foundOther', items.length)}</Text>
        <Touchable
          onPress={() => setSel(sel.size === items.length ? new Set() : new Set(items.map((i) => i.id)))}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
        >
          <Text style={styles.linkText}>{sel.size === items.length ? t('organizerImport.selectNone') : t('organizerImport.selectAll')}</Text>
        </Touchable>
      </View>
      {items.map((it) => {
        const on = sel.has(it.id);
        return (
          <Touchable
            key={it.id}
            onPress={() => setSel(toggle(sel, it.id))}
            style={[styles.row, on && styles.rowOn]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
          >
            <View style={[styles.check, on && styles.checkOn]}>{on ? <Check size={14} color={T.onWhite} strokeWidth={3} /> : null}</View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {it.title}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {it.meta}
              </Text>
            </View>
          </Touchable>
        );
      })}
    </View>
  );

  const renderDone = (items: Created[]) => {
    const made = items.filter((d) => !d.skipped).length;
    return (
      <View>
        <Text style={[styles.meta, { marginBottom: 8 }]}>{count('organizerImport.draftsReadyOne', 'organizerImport.draftsReadyOther', made)}</Text>
        {items.map((d) => (
          <Touchable
            key={d.id}
            disabled={d.skipped}
            onPress={() => navigation.navigate('EditEvent', { eventId: d.id })}
            style={styles.row}
            accessibilityRole="button"
          >
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {d.title}
              </Text>
              {d.skipped ? (
                <Text style={styles.rowMeta}>{t('organizerImport.skipped')}</Text>
              ) : d.flags?.length ? (
                <View style={styles.flagRow}>
                  <View style={styles.flagDot} />
                  <Text style={[styles.rowMeta, { marginTop: 0, flex: 1 }]} numberOfLines={2}>
                    {d.flags.includes('currency_unsupported')
                      ? t('organizerImport.flagCurrency', { currency: d.sourceCurrency || '' })
                      : d.flags.includes('country_unsupported')
                        ? t('organizerImport.flagCountry')
                        : t('organizerImport.flagPrice')}
                  </Text>
                </View>
              ) : (
                <Text style={styles.rowMeta}>{t('organizerImport.draft')}</Text>
              )}
            </View>
            {!d.skipped ? <Text style={styles.linkText}>{t('organizerImport.review')}</Text> : null}
          </Touchable>
        ))}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <OrganizerScreenHeader title={t('organizerImport.title')} onBack={() => navigation.goBack()} />
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
        <Text style={styles.lede}>{t('organizerImport.lede')}</Text>

        <View style={styles.section}>
          <SectionHeader title={t('organizerImport.linkTitle')} subtitle={t('organizerImport.linkBody')} subtitleLines={2} />
          <View style={styles.inputRow}>
            <View style={styles.inputWrap}>
              <Link2 size={16} color={colors.textSecondary} />
              <TextInput
                value={url}
                onChangeText={setUrl}
                placeholder="https://www.eventbrite.com/e/…"
                placeholderTextColor={T.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="search"
                onSubmitEditing={find}
                style={styles.input}
                accessibilityLabel={t('organizerImport.linkLabel')}
              />
            </View>
            <WhitePillCTA size="sm" label={t('organizerImport.find')} onPress={find} loading={busy && !found} disabled={busy || !url.trim()} />
          </View>
          {!!error && <Text style={styles.error}>{error}</Text>}

          {done ? (
            <View style={{ marginTop: 20 }}>{renderDone(done)}</View>
          ) : found ? (
            <View style={{ marginTop: 20 }}>
              {renderPickList(
                found.map((f) => ({
                  id: f.uid,
                  title: f.title,
                  meta: [fmt(f.start, true), f.online ? t('organizerImport.online') : f.venue || f.city, priceOf(f)].filter(Boolean).join(' · '),
                })),
                picked,
                setPicked
              )}
              <WhitePillCTA
                size="sm"
                style={{ marginTop: 14 }}
                label={count('organizerImport.importOne', 'organizerImport.importOther', picked.size)}
                onPress={importNow}
                loading={busy}
                disabled={busy || picked.size === 0}
              />
            </View>
          ) : null}
        </View>

        {eb && eb.available ? (
          <View style={styles.section}>
            <SectionHeader
              title={t('organizerImport.ebTitle')}
              subtitle={eb.connected ? t('organizerImport.ebConnectedBody') : eb.expired ? t('organizerImport.reconnect') : t('organizerImport.connectLede')}
              subtitleLines={3}
              trailing={
                eb.connected ? (
                  <Touchable onPress={disconnectEb} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button">
                    <Text style={styles.quietText}>{t('organizerImport.disconnect')}</Text>
                  </Touchable>
                ) : undefined
              }
            />
            {!!ebNote && <Text style={styles.note}>{ebNote}</Text>}

            {!eb.connected ? (
              <WhitePillCTA size="sm" style={{ marginTop: 12 }} label={t('organizerImport.connectEventbrite')} onPress={connectEb} />
            ) : null}

            {eb.connected && sync?.connected ? (
              <View style={styles.syncCard}>
                <View style={styles.syncHead}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.rowTitle}>{t('organizerImport.syncTitle')}</Text>
                    <Text style={styles.rowMeta}>{t('organizerImport.syncHint')}</Text>
                  </View>
                  <Switch
                    value={sync.auto_sync}
                    onValueChange={toggleAutoSync}
                    trackColor={{ true: T.teal, false: T.surfaceRaised }}
                    thumbColor={T.white}
                    accessibilityLabel={t('organizerImport.syncTitle')}
                  />
                </View>
                <View style={styles.syncFoot}>
                  <Text style={[styles.rowMeta, { flex: 1, marginTop: 0 }]} numberOfLines={2}>
                    {syncNote ||
                      (sync.last_synced_at
                        ? t('organizerImport.lastSynced', { when: fmt(sync.last_synced_at, false) })
                        : t('organizerImport.neverSynced'))}
                  </Text>
                  <Touchable onPress={syncNow} disabled={syncing} style={styles.syncBtn} accessibilityRole="button">
                    {syncing ? <ActivityIndicator color={colors.text} size="small" /> : <Text style={styles.syncBtnText}>{t('organizerImport.syncNow')}</Text>}
                  </Touchable>
                </View>
              </View>
            ) : null}

            {eb.connected ? (
              <View style={{ marginTop: 20 }}>
                {ebDone ? (
                  renderDone(ebDone)
                ) : eb.events.length === 0 ? (
                  <Text style={styles.meta}>{t('organizerImport.noUpcoming')}</Text>
                ) : (
                  <>
                    <Text style={[styles.meta, { marginBottom: 10 }]}>{t('organizerImport.ebDraftsBody')}</Text>
                    {renderPickList(
                      eb.events.map((e) => ({
                        id: e.id,
                        title: e.title,
                        meta: [fmt(e.start, true), e.online ? t('organizerImport.online') : e.venue].filter(Boolean).join(' · '),
                      })),
                      ebPicked,
                      setEbPicked
                    )}
                    <WhitePillCTA
                      size="sm"
                      style={{ marginTop: 14 }}
                      label={count('organizerImport.importOne', 'organizerImport.importOther', ebPicked.size)}
                      onPress={importEb}
                      loading={ebBusy}
                      disabled={ebBusy || ebPicked.size === 0}
                    />
                    {!!ebError && <Text style={styles.error}>{ebError}</Text>}
                  </>
                )}
              </View>
            ) : null}
          </View>
        ) : !eb ? (
          <ActivityIndicator color={colors.textSecondary} style={{ marginTop: 28, alignSelf: 'flex-start' }} />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    lede: { fontSize: 15, lineHeight: 22, color: colors.textSecondary },
    section: { marginTop: 28 },
    inputRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
    inputWrap: {
      flex: 1,
      height: 40,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
    },
    input: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 0 },
    error: { marginTop: 10, fontSize: 13, color: T.red },
    note: { marginTop: 8, fontSize: 13, color: colors.textSecondary },
    meta: { fontSize: 13, color: colors.textSecondary },
    listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    linkText: { fontSize: 13, fontWeight: '600', color: colors.text },
    quietText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 11,
      marginBottom: 4,
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
    },
    rowOn: { backgroundColor: T.surfaceRaised },
    rowBody: { flex: 1, minWidth: 0 },
    rowTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
    rowMeta: { marginTop: 2, fontSize: 13, color: colors.textSecondary },
    check: { width: 20, height: 20, borderRadius: radius.sm, backgroundColor: T.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
    checkOn: { backgroundColor: T.white },
    flagRow: { marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 6 },
    flagDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.amber },
    syncCard: { marginTop: 14, padding: 14, borderRadius: radius.sm, backgroundColor: colors.surface },
    syncHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    syncFoot: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
    syncBtn: { minWidth: 96, height: 36, paddingHorizontal: 14, borderRadius: radius.sm, backgroundColor: T.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
    syncBtnText: { fontSize: 13, fontWeight: '600', color: colors.text },
  });
