import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleCheck, TriangleAlert, CircleX } from 'lucide-react-native';
import { colors, font, radius, spacing } from '../../theme/tokens';
import { useI18n } from '../../contexts/I18nContext';
import type { ScanOutcome } from '../../lib/scanner';

export interface DoorResult {
  outcome: ScanOutcome;
  /** VALID / ALREADY CHECKED IN / INVALID — read from across the door. */
  headline: string;
  name?: string;
  tier?: string;
  /** Ticket identifier, shown in mono so staff can read it back if asked. */
  ticketRef?: string;
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
// in / warning, red = refused. The colour lives on the icon; the headline
// repeats it in words so it never relies on colour alone.
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

/** Short, readable form of a long document id. */
function formatRef(ref: string): string {
  const clean = ref.trim();
  return clean.length > 12 ? clean.slice(-8).toUpperCase() : clean.toUpperCase();
}

/**
 * Door mode's verdict — a bottom sheet over the live camera (the mobile
 * counterpart of the web's components/scan/ScanResultOverlay). Tap anywhere,
 * or "Scan next", to return to scanning.
 */
export default function DoorResultOverlay({ result, onDismiss, onAllowReentry }: DoorResultOverlayProps) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const scale = useRef(new Animated.Value(0.6)).current;
  const slide = useRef(new Animated.Value(80)).current;

  useEffect(() => {
    if (!result) return;
    scale.setValue(0.6);
    slide.setValue(80);
    Animated.parallel([
      Animated.spring(slide, { toValue: 0, friction: 9, tension: 120, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 140, useNativeDriver: true }),
    ]).start();
    // A pending re-entry decision must not be timed out from under the staff.
    if (result.allowReentry) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS[result.outcome]);
    return () => clearTimeout(timer);
  }, [result]);

  if (!result) return null;
  const tone = TONE[result.outcome];
  const Icon = result.outcome === 'valid' ? CircleCheck : result.outcome === 'warning' ? TriangleAlert : CircleX;
  const showReentry = !!result.allowReentry && !!onAllowReentry;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable
        style={styles.backdrop}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={`${result.headline}. ${result.name ?? ''}`}
      >
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + spacing.lg, transform: [{ translateY: slide }] },
          ]}
        >
          <View style={styles.verdictRow}>
            <Animated.View style={[styles.iconDisc, { backgroundColor: tone.wash, transform: [{ scale }] }]}>
              <Icon size={30} color={tone.solid} strokeWidth={2} />
            </Animated.View>
            <Text style={styles.headline} numberOfLines={2} adjustsFontSizeToFit>
              {result.headline}
            </Text>
          </View>

          {(!!result.name || !!result.tier || !!result.ticketRef) && (
            <View style={styles.guest}>
              {!!result.name && (
                <Text style={styles.name} numberOfLines={2}>
                  {result.name}
                </Text>
              )}
              {(!!result.tier || !!result.ticketRef) && (
                <View style={styles.metaRow}>
                  {!!result.tier && (
                    <Text style={styles.tier} numberOfLines={1}>
                      {result.tier}
                    </Text>
                  )}
                  {!!result.ticketRef && (
                    <Text style={styles.ref} numberOfLines={1}>
                      {formatRef(result.ticketRef)}
                    </Text>
                  )}
                </View>
              )}
            </View>
          )}

          {(!!result.detail || !!result.entryPoint) && (
            <View style={styles.details}>
              {!!result.detail && <Text style={styles.detail}>{result.detail}</Text>}
              {!!result.entryPoint && (
                <Text style={styles.entry}>
                  {t('doorScanner.entryPoint')} · {result.entryPoint}
                </Text>
              )}
            </View>
          )}

          <View style={styles.actions}>
            <Pressable
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel={t('doorScanner.result.scanNext')}
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            >
              <Text style={styles.primaryLabel}>{t('doorScanner.result.scanNext')}</Text>
            </Pressable>
            {showReentry ? (
              <Pressable
                onPress={onAllowReentry}
                accessibilityRole="button"
                accessibilityLabel={t('doorScanner.result.allowReentry')}
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              >
                <Text style={styles.secondaryLabel}>{t('doorScanner.result.allowReentry')}</Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  verdictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  // A true circle (icon disc), so the pill radius is allowed here.
  iconDisc: {
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    flex: 1,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: colors.textPrimary,
  },
  guest: {
    marginTop: spacing.xl,
    gap: 6,
  },
  name: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.textPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  tier: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  ref: {
    fontFamily: font.mono,
    fontSize: 13,
    color: colors.textTertiary,
  },
  details: {
    marginTop: spacing.md,
    gap: 4,
  },
  detail: {
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  entry: {
    fontSize: 13,
    color: colors.textTertiary,
  },
  actions: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  primary: {
    height: 56,
    borderRadius: radius.button,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.onWhite,
  },
  secondary: {
    height: 56,
    borderRadius: radius.button,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  pressed: {
    opacity: 0.85,
  },
});
