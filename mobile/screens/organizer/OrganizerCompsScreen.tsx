import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAppAlert } from '../../components/AppAlert';
import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Gift } from 'lucide-react-native';
import { db } from '../../config/firebase';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { RADIUS } from '../../config/brand';
import { Skeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import StatusChip from '../../components/StatusChip';
import WhitePillCTA from '../../components/WhitePillCTA';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import InfoNotice from '../../components/organizer/InfoNotice';
import SelectField from '../../components/organizer/SelectField';
import { getEventById } from '../../lib/api/organizer';
import { backendJson } from '../../lib/api/backend';

type RouteParams = {
  OrganizerComps: {
    eventId: string;
  };
};

type TicketTier = {
  id: string;
  name: string;
  sort_order?: number;
};

type CompTicketDoc = {
  event_id: string;
  source?: string;
  status?: string;
  recipient_name?: string;
  recipient_email?: string | null;
  comp_note?: string | null;
  tier_id?: string;
};

type CompGroup = {
  key: string;
  recipientName: string;
  recipientEmail: string;
  note: string;
  status: string;
  quantity: number;
};

const MIN_QTY = 1;
const MAX_QTY = 20;

export default function OrganizerCompsScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const route = useRoute<RouteProp<RouteParams, 'OrganizerComps'>>();
  const navigation = useNavigation<any>();
  const { eventId } = route.params;
  const { height: headerH, onHeight } = useOverlayHeaderInset();

  const { t } = useI18n();
  const showAlert = useAppAlert();

  const [eventTitle, setEventTitle] = useState('');
  const [tiers, setTiers] = useState<TicketTier[]>([]);
  const [comps, setComps] = useState<CompGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [tierId, setTierId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [event, tierRows, compRows] = await Promise.all([
        getEventById(eventId),
        (async () => {
          const snap = await getDocs(query(collection(db, 'ticket_tiers'), where('event_id', '==', eventId)));
          const rows = snap.docs
            // A tier removed in an edit is kept only for its history (archived).
            .filter((d) => (d.data() as any)?.archived !== true)
            .map((d) => ({ id: d.id, ...(d.data() as Omit<TicketTier, 'id'>) }));
          rows.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
          return rows as TicketTier[];
        })(),
        (async () => {
          const snap = await getDocs(
            query(collection(db, 'tickets'), where('event_id', '==', eventId), where('source', '==', 'comp'))
          );
          const grouped = new Map<string, CompGroup>();
          snap.docs.forEach((d) => {
            const data = d.data() as CompTicketDoc;
            const name = (data.recipient_name || '').trim();
            const email = (data.recipient_email || '').trim();
            const noteText = (data.comp_note || '').trim();
            const status = data.status || 'valid';
            const key = `${name}|${email}|${noteText}|${status}`;
            const existing = grouped.get(key);
            if (existing) {
              existing.quantity += 1;
            } else {
              grouped.set(key, {
                key,
                recipientName: name,
                recipientEmail: email,
                note: noteText,
                status,
                quantity: 1,
              });
            }
          });
          return Array.from(grouped.values());
        })(),
      ]);

      setEventTitle(event?.title || '');
      setTiers(tierRows);
      setComps(compRows);
      // Preselect the sole tier (or keep a still-valid selection).
      setTierId((prev) => {
        if (prev && tierRows.some((tt) => tt.id === prev)) return prev;
        return tierRows.length === 1 ? tierRows[0].id : '';
      });
    } catch (e) {
      console.error('Failed to load comps', e);
      showAlert(t('common.error'), t('organizerComps.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [eventId, t]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const tierNames = useMemo(() => tiers.map((tt) => tt.name), [tiers]);
  const selectedTierName = useMemo(
    () => tiers.find((tt) => tt.id === tierId)?.name || '',
    [tiers, tierId]
  );

  const resetForm = () => {
    setRecipientName('');
    setRecipientEmail('');
    setQuantity(1);
    setNote('');
    setError(null);
    setTierId(tiers.length === 1 ? tiers[0].id : '');
  };

  const adjustQuantity = (delta: number) => {
    setQuantity((q) => Math.max(MIN_QTY, Math.min(MAX_QTY, q + delta)));
  };

  const handleIssue = async () => {
    const name = recipientName.trim();
    if (!name) {
      setError(t('organizerComps.errors.nameRequired'));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await backendJson<{ success: boolean; count: number; ticketIds: string[] }>(
        `/api/organizer/events/${eventId}/comps`,
        {
          method: 'POST',
          body: JSON.stringify({
            recipient_name: name,
            recipient_email: recipientEmail.trim(),
            tier_id: tierId,
            quantity,
            note: note.trim(),
          }),
        }
      );

      const count = res?.count ?? quantity;
      resetForm();
      await load();
      showAlert(
        t('common.success'),
        t('organizerComps.issuedToast').replace('{count}', String(count))
      );
    } catch (e: any) {
      console.error('Failed to issue comps', e);
      const message = e?.message || t('organizerComps.errors.issueFailed');
      setError(message);
      showAlert(t('common.error'), message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        {/* Same overlay header as the loaded branch so the chrome doesn't jump
            from an in-flow bar to a floating blur when data lands. */}
        <OrganizerScreenHeader
          title={t('organizerComps.title')}
          subtitle={eventTitle || undefined}
          onBack={() => navigation.goBack()}
          overlay
          onHeight={onHeight}
        />
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: headerH }]}>
          {/* InfoNotice banner. */}
          <Skeleton width="100%" height={64} radius={RADIUS.md} />
          {/* Issue form: title, then label + input pairs (inputs ≈45 tall:
              paddingVertical 12×2 + text), a stepper row, and the submit pill. */}
          <View style={styles.formCard}>
            <Skeleton width={150} height={16} radius={6} />
            {[0, 1, 2].map((i) => (
              <View key={i}>
                <Skeleton width={110} height={12} radius={5} style={{ marginTop: 14, marginBottom: 6 }} />
                <Skeleton width="100%" height={45} radius={RADIUS.md} />
              </View>
            ))}
            <Skeleton width={90} height={12} radius={5} style={{ marginTop: 14, marginBottom: 6 }} />
            <Skeleton width={140} height={44} radius={RADIUS.md} />
            <Skeleton width="100%" height={48} radius={999} style={{ marginTop: 20 }} />
          </View>
          {/* Issued list: section title + recipient cards (name/chip + meta). */}
          <View style={styles.section}>
            <Skeleton width={140} height={18} radius={6} style={{ marginBottom: 12 }} />
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.compCard}>
                <View style={styles.compHeader}>
                  <Skeleton width="55%" height={15} radius={6} />
                  <Skeleton width={60} height={22} radius={11} />
                </View>
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
        title={t('organizerComps.title')}
        subtitle={eventTitle || undefined}
        onBack={() => navigation.goBack()}
        overlay
        onHeight={onHeight}
      />
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: headerH }]}
        keyboardShouldPersistTaps="handled"
      >
        <InfoNotice text={t('organizerComps.infoNotice')} />

        <View style={styles.formCard}>
          <Text style={styles.formTitle}>{t('organizerComps.formTitle')}</Text>

          <Text style={styles.label}>{t('organizerComps.recipientName')}</Text>
          <TextInput
            style={styles.input}
            value={recipientName}
            onChangeText={setRecipientName}
            placeholder={t('organizerComps.recipientNamePlaceholder')}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.primary}
          />

          <Text style={styles.label}>{t('organizerComps.recipientEmail')}</Text>
          <TextInput
            style={styles.input}
            value={recipientEmail}
            onChangeText={setRecipientEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder={t('organizerComps.recipientEmailPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.primary}
          />

          {tiers.length > 0 && (
            <SelectField
              label={t('organizerComps.tier')}
              value={selectedTierName}
              options={tierNames}
              placeholder={t('organizerComps.tierPlaceholder')}
              sheetTitle={t('organizerComps.tier')}
              onSelect={(name) => {
                const match = tiers.find((tt) => tt.name === name);
                if (match) setTierId(match.id);
              }}
            />
          )}

          <Text style={styles.label}>{t('organizerComps.quantity')}</Text>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={[styles.stepperButton, quantity <= MIN_QTY && styles.stepperButtonDisabled]}
              onPress={() => adjustQuantity(-1)}
              disabled={quantity <= MIN_QTY}
              accessibilityRole="button"
              accessibilityLabel={t('organizerComps.decrease')}
            >
              <Ionicons name="remove" size={22} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.stepperValue}>{quantity}</Text>
            <TouchableOpacity
              style={[styles.stepperButton, quantity >= MAX_QTY && styles.stepperButtonDisabled]}
              onPress={() => adjustQuantity(1)}
              disabled={quantity >= MAX_QTY}
              accessibilityRole="button"
              accessibilityLabel={t('organizerComps.increase')}
            >
              <Ionicons name="add" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>{t('organizerComps.note')}</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder={t('organizerComps.notePlaceholder')}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.primary}
          />

          {!!error && <Text style={styles.errorText}>{error}</Text>}

          <View style={styles.submitWrap}>
            <WhitePillCTA
              label={submitting ? t('organizerComps.issuing') : t('organizerComps.issue')}
              onPress={handleIssue}
              loading={submitting}
              disabled={submitting}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('organizerComps.listTitle')}</Text>
          {comps.length === 0 ? (
            <EmptyState icon={Gift} title={t('organizerComps.empty')} subtitle={t('organizerComps.emptySubtitle')} compact />
          ) : (
            comps.map((c) => (
              <View key={c.key} style={styles.compCard}>
                <View style={styles.compHeader}>
                  <View style={styles.compHeaderLeft}>
                    <Text style={styles.compName} numberOfLines={1}>
                      {c.recipientName || t('organizerComps.unnamedRecipient')}
                    </Text>
                    {!!c.recipientEmail && (
                      <Text style={styles.compEmail} numberOfLines={1}>{c.recipientEmail}</Text>
                    )}
                  </View>
                  <StatusChip status={c.status === 'valid' ? 'success' : c.status} />
                </View>
                <Text style={styles.compMeta}>
                  {t('organizerComps.quantityLabel')}: {c.quantity}
                  {c.note ? ` • ${c.note}` : ''}
                </Text>
              </View>
            ))
          )}
        </View>
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
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    stepperButton: {
      width: 44,
      height: 44,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepperButtonDisabled: {
      opacity: 0.4,
    },
    stepperValue: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.text,
      minWidth: 32,
      textAlign: 'center',
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
    compCard: {
      backgroundColor: colors.surface,
      borderRadius: RADIUS.xl,
      padding: 14,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    compHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    compHeaderLeft: {
      flex: 1,
    },
    compName: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    compEmail: {
      marginTop: 2,
      fontSize: 13,
      color: colors.textSecondary,
    },
    compMeta: {
      marginTop: 8,
      fontSize: 12,
      color: colors.textSecondary,
    },
  });
