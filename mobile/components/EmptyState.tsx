import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import WhitePillCTA from './WhitePillCTA';
import type { ArtPiece } from '../lib/artLibrary';
import { radius } from '../theme/tokens';

interface EmptyStateProps {
  /** A lucide icon component (preferred) … */
  icon?: LucideIcon;
  /** … or an emoji fallback. */
  emoji?: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
  /**
   * A piece from lib/artLibrary for the BIG, whole-screen empty states (no
   * tickets, no favorites, nothing found…). Replaces the icon with a poster of
   * the art; the title and line sit on it over a bottom-weighted scrim, and the
   * one white pill sits below. Ignored when `compact` (inline list empties
   * stay quiet).
   */
  art?: ArtPiece;
}

/** Widest the art poster gets, so it stays a poster on a tablet. */
const ART_MAX_WIDTH = 360;

/**
 * The empty-state formula (POSH §2.6): a thin CENTERED OUTLINE icon on the bare
 * canvas → a bold headline → ONE muted explanatory line → ONE white-pill CTA.
 * Never more. No teal-filled disc, no teal button — the CTA is the single
 * white primary action.
 *
 * With `art`, the icon becomes a 4:5 poster of Tikèm art (the poster art is
 * the only colour on the black frame), and the headline + line are set on it.
 */
export default function EmptyState({
  icon: Icon,
  emoji,
  title,
  subtitle,
  actionLabel,
  onAction,
  compact,
  art,
}: EmptyStateProps) {
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const styles = getStyles(colors);

  if (art && !compact) {
    // 4:5 like the art itself, but never taller than half the screen, so the
    // CTA stays above the fold under a header on a small phone (there the
    // crop simply gets wider; `cover` keeps the art centred).
    const posterWidth = Math.min(width - 48, ART_MAX_WIDTH);
    const posterHeight = Math.min(posterWidth * 1.25, height * 0.5);
    return (
      <View style={styles.artContainer}>
        <View style={[styles.poster, { width: posterWidth, height: posterHeight }]}>
          <Image
            source={art.source}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory"
            accessibilityLabel={art.alt}
          />
          {/* Bottom-weighted scrim: the art breathes at the top, the words
              sit on near-black at the bottom. No box behind the text. */}
          <LinearGradient
            colors={
              art.scrim === 'strong'
                ? ['rgba(10,10,10,0)', 'rgba(10,10,10,0.55)', 'rgba(10,10,10,0.96)']
                : ['rgba(10,10,10,0)', 'rgba(10,10,10,0.35)', 'rgba(10,10,10,0.92)']
            }
            locations={art.scrim === 'strong' ? [0.25, 0.55, 1] : [0.35, 0.6, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.posterText}>
            {/* A landmark names itself, so every empty screen also shows a
                piece of Haiti and says where it is. */}
            {!!art.place && (
              <Text style={styles.artPlace} numberOfLines={1}>
                {art.place.toUpperCase()}
              </Text>
            )}
            <Text style={styles.artTitle}>{title}</Text>
            {!!subtitle && <Text style={styles.artSubtitle}>{subtitle}</Text>}
          </View>
        </View>
        {actionLabel && onAction && (
          <WhitePillCTA
            label={actionLabel}
            onPress={onAction}
            style={{ ...styles.artCta, width: posterWidth }}
          />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, compact && styles.compact]}>
      {Icon ? (
        <Icon size={40} color={colors.textSecondary} strokeWidth={1.5} style={styles.icon} />
      ) : (
        <Text style={styles.emoji}>{emoji || '✨'}</Text>
      )}
      <Text style={styles.title}>{title}</Text>
      {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {actionLabel && onAction && (
        <WhitePillCTA label={actionLabel} onPress={onAction} style={styles.cta} />
      )}
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      paddingVertical: 56,
    },
    compact: {
      paddingVertical: 32,
    },
    icon: {
      marginBottom: 16,
    },
    emoji: {
      fontSize: 40,
      marginBottom: 16,
    },
    title: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'center',
      letterSpacing: -0.3,
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: 6,
      lineHeight: 20,
      maxWidth: 300,
    },
    cta: {
      marginTop: 24,
    },
    // ── art variant ──
    artContainer: {
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingTop: 24,
      paddingBottom: 40,
    },
    poster: {
      borderRadius: radius.poster,
      overflow: 'hidden',
      // The fill shows for the instant before the bundled art decodes.
      backgroundColor: colors.surface,
      justifyContent: 'flex-end',
    },
    posterText: {
      paddingHorizontal: 20,
      paddingBottom: 20,
    },
    artPlace: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1.6,
      color: 'rgba(255,255,255,0.62)',
      marginBottom: 8,
    },
    // Fixed white: the text sits on the dark scrim in every theme.
    artTitle: {
      fontSize: 24,
      fontWeight: '800',
      color: '#FFFFFF',
      letterSpacing: -0.4,
      lineHeight: 28,
    },
    artSubtitle: {
      fontSize: 14,
      lineHeight: 20,
      color: 'rgba(255,255,255,0.78)',
      marginTop: 6,
    },
    artCta: {
      marginTop: 20,
    },
  });
