import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, AlertTriangle, X } from 'lucide-react-native';
import { colors, font, radius, spacing } from '../../theme/tokens';
import { useI18n } from '../../contexts/I18nContext';
import { SecondaryPill } from '../auth/SecondaryPill';
import type { ScanOutcome } from '../../lib/scanner';

export interface DoorResult {
  outcome: ScanOutcome;
  /** VALID / ALREADY CHECKED IN / INVALID — read from across the door. */
  headline: string;
  name?: string;
  tier?: string;
  /** Reason (invalid), previous check-in time (warning) or sync state (valid). */
  detail?: string;
  entryPoint?: string;
  /** Event allows re-entry and this guest is already in — offer the override. */
  allowReentry?: boolean;
}

interface DoorResultOverlayProps {
  result: DoorResult | null;
  onDismiss: () => void;
  onAllowReentry?: () => void;
}

// Locked status semantics (POSH §2.7): emerald = admitted, amber = already
// in / warning, red = refused. The colour is the message; the label repeats it
// so it never relies on colour alone.
const TONE: Record<ScanOutcome, { solid: string; wash: string }> = {
  valid: { solid: colors.emerald, wash: colors.emeraldMuted },
  warning: { solid: colors.amber, wash: colors.amberMuted },
  invalid: { solid: colors.red, wash: colors.redMuted },
};

// How long each verdict holds the screen before the camera is live again.
// Valid is quick (the line keeps moving); a refusal stays long enough to read.
const AUTO_DISMISS_MS: Record<ScanOutcome, number> = {
  valid: 1400,
  warning: 2600,
  invalid: 2600,
};

/**
 * Door mode's full-screen verdict — the mobile counterpart of the web's
 * components/scan/ScanResultOverlay. Tap anywhere to return to scanning.
 */
export default function DoorResultOverlay({ result, onDismiss, onAllowReentry }: DoorResultOverlayProps) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const scale = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (!result) return;
    scale.setValue(0.6);
    Animated.spring(scale, { toValue: 1, friction: 6, tension: 140, useNativeDriver: true }).start();
    // A pending re-entry decision must not be timed out from under the staff.
    if (result.allowReentry) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS[result.outcome]);
    return () => clearTimeout(timer);
  }, [result]);

  if (!result) return null;
  const tone = TONE[result.outcome];
  const Icon = result.outcome === 'valid' ? Check : result.outcome === 'warning' ? AlertTriangle : X;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable
        style={[styles.screen, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={`${result.headline}. ${result.name ?? ''}`}
      >
        {/* Full-bleed wash of the verdict colour over the black frame. */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: tone.wash }]} />

        <View style={styles.center}>
          <Animated.View style={[styles.disc, { backgroundColor: tone.solid, transform: [{ scale }] }]}>
            <Icon size={64} color={colors.black} strokeWidth={3} />
          </Animated.View>

          <Text style={[styles.headline, { color: tone.solid }]} numberOfLines={2} adjustsFontSizeToFit>
            {result.headline}
          </Text>

          {!!result.name && (
            <Text style={styles.name} numberOfLines={2}>
              {result.name}
            </Text>
          )}
          {!!result.tier && <Text style={styles.tier} numberOfLines={1}>{result.tier}</Text>}

          {(!!result.detail || !!result.entryPoint) && (
            <View style={styles.detailCard}>
              {!!result.detail && <Text style={styles.detail}>{result.detail}</Text>}
              {!!result.entryPoint && (
                <Text style={styles.entry}>
                  {t('doorScanner.entryPoint')} · {result.entryPoint}
                </Text>
              )}
            </View>
          )}
        </View>

        <View style={styles.footer}>
          {result.allowReentry && onAllowReentry ? (
            <SecondaryPill label={t('doorScanner.result.allowReentry')} onPress={onAllowReentry} />
          ) : null}
          <Text style={styles.hint}>{t('doorScanner.result.tapToContinue')}</Text>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.black,
    paddingHorizontal: spacing.xl,
    justifyContent: 'space-between',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disc: {
    width: 128,
    height: 128,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  headline: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  name: {
    marginTop: spacing.lg,
    fontFamily: font.serif,
    fontSize: 34,
    lineHeight: 40,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  tier: {
    marginTop: spacing.xs,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  detailCard: {
    marginTop: spacing.xl,
    alignSelf: 'stretch',
    borderRadius: radius.lg,
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: 4,
  },
  detail: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  entry: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  footer: {
    gap: spacing.md,
  },
  hint: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
