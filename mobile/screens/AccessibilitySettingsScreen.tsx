import React, { useRef } from 'react';
import { Animated, StatusBar, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import { ListGroup, ListRow } from '../components/ui/ListRow';
import { Switch } from '../components/ui/Switch';
import { Text } from '../components/ui/Text';
import { font } from '../theme/tokens';
import { setA11yPrefs, useA11yPrefs, useSystemReducedMotion } from '../lib/a11y';

/**
 * Profile > Accessibility: Reduce motion (follow the phone, or always),
 * Bolder text and Higher contrast. Saved on this device only (lib/a11y).
 * Text size itself follows the phone's own setting.
 */
export default function AccessibilitySettingsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const prefs = useA11yPrefs();
  const systemReduced = useSystemReducedMotion();
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const scrollY = useRef(new Animated.Value(0)).current;
  const styles = getStyles(colors);

  const alwaysReduce = prefs.reduceMotion === 'always';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
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
        <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
          {t('a11y.title')}
        </Text>
        <View style={styles.backButton} />
      </OverlayHeader>
      <Animated.ScrollView
        contentContainerStyle={{ paddingTop: headerH + 12, paddingBottom: insets.bottom + 32, paddingHorizontal: 16 }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
        scrollEventThrottle={16}
      >
        <ListGroup inset={16}>
          <ListRow
            title={t('a11y.reduceMotion')}
            subtitle={
              systemReduced && !alwaysReduce ? t('a11y.reduceMotionSystemOn') : t('a11y.reduceMotionHint')
            }
            trailing={
              <Switch
                value={alwaysReduce || systemReduced}
                // With the phone's own setting on, motion is already reduced:
                // the switch shows that and can't turn it back on from here.
                disabled={systemReduced && !alwaysReduce}
                onValueChange={(v) => setA11yPrefs({ reduceMotion: v ? 'always' : 'system' })}
                accessibilityLabel={t('a11y.reduceMotion')}
              />
            }
          />
          <ListRow
            title={t('a11y.boldText')}
            subtitle={t('a11y.boldTextHint')}
            trailing={
              <Switch
                value={prefs.boldText}
                onValueChange={(v) => setA11yPrefs({ boldText: v })}
                accessibilityLabel={t('a11y.boldText')}
              />
            }
          />
          <ListRow
            title={t('a11y.highContrast')}
            subtitle={t('a11y.highContrastHint')}
            trailing={
              <Switch
                value={prefs.highContrast}
                onValueChange={(v) => setA11yPrefs({ highContrast: v })}
                accessibilityLabel={t('a11y.highContrast')}
              />
            }
          />
        </ListGroup>
        <Text variant="caption" style={styles.footnote}>
          {t('a11y.textSizeNote')}
        </Text>
      </Animated.ScrollView>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: 8 },
    backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', fontFamily: font.serif, fontSize: 22, color: colors.text },
    footnote: { marginTop: 12, paddingHorizontal: 4 },
  });
