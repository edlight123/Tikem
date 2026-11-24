import React from 'react';
import { useCaptionLines } from '../lib/a11y';
import { View, Text, StyleSheet } from 'react-native';
import { Touchable } from './ui/Touchable';
import { ArrowRight } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { type as TYPE, font } from '../theme/tokens';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  onViewAll?: () => void;
  /** Right-aligned slot for callers that need something other than "see all"
      (e.g. a payout region's "action needed"). Ignored when onViewAll is set. */
  trailing?: React.ReactNode;
  /**
   * How many lines the subtitle may use. One is right for a home rail, where the
   * subtitle is a flourish and the row must stay a fixed height. A settings
   * screen explaining a decision needs the whole sentence — clipping it at
   * "change it any ti…" makes the instruction useless.
   */
  subtitleLines?: number;
}

/**
 * Editorial section header: a lowercase eyebrow label ("for you", "upcoming
 * events") with a quiet grey "see all →" link aligned right — teal is kept
 * for semantic state, and eight teal links down the home feed read as
 * decoration. Subtitles are optional and kept tight.
 */
export default function SectionHeader({
  title,
  subtitle,
  onViewAll,
  trailing,
  subtitleLines = 1,
}: SectionHeaderProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = getStyles(colors);
  // Larger text: a long section title wraps to a second line instead of clipping.
  const titleLines = useCaptionLines(1);

  return (
    <View style={styles.row}>
      <View style={styles.titleWrap}>
        <Text style={styles.title} numberOfLines={titleLines} accessibilityRole="header">
          {title.toLowerCase()}
        </Text>
        {!!subtitle && (
          <Text style={styles.subtitle} numberOfLines={subtitleLines}>
            {subtitle}
          </Text>
        )}
      </View>
      {onViewAll ? (
        <Touchable
          style={styles.viewAll}
          onPress={onViewAll}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${t('common.viewAll')}, ${title}`}
        >
          <Text style={styles.viewAllText}>{t('common.viewAll').toLowerCase()}</Text>
          <ArrowRight size={15} color={colors.textSecondary} />
        </Touchable>
      ) : (
        trailing ?? null
      )}
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
      gap: 12,
    },
    titleWrap: {
      flex: 1,
    },
    title: {
      ...TYPE.sectionEyebrow,
      // Italic serif, as on the website. Instrument Serif has one weight, so
      // the eyebrow's 600 is reset: a bold request only fakes it.
      fontFamily: font.serif,
      fontWeight: '400',
      fontSize: 22,
      letterSpacing: 0,
      color: colors.text,
    },
    subtitle: {
      fontSize: 13,
      letterSpacing: 0.4,
      color: colors.textSecondary,
      marginTop: 4,
    },
    viewAll: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 4,
      paddingLeft: 8,
    },
    viewAllText: {
      fontSize: 13,
      letterSpacing: 0.4,
      color: colors.textSecondary,
    },
  });

