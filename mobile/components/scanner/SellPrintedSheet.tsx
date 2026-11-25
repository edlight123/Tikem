import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TextInput, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle2, CloudOff, XCircle, Ticket } from 'lucide-react-native';
import { colors, radius, spacing, type, withAlpha } from '../../theme/tokens';
import { useI18n } from '../../contexts/I18nContext';
import WhitePillCTA from '../WhitePillCTA';
import { SecondaryPill } from '../auth/SecondaryPill';
import { Touchable } from '../ui/Touchable';
import {
  SALE_METHODS,
  activationMessageKey,
  cleanHolderName,
  newClientRef,
  normalizeSerial,
  parsePhysicalQr,
  type QueuedActivation,
  type SaleMethod,
} from '../../lib/physicalTickets';
import { postActivation, queueActivation } from '../../lib/physicalTicketsApi';

export type SellOutcome = 'sold' | 'queued' | 'refused';

interface SellPrintedSheetProps {
  visible: boolean;
  eventId: string;
  uid: string;
  /** The scanned QR, or null to type the serial. */
  code: string | null;
  onClose: () => void;
  /** After a sale attempt: for the scanner's recent list + pending counter. */
  onOutcome: (outcome: SellOutcome, name: string, label: string, pending?: number) => void;
}

type Done = { outcome: SellOutcome; headline: string; detail: string };

/**
 * Sell one printed ticket (activate it): the buyer's NAME is required, phone
 * optional, payment method defaults to cash. Online it is judged by the server
 * at once; with no connection it is queued on the phone and synced later (the
 * first activation wins, the scanner reports any conflict on sync).
 */
export default function SellPrintedSheet({ visible, eventId, uid, code, onClose, onOutcome }: SellPrintedSheetProps) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [serial, setSerial] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [method, setMethod] = useState<SaleMethod>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    if (!visible) return;
    setSerial('');
    setName('');
    setPhone('');
    setMethod('cash');
    setError('');
    setDone(null);
  }, [visible, code]);

  const scanned = code ? parsePhysicalQr(code) : null;
  // A scanned code that is not a printed ticket's QR may still be a typed serial (manual entry).
  const typedFromCode = code && !scanned ? normalizeSerial(code) : '';

  const submit = async () => {
    const holder = cleanHolderName(name);
    if (!holder) {
      setError(t('physicalSell.nameRequired'));
      return;
    }
    const ser = scanned ? null : normalizeSerial(serial || typedFromCode);
    if (!scanned && !ser) {
      setError(t('physicalSell.serialRequired'));
      return;
    }
    setError('');
    setBusy(true);
    const item: QueuedActivation = {
      clientRef: newClientRef(),
      eventId,
      code: scanned ? code : null,
      serial: ser,
      name: holder,
      phone: phone.trim() || null,
      method,
      clientActivatedAt: new Date().toISOString(),
    };
    try {
      const res = await postActivation(item);
      if (res.type === 'judged') {
        const r = res.response;
        if (r.ok) {
          const d = { outcome: 'sold' as const, headline: t('physicalSell.result.sold'), detail: [r.holderName, r.tier, r.serial].filter(Boolean).join(' · ') };
          setDone(d);
          onOutcome('sold', r.holderName, t('physicalSell.recent.sold'));
        } else {
          const detail =
            r.code === 'ALREADY_ACTIVATED' && r.holderName
              ? t('physicalSell.result.alreadySoldTo', { name: r.holderName })
              : t(activationMessageKey(r.code));
          setDone({ outcome: 'refused', headline: t('physicalSell.result.notSold'), detail });
          onOutcome('refused', r.holderName || holder, t('physicalSell.recent.refused'));
        }
      } else if (res.type === 'denied') {
        setDone({ outcome: 'refused', headline: t('physicalSell.result.notSold'), detail: t('physicalSell.result.noAccess') });
        onOutcome('refused', holder, t('physicalSell.recent.refused'));
      } else {
        // No connection: keep it on the phone, sync later.
        const q = uid ? await queueActivation(uid, item) : { duplicate: false, pending: 0 };
        if (q.duplicate) {
          setDone({ outcome: 'refused', headline: t('physicalSell.result.notSold'), detail: t('physicalSell.result.alreadyQueued') });
          onOutcome('refused', holder, t('physicalSell.recent.refused'));
        } else {
          setDone({ outcome: 'queued', headline: t('physicalSell.result.queued'), detail: t('physicalSell.result.queuedDetail') });
          onOutcome('queued', holder, t('physicalSell.recent.queued'), q.pending);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const Icon = done?.outcome === 'sold' ? CheckCircle2 : done?.outcome === 'queued' ? CloudOff : XCircle;
  const tone = done?.outcome === 'sold' ? colors.emerald : done?.outcome === 'queued' ? colors.amber : colors.red;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Touchable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} />
        <View style={[styles.sheet, { paddingBottom: Math.max(spacing.xl, insets.bottom + spacing.lg) }]}>
          <View style={styles.grabber} />
          {done ? (
            <View style={styles.doneWrap}>
              <Icon size={48} color={tone} strokeWidth={1.75} />
              <Text style={styles.title}>{done.headline}</Text>
              {!!done.detail && <Text style={styles.detail}>{done.detail}</Text>}
              <View style={styles.actions}>
                <WhitePillCTA size="sm" label={t('physicalSell.next')} onPress={onClose} />
              </View>
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
              <View style={styles.headRow}>
                <Ticket size={20} color={colors.textSecondary} strokeWidth={1.75} />
                <Text style={styles.title}>{t('physicalSell.title')}</Text>
              </View>
              <Text style={styles.detail}>
                {scanned ? t('physicalSell.scannedHint') : t('physicalSell.serialHint')}
              </Text>

              {!scanned && (
                <>
                  <Text style={styles.label}>{t('physicalSell.serial')}</Text>
                  <TextInput
                    value={serial || typedFromCode}
                    onChangeText={setSerial}
                    placeholder="FETE-VIP-0001"
                    placeholderTextColor={colors.textTertiary}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    style={styles.input}
                    selectionColor={colors.accent}
                  />
                </>
              )}

              <Text style={styles.label}>{t('physicalSell.buyerName')}</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={t('physicalSell.buyerNamePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                autoFocus={!!scanned}
                autoCapitalize="words"
                style={styles.input}
                selectionColor={colors.accent}
                maxLength={80}
              />

              <Text style={styles.label}>{t('physicalSell.phoneOptional')}</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="+509"
                placeholderTextColor={colors.textTertiary}
                keyboardType="phone-pad"
                style={styles.input}
                selectionColor={colors.accent}
                maxLength={20}
              />

              <Text style={styles.label}>{t('physicalSell.method')}</Text>
              <View style={styles.methods}>
                {SALE_METHODS.map((m) => {
                  const active = m === method;
                  return (
                    <Touchable
                      key={m}
                      style={[styles.method, active && styles.methodActive]}
                      onPress={() => setMethod(m)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.methodText, active && styles.methodTextActive]}>{t(`physicalSell.methods.${m}`)}</Text>
                    </Touchable>
                  );
                })}
              </View>

              {!!error && <Text style={styles.error}>{error}</Text>}

              <View style={styles.actions}>
                <WhitePillCTA size="sm" label={t('physicalSell.sell')} onPress={submit} loading={busy} disabled={busy} />
                <SecondaryPill label={t('common.cancel')} onPress={onClose} />
              </View>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: withAlpha(colors.black, 0.6) },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: '88%',
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    marginBottom: spacing.md,
  },
  form: { gap: spacing.sm, paddingBottom: spacing.sm },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...type.title, color: colors.textPrimary },
  detail: { ...type.body, color: colors.textSecondary, textAlign: 'left' },
  label: { ...type.label, color: colors.textSecondary, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
    fontSize: 16,
  },
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  method: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radius.chip,
    backgroundColor: colors.surfaceRaised,
  },
  methodActive: { backgroundColor: colors.white },
  methodText: { ...type.label, color: colors.textSecondary },
  methodTextActive: { color: colors.onWhite },
  error: { ...type.label, color: colors.red, marginTop: spacing.xs },
  actions: { gap: spacing.sm, marginTop: spacing.md, alignSelf: 'stretch' },
  doneWrap: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
});
