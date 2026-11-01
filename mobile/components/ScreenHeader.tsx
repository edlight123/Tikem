import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  /** Transparent header (e.g. over a hero image). */
  transparent?: boolean;
}

/** A consistent top header for detail / flow screens. */
export default function ScreenHeader({ title, subtitle, onBack, right, transparent }: ScreenHeaderProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = getStyles(colors);

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top + 8,
          backgroundColor: transparent ? 'transparent' : colors.surface,
          borderBottomColor: transparent ? 'transparent' : colors.border,
        },
      ]}
    >
      {!transparent && <StatusBar barStyle={colors.text === '#0F172A' ? 'dark-content' : 'light-content'} />}
      <View style={styles.row}>
        {onBack ? (
          <TouchableOpacity style={styles.backBtn} onPress={onBack} hitSlop={10} activeOpacity={0.7}>
            <ChevronLeft size={24} color={transparent ? '#FFFFFF' : colors.text} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}

        <View style={styles.titleWrap}>
          <Text
            style={[styles.title, transparent && styles.titleOnImage]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {!!subtitle && (
            <Text style={[styles.subtitle, transparent && styles.subtitleOnImage]} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>

        <View style={styles.right}>{right}</View>
      </View>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      paddingBottom: 12,
      paddingHorizontal: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      minHeight: 36,
    },
    backBtn: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    titleWrap: {
      flex: 1,
      paddingHorizontal: 4,
    },
    title: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.text,
      letterSpacing: -0.3,
    },
    titleOnImage: {
      color: '#FFFFFF',
      textShadowColor: 'rgba(0,0,0,0.4)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 6,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '500',
      marginTop: 1,
    },
    subtitleOnImage: {
      color: 'rgba(255,255,255,0.9)',
    },
    right: {
      minWidth: 40,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
  });
