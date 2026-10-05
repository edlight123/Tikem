import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Modal,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, MessageCircle } from 'lucide-react-native';
import * as Localization from 'expo-localization';
import WhitePillCTA from '../WhitePillCTA';
import { useI18n } from '../../contexts/I18nContext';
import { colors, radius, spacing, type } from '../../theme/tokens';
import {
  PHONE_AUTH_COUNTRIES,
  composePhone,
  defaultPhoneCountry,
  looksDialable,
  phoneErrorKey,
  prettyPhone,
  type PhoneAuthCountry,
} from '../../lib/phoneAuthGate';
import type { CodeSent } from '../../lib/phoneAuth';

const CODE_LENGTH = 6;

interface Props {
  /** Send a code to `phone` (E.164-ish) on WhatsApp. */
  onRequestCode: (phone: string, iso: string) => Promise<CodeSent>;
  /** Check the code; resolve when signed in / linked. */
  onVerify: (phone: string, iso: string, code: string) => Promise<void>;
  /** The phone step's white pill, e.g. "Continue with WhatsApp". */
  ctaLabel: string;
  /** Tells the parent a request is in flight (to disable its other buttons). */
  onBusyChange?: (busy: boolean) => void;
  /** Tells the parent which step is showing (it may hide chrome on the code step). */
  onStepChange?: (step: 'phone' | 'code') => void;
}

function deviceRegion(): string | null {
  try {
    return Localization.getLocales?.()[0]?.regionCode ?? null;
  } catch {
    return null;
  }
}

/**
 * Phone number, then a 6-digit WhatsApp code. Shared by the login screen and
 * the profile's "Add phone number" sheet.
 *
 * POSH: filled cells (surface fill, no hairline box), one white pill per step,
 * errors as a plain red line under the field rather than an alert.
 */
export function PhoneCodeFlow({ onRequestCode, onVerify, ctaLabel, onBusyChange, onStepChange }: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [country, setCountry] = useState<PhoneAuthCountry>(() => defaultPhoneCountry(deviceRegion()));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [input, setInput] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const codeRef = useRef<TextInput>(null);

  useEffect(() => onBusyChange?.(busy), [busy]);
  useEffect(() => onStepChange?.(step), [step]);

  // Resend countdown tick, only while it matters.
  useEffect(() => {
    if (step !== 'code' || now >= resendAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [step, resendAt, now]);

  const describe = (err: any) => {
    const c = err?.code === 'network' ? 'network' : err?.code;
    if (c === 'cooldown' && err?.retryAfterSec) {
      return t('auth.phone.errors.cooldown', { seconds: err.retryAfterSec });
    }
    return t(phoneErrorKey(c));
  };

  const send = async (target: string) => {
    setBusy(true);
    setError(null);
    try {
      const sent = await onRequestCode(target, country.iso);
      setPhone(target);
      setCode('');
      setResendAt(Date.now() + (sent?.resendAfterSec ?? 60) * 1000);
      setNow(Date.now());
      setStep('code');
      setTimeout(() => codeRef.current?.focus(), 250);
    } catch (err: any) {
      if (err?.code === 'cooldown' && step === 'phone') {
        // A code is already on its way to this number: go enter it.
        setPhone(target);
        setResendAt(Date.now() + (err?.retryAfterSec ?? 60) * 1000);
        setNow(Date.now());
        setStep('code');
      } else {
        setError(describe(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const submitPhone = () => {
    if (!looksDialable(input)) {
      setError(t('auth.phone.errors.invalid_phone'));
      return;
    }
    send(composePhone(country, input));
  };

  const submitCode = async (value: string) => {
    if (value.length !== CODE_LENGTH || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onVerify(phone, country.iso, value);
    } catch (err: any) {
      setError(describe(err));
      setCode('');
      if (err?.code === 'too_many_attempts') setResendAt(0);
    } finally {
      setBusy(false);
    }
  };

  const onCodeChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (error) setError(null);
    if (digits.length === CODE_LENGTH) submitCode(digits);
  };

  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));

  if (step === 'code') {
    return (
      <View style={styles.wrap}>
        <View style={styles.codeHeader}>
          <Text style={styles.title}>{t('auth.phone.codeTitle')}</Text>
          <Text style={styles.sub}>{t('auth.phone.codeSentTo', { phone: prettyPhone(phone) })}</Text>
        </View>

        <Pressable onPress={() => codeRef.current?.focus()} style={styles.codeRow} accessible={false}>
          {Array.from({ length: CODE_LENGTH }).map((_, i) => {
            const active = i === code.length && !busy;
            return (
              <View key={i} style={[styles.codeCell, active && styles.codeCellActive]}>
                <Text style={styles.codeDigit}>{code[i] ?? ''}</Text>
              </View>
            );
          })}
          {/* One real input over the boxes: paste, iOS "From Messages" and
              Android SMS autofill all land here. Near-zero opacity (not 0) so
              iOS still offers the paste/autofill menu. */}
          <TextInput
            ref={codeRef}
            value={code}
            onChangeText={onCodeChange}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
            maxLength={CODE_LENGTH}
            editable={!busy}
            caretHidden
            accessibilityLabel={t('auth.phone.codeAccessibility')}
            style={styles.codeInput}
          />
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {busy ? <Text style={styles.sub}>{t('auth.phone.verifying')}</Text> : null}

        <View style={styles.linksRow}>
          <Pressable
            onPress={() => {
              setStep('phone');
              setError(null);
              setCode('');
            }}
            disabled={busy}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={styles.link}>{t('auth.phone.changeNumber')}</Text>
          </Pressable>
          {secondsLeft > 0 ? (
            <Text style={styles.muted}>{t('auth.phone.resendIn', { seconds: secondsLeft })}</Text>
          ) : (
            <Pressable onPress={() => send(phone)} disabled={busy} hitSlop={8} accessibilityRole="button">
              <Text style={styles.linkStrong}>{t('auth.phone.resend')}</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.phoneCell}>
        <Pressable
          onPress={() => setPickerOpen(true)}
          disabled={busy}
          style={styles.prefix}
          accessibilityRole="button"
          accessibilityLabel={t('auth.phone.countryPickerTitle')}
        >
          <Text style={styles.flag}>{country.flag}</Text>
          <Text style={styles.dial}>+{country.dial}</Text>
          <ChevronDown size={16} color={colors.textTertiary} />
        </Pressable>
        <TextInput
          value={input}
          onChangeText={(v) => {
            setInput(v);
            if (error) setError(null);
          }}
          placeholder={t('auth.phone.phonePlaceholder')}
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.accent}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          returnKeyType="go"
          onSubmitEditing={submitPhone}
          editable={!busy}
          style={styles.phoneInput}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : <Text style={styles.muted}>{t('auth.phone.hint')}</Text>}

      <WhitePillCTA
        label={ctaLabel}
        onPress={submitPhone}
        loading={busy}
        icon={<MessageCircle size={18} color={colors.onWhite} />}
      />

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Text style={styles.sheetTitle}>{t('auth.phone.countryPickerTitle')}</Text>
          {PHONE_AUTH_COUNTRIES.map((c) => {
            const active = c.iso === country.iso;
            return (
              <Pressable
                key={c.iso}
                onPress={() => {
                  setCountry(c);
                  setPickerOpen(false);
                }}
                style={({ pressed }) => [styles.countryRow, (active || pressed) && styles.countryRowActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={styles.flag}>{c.flag}</Text>
                <Text style={styles.countryName}>{t(`countries.${c.iso}`)}</Text>
                <Text style={styles.muted}>+{c.dial}</Text>
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </View>
  );
}

const CELL = 48;

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
  },
  phoneCell: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingRight: spacing.lg,
  },
  prefix: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: '100%',
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    marginRight: spacing.md,
    borderTopLeftRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
    backgroundColor: colors.surfaceRaised,
  },
  flag: {
    fontSize: 20,
  },
  dial: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  phoneInput: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  codeHeader: {
    gap: spacing.xs,
  },
  title: {
    ...type.title,
    color: colors.textPrimary,
  },
  sub: {
    ...type.body,
    color: colors.textSecondary,
  },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  codeCell: {
    width: CELL,
    height: CELL + 8,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeCellActive: {
    backgroundColor: colors.surfaceRaised,
  },
  codeDigit: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
  codeInput: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.011,
    color: 'transparent',
    fontSize: 1,
  },
  error: {
    color: colors.red,
    fontSize: 13,
  },
  muted: {
    color: colors.textTertiary,
    fontSize: 13,
  },
  linksRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  link: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  linkStrong: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.xs,
  },
  sheetTitle: {
    ...type.label,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  countryRowActive: {
    backgroundColor: colors.surfaceRaised,
  },
  countryName: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 16,
  },
});

export default PhoneCodeFlow;
