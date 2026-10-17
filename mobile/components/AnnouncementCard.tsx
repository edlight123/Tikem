import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { radius } from '../theme/tokens';

export interface AnnouncementAction {
  label: string;
  onPress: () => void;
}

/**
 * The house announcement: one-time notices and nudges on Home and Profile.
 * A filled card (never a hairline box) with a faint teal glow in one corner,
 * an icon + dot-and-label eyebrow, an editorial serif headline (lowercased
 * here, house voice), one line of body, and at most two actions: a white
 * primary and a quiet text secondary ("Got it", "Not now").
 */
export default function AnnouncementCard({
  icon: Icon,
  eyebrow,
  title,
  body,
  primary,
  secondary,
  style,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  body?: string;
  primary?: AnnouncementAction;
  secondary?: AnnouncementAction;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  return (
    <View style={[styles.card, style]}>
      <LinearGradient
        pointerEvents="none"
        colors={[`${colors.primary}2E`, `${colors.primary}00`]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.35, y: 0.75 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.top}>
        <View style={styles.icon}>
          <Icon size={18} color={colors.text} strokeWidth={2} />
        </View>
        <View style={styles.eyebrow}>
          <View style={[styles.dot, { backgroundColor: colors.primary }]} />
          <Text style={styles.eyebrowText}>{eyebrow}</Text>
        </View>
      </View>
      <Text style={styles.title}>{title.toLowerCase()}</Text>
      {!!body && <Text style={styles.body}>{body}</Text>}
      {(primary || secondary) && (
        <View style={styles.actions}>
          {primary && (
            <TouchableOpacity style={styles.primary} onPress={primary.onPress} activeOpacity={0.85} accessibilityRole="button">
              <Text style={styles.primaryText}>{primary.label}</Text>
            </TouchableOpacity>
          )}
          {secondary && (
            <TouchableOpacity
              style={styles.secondary}
              onPress={secondary.onPress}
              hitSlop={8}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryText}>{secondary.label}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: 20,
      overflow: 'hidden',
    },
    top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    icon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    eyebrowText: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: colors.textSecondary,
    },
    title: {
      fontFamily: 'InstrumentSerif_400Regular',
      fontSize: 28,
      lineHeight: 32,
      color: colors.text,
      marginTop: 16,
    },
    body: { fontSize: 14, lineHeight: 20, color: colors.textSecondary, marginTop: 6 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 18 },
    primary: {
      backgroundColor: colors.white,
      borderRadius: radius.button,
      height: 42,
      paddingHorizontal: 20,
      justifyContent: 'center',
    },
    primaryText: { color: '#000000', fontSize: 14, fontWeight: '700' },
    secondary: { height: 42, justifyContent: 'center' },
    secondaryText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  });
