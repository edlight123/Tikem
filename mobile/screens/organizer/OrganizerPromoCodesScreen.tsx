import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
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
import { useAppAlert } from '../../components/AppAlert';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { RADIUS } from '../../config/brand';
import { font, radius } from '../../theme/tokens';
import { formatCurrency } from '../../lib/currency';
import { safeFormatForLanguage } from '../../lib/dates';
import { Skeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import WhitePillCTA from '../../components/WhitePillCTA';
import SecondaryPill from '../../components/auth/SecondaryPill';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import SegmentedTabs from '../../components/organizer/SegmentedTabs';
import { Tag } from 'lucide-react-native';
import { getEventById } from '../../lib/api/organizer';

type RouteParams = {
  OrganizerPromoCodes: {
    eventId: string;
  };
};

type DiscountType = 'percentage' | 'fixed';
type LimitType = 'limited' | 'unlimited';

type PromoCodeDoc = {
  code: string;
  discount_type: DiscountType;
  discount_value: number;
  max_uses: number | null;
  uses_count: number;
  is_active: boolean;
  expires_at: string | Timestamp | null;
  event_id: string;
  organizer_id?: string | null;
};

type PromoCodeItem = PromoCodeDoc & { id: string };

function parseExpiresAt(value: PromoCodeDoc['expires_at']): Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function normalizeNumber(value: string): number | null {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export default function OrganizerPromoCodesScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const route = useRoute<RouteProp<RouteParams, 'OrganizerPromoCodes'>>();
  const navigation = useNavigation<any>();
  const { eventId } = route.params;
  const { height: headerH, onHeight } = useOverlayHeaderInset();

  // Hide the default native nav bar — this screen renders its own serif
  // OrganizerScreenHeader, so the native "‹ Manage Event / Promo Codes" bar
  // would double up on top of it.
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const { t, language } = useI18n();
  const showAlert = useAppAlert();
  const { userProfile } = useAuth();

  const locale = language === 'fr' ? 'fr-FR' : language === 'ht' ? 'fr-HT' : 'en-US';

  const [eventTitle, setEventTitle] = useState<string>('');
  const [eventCurrency, setEventCurrency] = useState<string>('HTG');
  // Full event doc kept around so the per-code share message can enrich itself
  // with the event's date + location (guarded — a sparse event still shares).
  const [eventData, setEventData] = useState<any>(null);
  const [promoCodes, setPromoCodes] = useState<PromoCodeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Active vs Expired list filter — "expired" collects everything no longer
  // claimable: past expiry, fully claimed, or deactivated.
  const [listTab, setListTab] = useState<'active' | 'expired'>('active');

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<DiscountType>('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [limitType, setLimitType] = useState<LimitType>('unlimited');
  const [maxUses, setMaxUses] = useState('');
  // Expiry is optional; null means "no expiry". Stored as a Date, serialized to
  // an ISO string on create (the shape the create logic already expects).
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [showExpiryPicker, setShowExpiryPicker] = useState(false);

  const promoCodesCollection = useMemo(() => collection(db, 'promo_codes'), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [event, promos] = await Promise.all([
        getEventById(eventId),
        (async () => {
          const q = query(promoCodesCollection, where('event_id', '==', eventId));
          const snap = await getDocs(q);
          const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as PromoCodeDoc) }));
          rows.sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
          return rows as PromoCodeItem[];
        })(),
      ]);

      setEventTitle(event?.title || '');
      setEventCurrency(event?.currency || 'HTG');
      setEventData(event || null);
      setPromoCodes(promos);
    } catch (e) {
      console.error('Failed to load promo codes', e);
      showAlert(t('common.error'), t('organizerPromoCodes.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [eventId, promoCodesCollection, t]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const resetForm = () => {
    setCode('');
    setDiscountType('percentage');
    setDiscountValue('');
    setLimitType('unlimited');
    setMaxUses('');
    setExpiresAt(null);
    setShowExpiryPicker(false);
  };

  // Native date picker → store the picked Date (or dismiss). Mirrors the
  // iOS-keeps-open / Android-closes handling from components/EventFiltersSheet.tsx.
  const handleExpiryChange = (event: any, selectedDate?: Date) => {
    setShowExpiryPicker(Platform.OS === 'ios');
    if (event?.type === 'set' && selectedDate) {
      setExpiresAt(selectedDate);
    }
    if (Platform.OS === 'android') {
      setShowExpiryPicker(false);
    }
  };

  const handleCreate = async () => {
    const trimmedCode = (code || '').trim().toUpperCase();
    const discount = normalizeNumber(discountValue);
    const maxUsesNum = normalizeNumber(maxUses);

    if (!trimmedCode || discount === null) {
      showAlert(t('common.error'), t('organizerPromoCodes.errors.missingFields'));
      return;
    }

    if (discount <= 0) {
      showAlert(t('common.error'), t('organizerPromoCodes.errors.invalidDiscount'));
      return;
    }

    // "Limited quantity" means the code is capped at the first N buyers; an
    // unlimited code never carries a cap (max_uses stays null).
    if (limitType === 'limited' && (maxUsesNum === null || maxUsesNum < 1)) {
      showAlert(t('common.error'), t('organizerPromoCodes.errors.invalidMaxUses'));
      return;
    }
    const finalMaxUses = limitType === 'limited' ? maxUsesNum : null;

    const expiresAtValue: string | null =
      expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.toISOString() : null;

    const exists = promoCodes.some((p) => String(p.code || '').toUpperCase() === trimmedCode);
    if (exists) {
      showAlert(t('common.error'), t('organizerPromoCodes.errors.duplicateCode'));
      return;
    }

    setSaving(true);
    try {
      await addDoc(promoCodesCollection, {
        code: trimmedCode,
        event_id: eventId,
        // The event's org (a team member creates codes for the org, not themselves).
        organizer_id: (eventData as any)?.organizer_id || userProfile?.id || null,
        created_by: userProfile?.id || null,
        discount_type: discountType,
        discount_value: discount,
        max_uses: finalMaxUses,
        expires_at: expiresAtValue,
        is_active: true,
        uses_count: 0,
        created_at: new Date().toISOString(),
      } as any);

      resetForm();
      setShowForm(false);
      await load();
    } catch (e) {
      console.error('Failed to create promo code', e);
      showAlert(t('common.error'), t('organizerPromoCodes.errors.createFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (promo: PromoCodeItem) => {
    try {
      await updateDoc(doc(db, 'promo_codes', promo.id), { is_active: !promo.is_active });
      setPromoCodes((prev) => prev.map((p) => (p.id === promo.id ? { ...p, is_active: !promo.is_active } : p)));
    } catch (e) {
      console.error('Failed to toggle promo code', e);
      showAlert(t('common.error'), t('organizerPromoCodes.errors.updateFailed'));
    }
  };

  const handleDelete = async (promo: PromoCodeItem) => {
    showAlert(t('organizerPromoCodes.delete.title'), t('organizerPromoCodes.delete.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('organizerPromoCodes.delete.confirm'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDoc(doc(db, 'promo_codes', promo.id));
            setPromoCodes((prev) => prev.filter((p) => p.id !== promo.id));
          } catch (e) {
            console.error('Failed to delete promo code', e);
            showAlert(t('common.error'), t('organizerPromoCodes.errors.deleteFailed'));
          }
        },
      },
    ]);
  };

  // The discount as a short, human fragment: "20% off" / "500.00 HTG off".
  const discountFragment = (promo: PromoCodeItem) => {
    if (promo.discount_type === 'percentage') {
      return t('organizerPromoCodes.share.percentOff').replace('{value}', String(promo.discount_value));
    }
    const amount = formatCurrency(promo.discount_value, eventCurrency);
    return t('organizerPromoCodes.share.amountOff').replace('{amount}', amount);
  };

  const handleShare = async (promo: PromoCodeItem) => {
    const discount = discountFragment(promo);
    const capped = promo.max_uses != null && promo.max_uses > 0;
    const atClause = eventTitle
      ? t('organizerPromoCodes.share.atEvent').replace('{event}', eventTitle)
      : '';
    const template = capped
      ? t('organizerPromoCodes.share.blurbFirstN')
      : t('organizerPromoCodes.share.blurbOpen');
    const promoLine = template
      .replace('{code}', String(promo.code || '').toUpperCase())
      .replace('{discount}', discount)
      .replace('{at}', atClause)
      .replace('{n}', String(promo.max_uses ?? ''));

    // Enrich with the event's own date · location, each part guarded so a sparse
    // event still shares cleanly.
    const when = eventData?.start_datetime
      ? safeFormatForLanguage(eventData.start_datetime, 'EEE, MMM d · h:mm a', language)
      : '';
    const whereRaw = [eventData?.venue_name, eventData?.city, eventData?.location].find(
      (v) => typeof v === 'string' && v.trim().length > 0
    );
    const where = typeof whereRaw === 'string' ? whereRaw.trim() : '';
    const meta = [when, where].filter(Boolean).join(' · ');

    // The canonical tikem.co event URL. Passed as Share's `url` too so iMessage /
    // WhatsApp render a rich Open Graph preview (this is how the event poster
    // surfaces in the share — the image can't be attached as bytes).
    const url = `https://www.tikem.co/events/${eventId}`;

    const body = [promoLine, meta].filter(Boolean).join('\n');

    try {
      if (Platform.OS === 'ios') {
        // iOS attaches `url` as its own rich-preview bubble (that's what renders
        // the event poster via Open Graph) — putting it in the message too made
        // the link appear twice AND suppressed the preview card.
        await Share.share({ message: body, url });
      } else {
        // Android ignores `url`, so the link must live in the message.
        await Share.share({ message: `${body}\n\n${url}` });
      }
    } catch (e) {
      console.warn('[promo-share] Share failed:', e);
    }
  };

  const renderDiscount = (promo: PromoCodeItem) => {
    if (promo.discount_type === 'percentage') {
      return `-${promo.discount_value}%`;
    }
    return `-${formatCurrency(promo.discount_value, eventCurrency)}`;
  };

  // A code is "expired" once it can no longer be claimed: past its expiry date,
  // fully claimed, or manually deactivated.
  const isExpired = useCallback((promo: PromoCodeItem) => {
    const expiry = parseExpiresAt(promo.expires_at);
    const past = expiry != null && expiry.getTime() < Date.now();
    const fullyClaimed =
      promo.max_uses != null && promo.max_uses > 0 && (promo.uses_count || 0) >= promo.max_uses;
    return past || fullyClaimed || !promo.is_active;
  }, []);

  const activeCodes = useMemo(() => promoCodes.filter((p) => !isExpired(p)), [promoCodes, isExpired]);
  const expiredCodes = useMemo(() => promoCodes.filter((p) => isExpired(p)), [promoCodes, isExpired]);
  const visibleCodes = listTab === 'active' ? activeCodes : expiredCodes;

  if (loading) {
    return (
      <View style={styles.container}>
        {/* Same overlay header as the loaded branch so the chrome doesn't jump
            from an in-flow bar to a floating blur when data lands. */}
        <OrganizerScreenHeader
          title={t('organizerPromoCodes.title')}
          subtitle={eventTitle || undefined}
          onBack={() => navigation.goBack()}
          overlay
          onHeight={onHeight}
        />
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: headerH }]}>
          <View style={styles.section}>
            {/* Section label + "New code" pill on one row, like the loaded list. */}
            <View style={styles.sectionTitleRow}>
              <Skeleton width={110} height={12} radius={4} />
              <Skeleton width={104} height={32} radius={radius.button} />
            </View>
            {/* Active / Expired segmented pills. */}
            <View style={[styles.tabsWrap, styles.tabsSkeletonRow]}>
              <Skeleton width={96} height={35} radius={4} />
              <Skeleton width={96} height={35} radius={4} />
            </View>
            {/* Compact promo cards: code+discount header row, claimed/expiry meta. */}
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.promoCard}>
                <View style={styles.promoHeader}>
                  <Skeleton width={130} height={17} radius={4} />
                  <Skeleton width={44} height={15} radius={4} />
                </View>
                <View style={styles.promoSkeletonMetaRow}>
                  <Skeleton width={96} height={12} radius={4} />
                  <Skeleton width={72} height={12} radius={4} />
                </View>
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
        title={t('organizerPromoCodes.title')}
        subtitle={eventTitle || undefined}
        onBack={() => navigation.goBack()}
        overlay
        onHeight={onHeight}
      />
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: headerH }]}
        keyboardShouldPersistTaps="handled"
      >
        {showForm && (
            <View style={styles.formCard}>
              <Text style={styles.formEyebrow}>{t('organizerPromoCodes.create.eyebrow')}</Text>
              <Text style={styles.formTitle}>{t('organizerPromoCodes.create.title')}</Text>

              <Text style={styles.label}>{t('organizerPromoCodes.fields.code')}</Text>
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={setCode}
                autoCapitalize="characters"
                placeholder={t('organizerPromoCodes.placeholders.code')}
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
              />

              <Text style={styles.label}>{t('organizerPromoCodes.fields.discountType')}</Text>
              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[styles.toggleButton, discountType === 'percentage' && styles.toggleButtonActive]}
                  onPress={() => setDiscountType('percentage')}
                >
                  <Text style={[styles.toggleButtonText, discountType === 'percentage' && styles.toggleButtonTextActive]}>
                    {t('organizerPromoCodes.discountTypes.percentage')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleButton, discountType === 'fixed' && styles.toggleButtonActive]}
                  onPress={() => setDiscountType('fixed')}
                >
                  <Text style={[styles.toggleButtonText, discountType === 'fixed' && styles.toggleButtonTextActive]}>
                    {t('organizerPromoCodes.discountTypes.fixed')}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>{t('organizerPromoCodes.fields.discountValue')}</Text>
              <TextInput
                style={styles.input}
                value={discountValue}
                onChangeText={setDiscountValue}
                keyboardType="numeric"
                placeholder={t('organizerPromoCodes.placeholders.discountValue')}
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
              />

              <Text style={styles.label}>{t('organizerPromoCodes.fields.quantity')}</Text>
              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[styles.toggleButton, limitType === 'unlimited' && styles.toggleButtonActive]}
                  onPress={() => setLimitType('unlimited')}
                >
                  <Text style={[styles.toggleButtonText, limitType === 'unlimited' && styles.toggleButtonTextActive]}>
                    {t('organizerPromoCodes.limitTypes.unlimited')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleButton, limitType === 'limited' && styles.toggleButtonActive]}
                  onPress={() => setLimitType('limited')}
                >
                  <Text style={[styles.toggleButtonText, limitType === 'limited' && styles.toggleButtonTextActive]}>
                    {t('organizerPromoCodes.limitTypes.limited')}
                  </Text>
                </TouchableOpacity>
              </View>

              {limitType === 'limited' && (
                <>
                  <TextInput
                    style={[styles.input, styles.inputSpaced]}
                    value={maxUses}
                    onChangeText={setMaxUses}
                    keyboardType="numeric"
                    placeholder={t('organizerPromoCodes.placeholders.quantity')}
                    placeholderTextColor={colors.textTertiary}
                    selectionColor={colors.primary}
                  />
                  <Text style={styles.helperText}>
                    {t('organizerPromoCodes.create.limitHelper').replace('{n}', (maxUses || '200').trim())}
                  </Text>
                </>
              )}

              <Text style={styles.label}>{t('organizerPromoCodes.fields.expiresAt')}</Text>
              <View style={styles.dateFieldRow}>
                <TouchableOpacity
                  style={styles.dateField}
                  onPress={() => setShowExpiryPicker(true)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.dateFieldText, !expiresAt && styles.dateFieldPlaceholder]}>
                    {expiresAt
                      ? safeFormatForLanguage(expiresAt, 'EEE, MMM d, yyyy', language)
                      : t('organizerPromoCodes.placeholders.expiresAt')}
                  </Text>
                  <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
                {expiresAt ? (
                  <TouchableOpacity
                    style={styles.dateClearButton}
                    onPress={() => setExpiresAt(null)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel={t('common.remove')}
                  >
                    <Ionicons name="close" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                ) : null}
              </View>
              {showExpiryPicker && (
                <DateTimePicker
                  value={expiresAt || new Date()}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={handleExpiryChange}
                  minimumDate={new Date()}
                />
              )}

              <View style={styles.formActions}>
                <SecondaryPill
                  style={styles.formActionPill}
                  label={t('common.cancel')}
                  onPress={() => {
                    resetForm();
                    setShowForm(false);
                  }}
                  disabled={saving}
                />
                <WhitePillCTA
                  style={styles.formActionPill}
                  label={saving ? t('organizerPromoCodes.create.creating') : t('organizerPromoCodes.create.create')}
                  onPress={handleCreate}
                  loading={saving}
                  disabled={saving}
                />
              </View>
            </View>
        )}

        <View style={styles.section}>
          {/* Section label row with the create action beside it (moved down from
              the screen header per beta feedback). */}
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>{t('organizerPromoCodes.list.title')}</Text>
            {!showForm && (
              <TouchableOpacity
                style={styles.newCodeButton}
                onPress={() => setShowForm(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={t('organizerPromoCodes.create.show')}
              >
                <Ionicons name="add" size={16} color={colors.text} />
                <Text style={styles.newCodeButtonText}>{t('organizerPromoCodes.create.show')}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Active / Expired filter — past discounts stay reachable without
              stretching the default list. */}
          {promoCodes.length > 0 && (
            <View style={styles.tabsWrap}>
              <SegmentedTabs
                tabs={[
                  { key: 'active', label: t('organizerPromoCodes.tabs.active'), count: activeCodes.length },
                  { key: 'expired', label: t('organizerPromoCodes.tabs.expired'), count: expiredCodes.length },
                ]}
                value={listTab}
                onChange={(key) => setListTab(key as 'active' | 'expired')}
              />
            </View>
          )}

          {promoCodes.length === 0 ? (
            <EmptyState icon={Tag} title={t('organizerPromoCodes.list.empty')} compact />
          ) : visibleCodes.length === 0 ? (
            <EmptyState
              icon={Tag}
              title={
                listTab === 'active'
                  ? t('organizerPromoCodes.list.emptyActive')
                  : t('organizerPromoCodes.list.emptyExpired')
              }
              compact
            />
          ) : (
            visibleCodes.map((promo) => {
              const expiry = parseExpiresAt(promo.expires_at);
              const expiryText = expiry
                ? expiry.toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
                : null;

              const used = promo.uses_count || 0;
              const cap = promo.max_uses;
              const capped = cap != null && cap > 0;
              const fullyClaimed = capped && used >= (cap as number);
              const pct = capped ? Math.min(100, Math.round((used / (cap as number)) * 100)) : 0;

              const claimedText = capped
                ? t('organizerPromoCodes.list.claimed')
                    .replace('{used}', String(used))
                    .replace('{total}', String(cap))
                : t('organizerPromoCodes.list.used').replace('{used}', String(used));

              // Compact card (tester: "at most 2/3 of the height"): discount sits
              // inline with the code, claimed + expiry share one meta line, and
              // the toggle is an inline text action instead of a tall button.
              return (
                <View key={promo.id} style={[styles.promoCard, fullyClaimed && styles.promoCardClaimed]}>
                  <View style={styles.promoHeader}>
                    <View style={styles.promoHeaderLeft}>
                      <Text style={styles.promoCode}>{String(promo.code || '').toUpperCase()}</Text>
                      <Text style={styles.promoDetail}>{renderDiscount(promo)}</Text>
                      <View style={styles.statusInline}>
                        <View
                          style={[
                            styles.statusDot,
                            { backgroundColor: !fullyClaimed && promo.is_active ? colors.primary : colors.textTertiary },
                          ]}
                        />
                        <Text style={styles.statusLabel}>
                          {fullyClaimed
                            ? t('organizerPromoCodes.list.fullyClaimed')
                            : promo.is_active
                              ? t('organizerPromoCodes.list.active')
                              : t('organizerPromoCodes.list.inactive')}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.promoHeaderActions}>
                      <TouchableOpacity
                        style={styles.iconButton}
                        onPress={() => handleShare(promo)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel={t('organizerPromoCodes.share.action')}
                      >
                        <Ionicons name="share-outline" size={18} color={colors.primary} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.iconButton}
                        onPress={() => handleDelete(promo)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel={t('organizerPromoCodes.delete.confirm')}
                      >
                        <Ionicons name="trash-outline" size={18} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.claimedRow}>
                    <Text style={styles.claimedText} numberOfLines={1}>
                      {[claimedText, expiryText ? `${t('organizerPromoCodes.list.expires')}: ${expiryText}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleToggleActive(promo)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.inlineToggleText}>
                        {promo.is_active ? t('organizerPromoCodes.list.deactivate') : t('organizerPromoCodes.list.activate')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {capped && (
                    <View style={styles.progressBar}>
                      <View style={[styles.progressFill, { width: `${pct}%` }]} />
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    // Tight top padding — the tester flagged a dead gap between the header
    // hairline and the section label.
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
  section: {
    marginTop: 4,
  },
  // SegmentedTabs carries its own 16px horizontal padding; pull it back so the
  // tabs align with the 20px content gutter.
  tabsWrap: {
    marginHorizontal: -16,
    marginBottom: 10,
  },
  // Skeleton stand-in for SegmentedTabs (gap 8, own 16px gutter, padV 4).
  tabsSkeletonRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  // claimedRow footprint (marginTop 7, space-between).
  promoSkeletonMetaRow: {
    marginTop: 7,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  // Section label + create action on one row (the label's old marginBottom
  // moves to the row so lone-label usages elsewhere stay unaffected).
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  // "＋ New code" action beside the section label (mirrors OrganizerEventsScreen's
  // create button) — replaces the old chevron-dropdown accordion.
  newCodeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.button,
  },
  newCodeButtonText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 14,
    marginLeft: 4,
  },
  formCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: RADIUS.xl,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formEyebrow: {
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  formTitle: {
    fontFamily: font.serif,
    fontSize: 24,
    color: colors.text,
    marginBottom: 10,
  },
  label: {
    marginTop: 14,
    marginBottom: 6,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
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
  inputSpaced: {
    marginTop: 10,
  },
  helperText: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  toggleButton: {
    flex: 1,
    borderRadius: radius.button,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateField: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  dateFieldText: {
    flex: 1,
    color: colors.text,
  },
  dateFieldPlaceholder: {
    color: colors.textTertiary,
  },
  dateClearButton: {
    width: 40,
    height: 40,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toggleButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  toggleButtonText: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  toggleButtonTextActive: {
    color: colors.white,
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
  },
  formActionPill: {
    flex: 1,
  },
  promoCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.button,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  promoCardClaimed: {
    opacity: 0.6,
  },
  promoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  promoHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    flexWrap: 'wrap',
  },
  statusInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  promoHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  promoCode: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: colors.text,
  },
  iconButton: {
    padding: 6,
  },
  promoDetail: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '700',
  },
  claimedRow: {
    marginTop: 7,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  claimedText: {
    flex: 1,
    fontSize: 12,
    letterSpacing: 0.3,
    color: colors.textSecondary,
  },
  // Inline text toggle (Deactivate / Activate) — replaces the old tall
  // bottom-row button so the card stays short.
  inlineToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  progressBar: {
    height: 6,
    backgroundColor: colors.background,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 6,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
});
