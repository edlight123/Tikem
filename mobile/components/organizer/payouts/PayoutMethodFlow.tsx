/**
 * Add / change a Haiti payout method, one decision per screen:
 *   1 type (MonCash or a Haitian bank) → 2 details → 3 check and save.
 * When the server asks for an email step-up (PAYOUT_CHANGE_VERIFICATION_REQUIRED)
 * step 3 grows a code field and the save is retried after the code verifies.
 *
 * Presentational only: every API call and the form state live in
 * OrganizerPayoutSettingsScreenV2, which passes them in.
 */
import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../contexts/ThemeContext';
import { useI18n } from '../../../contexts/I18nContext';
import { colors as T, font, radius } from '../../../theme/tokens';
import { Touchable } from '../../ui/Touchable';
import { ListGroup, ListRow } from '../../ui/ListRow';
import WhitePillCTA from '../../WhitePillCTA';
import SelectField from '../SelectField';
import { HAITI_BANKS, OTHER_BANK } from '../../../data/haitiBanks';

export type PayoutMethodType = 'moncash' | 'bank';

export type BankFormState = {
  accountName: string;
  bankName: string;
  accountNumber: string;
  routingNumber: string;
  swift: string;
};

export type MoncashFormState = {
  provider: string;
  accountName: string;
  phoneNumber: string;
};

interface PayoutMethodFlowProps {
  visible: boolean;
  step: 1 | 2 | 3;
  type: PayoutMethodType | null;
  mode: 'add' | 'change';
  onBack: () => void;
  onClose: () => void;
  onSelectType: (type: PayoutMethodType) => void;
  onContinue: () => void;
  onSave: () => void;
  saving: boolean;

  moncashForm: MoncashFormState;
  onMoncashChange: (patch: Partial<MoncashFormState>) => void;
  natcashEnabled: boolean;

  bankForm: BankFormState;
  onBankChange: (patch: Partial<BankFormState>) => void;
  bankNameChoice: string;
  onBankChoice: (value: string) => void;

  // Email step-up
  needsCode: boolean;
  code: string;
  onCodeChange: (v: string) => void;
  codeSent: boolean;
  sendingCode: boolean;
  verifyingCode: boolean;
  onSendCode: () => void;
  onVerifyAndSave: () => void;
}

export default function PayoutMethodFlow(props: PayoutMethodFlowProps) {
  const {
    visible,
    step,
    type,
    mode,
    onBack,
    onClose,
    onSelectType,
    onContinue,
    onSave,
    saving,
    moncashForm,
    onMoncashChange,
    natcashEnabled,
    bankForm,
    onBankChange,
    bankNameChoice,
    onBankChoice,
    needsCode,
    code,
    onCodeChange,
    codeSent,
    sendingCode,
    verifyingCode,
    onSendCode,
    onVerifyAndSave,
  } = props;
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const styles = getStyles(colors);

  const k = (key: string) => t(`organizerPayoutSettings.hub.${key}`);

  const title =
    step === 1
      ? k('stepType')
      : step === 2
        ? k('stepDetails')
        : needsCode
          ? k('stepCode')
          : k('stepConfirm');

  const providerLabel = moncashForm.provider === 'natcash' ? 'NatCash' : 'MonCash';

  const renderTypeRow = (value: PayoutMethodType, label: string, sub: string) => {
    const on = type === value;
    return (
      <Touchable
        key={value}
        scale={0.98}
        style={[styles.pick, on && styles.pickOn]}
        onPress={() => onSelectType(value)}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.pickTitle}>{label}</Text>
          <Text style={styles.pickSub}>{sub}</Text>
        </View>
        <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
      </Touchable>
    );
  };

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    opts: { placeholder?: string; keyboardType?: 'default' | 'number-pad' | 'phone-pad'; mono?: boolean; caps?: boolean } = {}
  ) => (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, opts.mono && styles.inputMono]}
        value={value}
        onChangeText={onChange}
        placeholder={opts.placeholder}
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.text}
        keyboardType={opts.keyboardType ?? 'default'}
        autoCapitalize={opts.caps ? 'characters' : opts.keyboardType ? 'none' : 'words'}
        autoCorrect={false}
      />
    </View>
  );

  const renderDetails = () => {
    if (type === 'moncash') {
      return (
        <>
          {natcashEnabled ? (
            <View style={[styles.field, styles.chipRow]}>
              {(['moncash', 'natcash'] as const).map((p) => {
                const on = moncashForm.provider === p;
                return (
                  <Touchable
                    key={p}
                    style={[styles.chip, on && styles.chipOn]}
                    onPress={() => onMoncashChange({ provider: p })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{p === 'natcash' ? 'NatCash' : 'MonCash'}</Text>
                  </Touchable>
                );
              })}
            </View>
          ) : null}
          {field(k('holderLabel'), moncashForm.accountName, (v) => onMoncashChange({ accountName: v }), {
            placeholder: t('organizerPayoutSettings.bankForm.fullNamePlaceholder'),
          })}
          {field(k('phoneLabel'), moncashForm.phoneNumber, (v) => onMoncashChange({ phoneNumber: v }), {
            placeholder: '+509…',
            keyboardType: 'phone-pad',
            mono: true,
          })}
        </>
      );
    }
    return (
      <>
        {field(k('holderLabel'), bankForm.accountName, (v) => onBankChange({ accountName: v }), {
          placeholder: t('organizerPayoutSettings.bankForm.fullNamePlaceholder'),
        })}
        <View style={styles.field}>
          <SelectField
            label={k('bankLabel')}
            labelStyle={styles.fieldLabel}
            value={bankNameChoice}
            options={HAITI_BANKS}
            onSelect={onBankChoice}
            placeholder={t('organizerPayoutSettings.bankForm.selectBank')}
            sheetTitle={t('organizerPayoutSettings.bankForm.selectBank')}
          />
          {bankNameChoice === OTHER_BANK ? (
            <TextInput
              style={[styles.input, { marginTop: 10 }]}
              value={bankForm.bankName}
              onChangeText={(v) => onBankChange({ bankName: v })}
              placeholder={t('organizerPayoutSettings.bankForm.otherBankPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.text}
            />
          ) : null}
        </View>
        {field(k('numberLabel'), bankForm.accountNumber, (v) => onBankChange({ accountNumber: v }), {
          keyboardType: 'number-pad',
          mono: true,
        })}
        {field(k('routingLabel'), bankForm.routingNumber, (v) => onBankChange({ routingNumber: v }), {
          keyboardType: 'number-pad',
          mono: true,
        })}
        {field(k('swiftLabel'), bankForm.swift, (v) => onBankChange({ swift: v }), { caps: true, mono: true })}
      </>
    );
  };

  const renderConfirm = () => {
    const rows =
      type === 'moncash'
        ? [
            { key: 'type', title: k('typeLabel'), value: providerLabel },
            { key: 'name', title: k('holderLabel'), value: moncashForm.accountName.trim() },
            { key: 'number', title: k('phoneLabel'), value: moncashForm.phoneNumber.trim() },
          ]
        : [
            { key: 'type', title: k('typeLabel'), value: k('typeBank') },
            { key: 'bank', title: k('bankLabel'), value: bankForm.bankName.trim() },
            { key: 'name', title: k('holderLabel'), value: bankForm.accountName.trim() },
            { key: 'number', title: k('numberLabel'), value: bankForm.accountNumber.trim() },
            ...(bankForm.routingNumber.trim()
              ? [{ key: 'routing', title: k('routingShort'), value: bankForm.routingNumber.trim() }]
              : []),
            ...(bankForm.swift.trim() ? [{ key: 'swift', title: 'SWIFT', value: bankForm.swift.trim() }] : []),
          ];
    return (
      <>
        <ListGroup inset={16}>
          {rows.map((r) => (
            <ListRow key={r.key} title={r.title} value={r.value} />
          ))}
        </ListGroup>
        {needsCode ? (
          <View style={{ marginTop: 28 }}>
            <Text style={styles.securityNote}>{t('organizerEarnings.otp.verificationRequiredBody')}</Text>
            {codeSent ? (
              <>
                {field(k('codeLabel'), code, onCodeChange, { keyboardType: 'number-pad', mono: true })}
                <Touchable
                  onPress={onSendCode}
                  disabled={sendingCode}
                  scale={false}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ alignSelf: 'flex-start', marginTop: 14 }}
                  accessibilityRole="button"
                >
                  <Text style={styles.link}>{k('resendCode')}</Text>
                </Touchable>
              </>
            ) : null}
          </View>
        ) : null}
      </>
    );
  };

  const footer = (() => {
    if (step === 1) return { label: k('continue'), onPress: onContinue, disabled: !type, loading: false };
    if (step === 2) return { label: k('continue'), onPress: onContinue, disabled: false, loading: false };
    if (needsCode && !codeSent) return { label: k('sendCode'), onPress: onSendCode, disabled: sendingCode, loading: sendingCode };
    if (needsCode)
      return {
        label: k('verifyAndSave'),
        onPress: onVerifyAndSave,
        disabled: verifyingCode || saving || !code.trim(),
        loading: verifyingCode || saving,
      };
    return { label: k('save'), onPress: onSave, disabled: saving, loading: saving };
  })();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onBack}>
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <View style={styles.headerRow}>
            <Touchable
              onPress={onBack}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={t('organizerPayoutSettings.setup.back')}
              style={styles.headerSide}
            >
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </Touchable>
            <Text style={styles.stepCount}>
              {mode === 'change' ? k('changeTitle') : k('addTitle')}
              {'  ·  '}
              {t('organizerPayoutSettings.setup.stepOf').replace('{n}', String(step)).replace('{total}', '3')}
            </Text>
            <Touchable
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              style={[styles.headerSide, { alignItems: 'flex-end' }]}
            >
              <Text style={styles.cancel}>{t('organizerPayoutSettings.setup.cancel')}</Text>
            </Touchable>
          </View>
          <View style={styles.segments}>
            {[1, 2, 3].map((n) => (
              <View key={n} style={[styles.segment, n <= step && styles.segmentOn]} />
            ))}
          </View>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>{title}</Text>
            {step === 1 ? (
              <>
                {renderTypeRow('moncash', k('typeMoncash'), k('typeMoncashSub'))}
                {renderTypeRow('bank', k('typeBank'), k('typeBankSub'))}
              </>
            ) : step === 2 ? (
              renderDetails()
            ) : (
              renderConfirm()
            )}
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
            <WhitePillCTA
              label={footer.label}
              onPress={footer.onPress}
              disabled={footer.disabled}
              loading={footer.loading}
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: 20 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40 },
    headerSide: { width: 72 },
    stepCount: {
      flex: 1,
      textAlign: 'center',
      fontSize: 13,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
      color: colors.textSecondary,
    },
    cancel: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
    segments: { flexDirection: 'row', gap: 6, marginTop: 14 },
    segment: { flex: 1, height: 2, backgroundColor: colors.surfaceRaised },
    segmentOn: { backgroundColor: colors.text },
    body: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 24 },
    title: {
      fontFamily: font.serif,
      fontSize: 34,
      lineHeight: 40,
      color: colors.text,
      marginBottom: 24,
    },
    pick: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 18,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      marginBottom: 10,
    },
    pickOn: { backgroundColor: colors.surfaceRaised },
    pickTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
    pickSub: { marginTop: 4, fontSize: 13, color: colors.textSecondary },
    radio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioOn: { backgroundColor: T.white },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: T.onWhite },
    field: { marginBottom: 18 },
    fieldLabel: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: '600',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: colors.textSecondary,
      marginBottom: 8,
    },
    input: {
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 13,
      color: colors.text,
      backgroundColor: colors.surface,
      fontSize: 16,
    },
    inputMono: { fontFamily: font.mono, letterSpacing: 1 },
    chipRow: { flexDirection: 'row', gap: 8 },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.chip,
      backgroundColor: colors.surfaceRaised,
    },
    chipOn: { backgroundColor: T.white },
    chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
    chipTextOn: { color: T.onWhite },
    securityNote: { fontSize: 13, lineHeight: 18, color: colors.textSecondary, marginBottom: 16 },
    link: { fontSize: 13, fontWeight: '600', color: colors.text, textDecorationLine: 'underline' },
    footer: { paddingHorizontal: 20, paddingTop: 8 },
  });
