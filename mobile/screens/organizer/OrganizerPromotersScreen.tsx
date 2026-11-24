// Per-event promoters: personal sales links for the street team, with the
// commission owed to each tallied from the server-only promoter_sales ledger.
//
// Unlike promo codes, this screen does NOT write Firestore directly: a promoter's
// stats link is HMAC-derived from a server secret, so records must be created
// through /api/organizer/events/{id}/promoters (backendJson attaches the
// organizer's Firebase token). Counters are read-only everywhere but fulfillment.

import React, { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Megaphone, Plus, X } from 'lucide-react-native';
import SectionHeader from '../../components/SectionHeader';
import PromoteTabs from '../../components/organizer/PromoteTabs';
import { ListGroup, ListRow } from '../../components/ui/ListRow';
import { colors as T, font, spacing } from '../../theme/tokens';
import { useAppAlert } from '../../components/AppAlert';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { RADIUS } from '../../config/brand';
import { Skeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import WhitePillCTA from '../../components/WhitePillCTA';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import { getEventById } from '../../lib/api/organizer';
import { backendJson } from '../../lib/api/backend';
import { formatCurrency } from '../../lib/currency';
import { formatConversion } from '../../lib/attribution';

import { Touchable } from '../../components/ui/Touchable';
type RouteParams = {
  OrganizerPromoters: {
    eventId: string;
  };
};

type Promoter = {
  id: string;
  code: string;
  name: string;
  contact: string | null;
  commissionType: 'percentage' | 'flat_per_ticket';
  commissionValue: number;
  isActive: boolean;
  ticketsSold: number;
  ordersCount: number;
  /** Link visits (deduped per device / browser per 30 minutes). */
  clicks: number;
  grossCents: number;
  commissionCents: number;
  currency: string;
  shareUrl: string;
  statsUrl: string;
};

function suggestCode(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toUpperCase()
    .slice(0, 12);
}

export default function OrganizerPromotersScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const route = useRoute<RouteProp<RouteParams, 'OrganizerPromoters'>>();
  const navigation = useNavigation<any>();
  const { eventId } = route.params;
  const { height: headerH, onHeight } = useOverlayHeaderInset();

  const { t } = useI18n();
  const showAlert = useAppAlert();

  const [eventTitle, setEventTitle] = useState('');
  const [eventCurrency, setEventCurrency] = useState('HTG');
  const [promoters, setPromoters] = useState<Promoter[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [commissionType, setCommissionType] = useState<'percentage' | 'flat_per_ticket'>('percentage');
  const [commissionValue, setCommissionValue] = useState('10');
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [event, data] = await Promise.all([
        getEventById(eventId),
        backendJson<{ promoters: Promoter[] }>(`/api/organizer/events/${eventId}/promoters`),
      ]);
      setEventTitle(event?.title || '');
      setEventCurrency(String(event?.currency || 'HTG').toUpperCase());
      setPromoters(data.promoters || []);
    } catch {
      showAlert(t('common.error'), t('organizerPromoters.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [eventId, showAlert, t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const fmtMoney = (cents: number, currency: string) => formatCurrency(cents / 100, currency);

  const commissionLabel = (p: Promoter) =>
    p.commissionType === 'flat_per_ticket'
      ? t('organizerPromoters.commissionFlat').replace('{amount}', fmtMoney(p.commissionValue, p.currency))
      : t('organizerPromoters.commissionPercent').replace('{value}', String(p.commissionValue));

  const handleCreate = async () => {
    setError(null);
    if (!name.trim()) {
      setError(t('organizerPromoters.errors.nameRequired'));
      return;
    }
    const value = Number(commissionValue);
    if (!Number.isFinite(value) || value < 0) {
      setError(t('organizerPromoters.errors.commissionInvalid'));
      return;
    }
    setSubmitting(true);
    try {
      const data = await backendJson<{ promoter: Promoter }>(
        `/api/organizer/events/${eventId}/promoters`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim(),
            contact: contact.trim(),
            code: (code || suggestCode(name)).trim(),
            commissionType,
            commissionValue: value,
          }),
        }
      );
      setPromoters((prev) => [data.promoter, ...prev]);
      setFormOpen(false);
      setName('');
      setContact('');
      setCode('');
      setCodeTouched(false);
      setCommissionValue('10');
      setCommissionType('percentage');
      // The stats link is the promoter's whole toolkit — offer to send it now.
      showAlert(t('organizerPromoters.createdTitle'), t('organizerPromoters.createdMessage'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('organizerPromoters.sendLink'), onPress: () => handleSend(data.promoter) },
      ]);
    } catch (err: any) {
      setError(err?.message || t('organizerPromoters.errors.createFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSend = async (p: Promoter) => {
    const message = t('organizerPromoters.shareMessage')
      .replace('{name}', p.name)
      .replace('{event}', eventTitle || t('common.event'))
      .replace('{shareUrl}', p.shareUrl)
      .replace('{statsUrl}', p.statsUrl);
    try {
      await Share.share({ message });
    } catch {
      // Share sheet dismissed / unavailable — nothing to surface.
    }
  };

  const handleToggle = async (p: Promoter) => {
    try {
      await backendJson(`/api/organizer/events/${eventId}/promoters/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !p.isActive }),
      });
      setPromoters((prev) => prev.map((x) => (x.id === p.id ? { ...x, isActive: !p.isActive } : x)));
    } catch {
      showAlert(t('common.error'), t('organizerPromoters.errors.updateFailed'));
    }
  };

  const handleDelete = (p: Promoter) => {
    showAlert(t('organizerPromoters.delete.title'), t('organizerPromoters.delete.message'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('organizerPromoters.delete.confirm'),
        style: 'destructive',
        onPress: async () => {
          try {
            await backendJson(`/api/organizer/events/${eventId}/promoters/${p.id}`, {
              method: 'DELETE',
            });
            setPromoters((prev) => prev.filter((x) => x.id !== p.id));
          } catch {
            showAlert(t('common.error'), t('organizerPromoters.errors.deleteFailed'));
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <OrganizerScreenHeader
          title={t('organizerPromoters.title')}
          onBack={() => navigation.goBack()}
          overlay
          onHeight={onHeight}
        />
        <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={[styles.scrollContent, { paddingTop: headerH + spacing.lg }]}>
          <Skeleton width="100%" height={52} radius={RADIUS.md} />
          <View style={styles.section}>
            {[0, 1].map((i) => (
              <View key={i} style={[styles.promoterRow, i === 0 && styles.promoterRowFirst]}>
                <Skeleton width="55%" height={15} radius={4} />
                <Skeleton width="40%" height={13} radius={4} style={{ marginTop: 10 }} />
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }

  const form = (
    <>
      <Text style={styles.label}>{t('organizerPromoters.fields.name')}</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={(v) => {
          setName(v);
          if (!codeTouched) setCode(suggestCode(v));
        }}
        placeholder={t('organizerPromoters.placeholders.name')}
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.primary}
        autoFocus
      />

      <Text style={styles.label}>{t('organizerPromoters.fields.contact')}</Text>
      <TextInput
        style={styles.input}
        value={contact}
        onChangeText={setContact}
        placeholder={t('organizerPromoters.placeholders.contact')}
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.primary}
        autoCapitalize="none"
      />

      <Text style={styles.label}>{t('organizerPromoters.fields.code')}</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={(v) => {
          setCodeTouched(true);
          setCode(v.toUpperCase());
        }}
        placeholder={t('organizerPromoters.placeholders.code')}
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.primary}
        autoCapitalize="characters"
        autoCorrect={false}
      />

      <Text style={styles.label}>{t('organizerPromoters.fields.commission')}</Text>
      <View style={styles.commissionRow}>
        <TextInput
          style={[styles.input, styles.commissionInput]}
          value={commissionValue}
          onChangeText={setCommissionValue}
          keyboardType="numeric"
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.primary}
        />
        <View style={styles.typeToggle}>
          {(
            [
              ['percentage', t('organizerPromoters.types.percentage')],
              ['flat_per_ticket', t('organizerPromoters.types.flat').replace('{currency}', eventCurrency)],
            ] as const
          ).map(([value, label]) => (
            <TouchableOpacity
              key={value}
              style={[styles.typeOption, commissionType === value && styles.typeOptionActive]}
              onPress={() => setCommissionType(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: commissionType === value }}
            >
              <Text
                style={[styles.typeOptionText, commissionType === value && styles.typeOptionTextActive]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {!!error && <Text style={styles.errorText}>{error}</Text>}

      <View style={styles.submitWrap}>
        <WhitePillCTA size="sm"
          label={submitting ? t('organizerPromoters.creating') : t('organizerPromoters.create')}
          onPress={handleCreate}
          loading={submitting}
          disabled={submitting}
        />
      </View>
    </>
  );

  return (
    <View style={styles.container}>
      <OrganizerScreenHeader
        title={t('organizerPromoters.title')}
        subtitle={eventTitle || undefined}
        onBack={() => navigation.goBack()}
        overlay
        onHeight={onHeight}
      />
      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={[styles.scrollContent, { paddingTop: headerH + spacing.lg }]}>
        <PromoteTabs active="promoters" eventId={eventId} />
        {promoters.length === 0 ? (
          <EmptyState
            variant="panel"
            icon={Megaphone}
            title={t('organizerPromoters.empty')}
            actionLabel={t('organizerPromoters.formTitle')}
            onAction={() => setFormOpen(true)}
          />
        ) : (
          <>
            {/* The list comes first; adding is one row that opens a sheet
                (the always-open form card read heavy). */}
            <ListGroup>
              <ListRow icon={Plus} title={t('organizerPromoters.formTitle')} onPress={() => setFormOpen(true)} />
            </ListGroup>

            <View style={styles.section}>
              <SectionHeader title={t('organizerPromoters.listTitle').toLowerCase()} />
              {promoters.map((p, i) => (
                <View key={p.id} style={[styles.promoterRow, i === 0 && styles.promoterRowFirst]}>
                  <View style={styles.promoterHeader}>
                    <View style={styles.promoterHeaderLeft}>
                      <Text style={styles.promoterName} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text style={styles.promoterMeta} numberOfLines={1}>
                        {p.code} · {commissionLabel(p)}
                      </Text>
                    </View>
                    <View style={styles.statusWrap}>
                      <View
                        style={[styles.statusDot, { backgroundColor: p.isActive ? colors.success : colors.textTertiary }]}
                      />
                      <Text style={styles.statusText}>
                        {p.isActive ? t('organizerPromoters.active') : t('organizerPromoters.paused')}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.statsRow}>
                    {[
                      [String(p.ticketsSold), t('organizerPromoters.stats.tickets')],
                      [fmtMoney(p.grossCents, p.currency), t('organizerPromoters.stats.sales')],
                      [fmtMoney(p.commissionCents, p.currency), t('organizerPromoters.stats.owed')],
                    ].map(([v, l]) => (
                      <View key={l} style={styles.stat}>
                        <Text style={styles.statValue} numberOfLines={1}>{v}</Text>
                        <Text style={styles.statLabel} numberOfLines={1}>{l}</Text>
                      </View>
                    ))}
                  </View>
                  {/* Funnel in one quiet line: link visits → orders. */}
                  <Text style={styles.funnelLine} numberOfLines={1}>
                    {`${p.clicks || 0} ${t('organizerPromoters.stats.clicks').toLowerCase()} · ${p.ordersCount} ${t(
                      'organizerPromoters.stats.orders'
                    ).toLowerCase()} · ${formatConversion(p.ordersCount, p.clicks || 0)}`}
                  </Text>

                  <View style={styles.actionsRow}>
                    <Touchable style={[styles.actionButton, styles.actionPrimary]} onPress={() => handleSend(p)}>
                      <Text style={[styles.actionText, styles.actionPrimaryText]}>{t('organizerPromoters.sendLink')}</Text>
                    </Touchable>
                    <Touchable style={styles.actionButton} onPress={() => handleToggle(p)}>
                      <Text style={styles.actionText}>
                        {p.isActive ? t('organizerPromoters.pause') : t('organizerPromoters.resume')}
                      </Text>
                    </Touchable>
                    {p.ordersCount === 0 && (
                      <Touchable style={styles.actionButton} onPress={() => handleDelete(p)}>
                        <Text style={[styles.actionText, { color: colors.error }]}>
                          {t('organizerPromoters.delete.confirm')}
                        </Text>
                      </Touchable>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <Modal
        visible={formOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setFormOpen(false)}
      >
        <KeyboardAvoidingView style={styles.sheet} behavior="padding">
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{t('organizerPromoters.formTitle').toLowerCase()}</Text>
            <Touchable
              onPress={() => setFormOpen(false)}
              style={styles.sheetClose}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <X size={20} color={colors.text} />
            </Touchable>
          </View>
          <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            {form}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    // Same gutter as Tracking links (16pt): the shared Promoters | Tracking
    // links tab bar must not jump sideways when switching tabs.
    scrollContent: {
      paddingHorizontal: spacing.lg,
      paddingBottom: 40,
    },
    sheet: { flex: 1, backgroundColor: colors.background },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 6,
    },
    sheetTitle: { fontFamily: font.serif, fontSize: 28, color: colors.text },
    sheetClose: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: T.surfaceRaised,
    },
    sheetBody: { paddingHorizontal: 20, paddingBottom: 40 },
    // Uppercase eyebrow labels, the same as FormSheet's SheetLabel.
    label: {
      marginTop: 18,
      marginBottom: 8,
      fontSize: 11,
      lineHeight: 14,
      fontWeight: '600',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: colors.textSecondary,
    },
    // Fills, not bordered boxes.
    input: {
      backgroundColor: T.surface,
      borderRadius: RADIUS.md,
      paddingHorizontal: 14,
      paddingVertical: 13,
      fontSize: 16,
      color: colors.text,
    },
    commissionRow: {
      flexDirection: 'row',
      gap: 10,
      alignItems: 'center',
    },
    commissionInput: {
      width: 88,
    },
    typeToggle: {
      flex: 1,
      flexDirection: 'row',
      gap: 6,
    },
    typeOption: {
      flex: 1,
      paddingVertical: 13,
      paddingHorizontal: 8,
      alignItems: 'center',
      borderRadius: RADIUS.md,
      backgroundColor: T.surface,
    },
    typeOptionActive: {
      backgroundColor: T.white,
    },
    typeOptionText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    typeOptionTextActive: {
      color: T.onWhite,
    },
    errorText: {
      marginTop: 12,
      color: colors.error,
      fontSize: 13,
    },
    submitWrap: {
      marginTop: 20,
    },
    section: {
      marginTop: 28,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: colors.text,
      marginBottom: 12,
    },
    // A plain list: rows separated by a hairline, no bordered cards.
    promoterRow: {
      paddingVertical: 16,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    promoterRowFirst: { borderTopWidth: 0, paddingTop: 4 },
    promoterHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    promoterHeaderLeft: {
      flex: 1,
    },
    promoterName: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.text,
    },
    promoterMeta: {
      marginTop: 2,
      fontSize: 13,
      color: colors.textSecondary,
    },
    statusWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    statusDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    statusText: {
      fontSize: 11,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      color: colors.textSecondary,
    },
    statsRow: {
      flexDirection: 'row',
      marginTop: 14,
      gap: 12,
    },
    funnelLine: {
      marginTop: 10,
      fontSize: 13,
      color: colors.textSecondary,
    },
    stat: {
      flex: 1,
    },
    statValue: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    statLabel: {
      marginTop: 2,
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      color: colors.textTertiary,
    },
    actionsRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 12,
    },
    // Row actions match Tracking links: 36pt, 13pt semibold.
    actionButton: {
      height: 36,
      justifyContent: 'center',
      paddingHorizontal: 14,
      borderRadius: RADIUS.md,
      backgroundColor: T.surfaceRaised,
    },
    actionPrimary: { backgroundColor: T.white },
    actionPrimaryText: { color: T.onWhite },
    actionText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
  });
