import React, { useRef } from 'react';
import { Animated, Linking, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import { font } from '../theme/tokens';
import { PHOTO_CREDITS, type PhotoCredit } from '../lib/photoCredits';

/**
 * Profile → Photo credits: who took each bundled photograph and its license
 * (CC BY / CC BY-SA require it). A plain list, one row per photo; a row opens
 * the photo's source page.
 */
export default function PhotoCreditsScreen({ navigation }: any) {
  const { colors, isDark } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const styles = getStyles(colors);
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const scrollY = useRef(new Animated.Value(0)).current;

  const renderRow = ({ item }: { item: PhotoCredit }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => Linking.openURL(item.source).catch(() => {})}
      activeOpacity={0.7}
      accessibilityRole="link"
    >
      <Text style={styles.title} numberOfLines={2}>
        {item.title}
      </Text>
      <Text style={styles.meta} numberOfLines={2}>
        {item.author} · {item.license}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
      <OverlayHeader onHeight={onHeight} style={styles.header} scrollY={scrollY}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('profile.photoCredits')}
        </Text>
        <View style={styles.backButton} />
      </OverlayHeader>
      <Animated.FlatList
        data={PHOTO_CREDITS}
        keyExtractor={(item) => item.key}
        renderItem={renderRow}
        contentContainerStyle={{ paddingTop: headerH + 8, paddingBottom: insets.bottom + 32 }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
        scrollEventThrottle={16}
      />
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: 8 },
    backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', fontFamily: font.serif, fontSize: 22, color: colors.text },
    row: { paddingHorizontal: 20, paddingVertical: 12 },
    title: { fontSize: 15, fontWeight: '600', color: colors.text },
    meta: { fontSize: 13, color: colors.textSecondary, marginTop: 3 },
  });
