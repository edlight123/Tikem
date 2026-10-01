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
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Megaphone } from 'lucide-react-native';
import { useAppAlert } from '../../components/AppAlert';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { RADIUS } from '../../config/brand';
import { Skeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import WhitePillCTA from '../../components/WhitePillCTA';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import InfoNotice from '../../components/organizer/InfoNotice';
import { getEventById } from '../../lib/api/organizer';
import { backendJson } from '../../lib/api/backend';
import { formatCurrency } from '../../lib/currency';
import { formatConversion } from '../../lib/attribution';

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
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: headerH }]}>
          <Skeleton width="100%" height={64} radius={RADIUS.md} />
          <View style={styles.formCard}>
            <Skeleton width={150} height={16} radius={6} />
            {[0, 1, 2].map((i) => (
              <View key={i}>
                <Skeleton width={110} height={12} radius={5} style={{ marginTop: 14, marginBottom: 6 }} />
                <Skeleton width="100%" height={45} radius={RADIUS.md} />
              </View>
            ))}
            <Skeleton width="100%" height={48} radius={999} style={{ marginTop: 20 }} />
          </View>
          <View style={styles.section}>
            <Skeleton width={140} height={18} radius={6} style={{ marginBottom: 12 }} />
            {[0, 1].map((i) => (
              <View key={i} style={styles.promoterCard}>
                <Skeleton width="55%" height={15} radius={6} />
                <Skeleton width="40%" height={13} radius={5} style={{ marginTop: 10 }} />
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <OrganizerScreenHeader
        title={t('organizerPromoters.title')}
        subtitle={eventTitle || undefined}
        onBack={() => navigation.goBack()}
        overlay
        onHeight={onHeight}
      />
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: headerH }]}
        keyboardShouldPersistTaps="handled"
      >
        <InfoNotice text={t('organizerPromoters.infoNotice')} />

        {/* Create form */}
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>{t('organizerPromoters.formTitle')}</Text>

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
            <WhitePillCTA
              label={submitting ? t('organizerPromoters.creating') : t('organizerPromoters.create')}
              onPress={handleCreate}
              loading={submitting}
              disabled={submitting}
            />
          </View>
        </View>

        {/* Promoter list */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('organizerPromoters.listTitle')}</Text>
          {promoters.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title={t('organizerPromoters.empty')}
              subtitle={t('organizerPromoters.emptySubtitle')}
              compact
            />
          ) : (
            promoters.map((p) => (
              <View key={p.id} style={styles.promoterCard}>
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
                    <View style={[styles.statusDot, { backgroundColor: p.isActive ? colors.success : colors.textTertiary }]} />
                    <Text style={styles.statusText}>
                      {p.isActive ? t('organizerPromoters.active') : t('organizerPromoters.paused')}
                    </Text>
                  </View>
                </View>

                <View style={styles.statsRow}>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{p.ticketsSold}</Text>
                    <Text style={styles.statLabel}>{t('organizerPromoters.stats.tickets')}</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{fmtMoney(p.grossCents, p.currency)}</Text>
                    <Text style={styles.statLabel}>{t('organizerPromoters.stats.sales')}</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{fmtMoney(p.commissionCents, p.currency)}</Text>
                    <Text style={styles.statLabel}>{t('organizerPromoters.stats.owed')}</Text>
                  </View>
                </View>

                {/* Funnel: link visits → orders. */}
                <View style={styles.funnelRow}>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{p.clicks || 0}</Text>
                    <Text style={styles.statLabel}>{t('organizerPromoters.stats.clicks')}</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{p.ordersCount}</Text>
                    <Text style={styles.statLabel}>{t('organizerPromoters.stats.orders')}</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{formatConversion(p.ordersCount, p.clicks || 0)}</Text>
                    <Text style={styles.statLabel}>{t('organizerPromoters.stats.conversion')}</Text>
                  </View>
                </View>

                <View style={styles.actionsRow}>
                  <TouchableOpacity style={styles.actionButton} onPress={() => handleSend(p)}>
                    <Text style={styles.actionText}>{t('organizerPromoters.sendLink')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionButton} onPress={() => handleToggle(p)}>
                    <Text style={styles.actionText}>
                      {p.isActive ? t('organizerPromoters.pause') : t('organizerPromoters.resume')}
                    </Text>
                  </TouchableOpacity>
                  {p.ordersCount === 0 && (
                    <TouchableOpacity style={styles.actionButton} onPress={() => handleDelete(p)}>
                      <Text style={[styles.actionText, { color: colors.error }]}>{t('organizerPromoters.delete.confirm')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))
          )}
        </View>

        <Text style={styles.footNote}>{t('organizerPromoters.footNote')}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      padding: 20,
      paddingBottom: 40,
    },
    formCard: {
      backgroundColor: colors.surface,
      borderRadius: RADIUS.xl,
      padding: 16,
      marginTop: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    formTitle: {
      fontSize: 16,
      fontWeight: 'bold',
      color: colors.text,
      marginBottom: 4,
    },
    label: {
      marginTop: 14,
      marginBottom: 6,
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    input: {
      backgroundColor: colors.background,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 12,
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
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    typeOption: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 8,
      alignItems: 'center',
      backgroundColor: colors.background,
    },
    typeOptionActive: {
      backgroundColor: colors.surfaceRaised,
    },
    typeOptionText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    typeOptionTextActive: {
      color: colors.text,
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
    promoterCard: {
      backgroundColor: colors.surface,
      borderRadius: RADIUS.xl,
      padding: 14,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
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
      fontSize: 16,
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
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    funnelRow: {
      flexDirection: 'row',
      marginTop: 10,
      paddingVertical: 10,
      borderRadius: RADIUS.md,
      backgroundColor: colors.surfaceRaised,
    },
    stat: {
      flex: 1,
      alignItems: 'center',
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
    actionButton: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    actionText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.text,
    },
    footNote: {
      marginTop: 20,
      fontSize: 12,
      lineHeight: 18,
      color: colors.textTertiary,
      textAlign: 'center',
    },
  });
