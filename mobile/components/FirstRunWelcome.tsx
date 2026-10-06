import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { font } from '../theme/tokens';
import WhitePillCTA from './WhitePillCTA';

const SEEN_KEY = 'tikem_welcome_seen_v1';
const { width: SCREEN_W } = Dimensions.get('window');
// The sheet has 12pt gutters each side; slides must match the ScrollView
// viewport exactly for paging to snap cleanly.
const SLIDE_W = SCREEN_W - 24;

interface FirstRunWelcomeProps {
  /** Root navigation ref — this component mounts outside any screen. */
  onCreateEvent: () => void;
}

/**
 * One-time, 3-slide welcome shown on first launch after login: what Tikèm is,
 * how tickets work at the door, and an invitation to host. Swipeable, skippable,
 * never shown again once dismissed (per-device AsyncStorage flag).
 */
export default function FirstRunWelcome({ onCreateEvent }: FirstRunWelcomeProps) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { user } = useAuth();
  const { t } = useI18n();

  const [visible, setVisible] = useState(false);
  const [page, setPage] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!user) return;
      try {
        const seen = await AsyncStorage.getItem(SEEN_KEY);
        if (alive && !seen) setVisible(true);
      } catch {
        // Storage failure → skip the welcome rather than risk showing it forever.
      }
    })();
    return () => {
      alive = false;
    };
  }, [user]);

  const dismiss = useCallback(() => {
    setVisible(false);
    AsyncStorage.setItem(SEEN_KEY, '1').catch(() => {});
  }, []);

  const handleCreate = useCallback(() => {
    dismiss();
    onCreateEvent();
  }, [dismiss, onCreateEvent]);

  if (!visible) return null;

  const slides = [
    {
      icon: 'compass-outline' as const,
      title: t('welcome.slide1Title'),
      body: t('welcome.slide1Body'),
    },
    {
      icon: 'qr-code-outline' as const,
      title: t('welcome.slide2Title'),
      body: t('welcome.slide2Body'),
    },
    {
      icon: 'mic-outline' as const,
      title: t('welcome.slide3Title'),
      body: t('welcome.slide3Body'),
    },
  ];
  const isLast = page === slides.length - 1;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <TouchableOpacity
            style={styles.skip}
            onPress={dismiss}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={t('welcome.skip')}
          >
            <Text style={styles.skipText}>{t('welcome.skip')}</Text>
          </TouchableOpacity>

          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) =>
              setPage(Math.round(e.nativeEvent.contentOffset.x / e.nativeEvent.layoutMeasurement.width))
            }
          >
            {slides.map((s, i) => (
              <View key={i} style={styles.slide}>
                <View style={styles.iconRing}>
                  <Ionicons name={s.icon} size={30} color={colors.text} />
                </View>
                <Text style={styles.title}>{s.title}</Text>
                <Text style={styles.body}>{s.body}</Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.dots}>
            {slides.map((_, i) => (
              <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
            ))}
          </View>

          {isLast ? (
            <View style={styles.actions}>
              <WhitePillCTA label={t('welcome.explore')} onPress={dismiss} />
              <TouchableOpacity
                style={styles.secondary}
                onPress={handleCreate}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryText}>{t('welcome.host')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.actions}>
              <WhitePillCTA
                label={t('welcome.next')}
                onPress={() => {
                  const next = page + 1;
                  scrollRef.current?.scrollTo({ x: next * SLIDE_W, animated: true });
                  setPage(next);
                }}
              />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.72)',
      justifyContent: 'flex-end',
    },
    // Bottom sheet, full-bleed width minus gutters; height driven by content.
    sheet: {
      marginHorizontal: 12,
      marginBottom: 24,
      borderRadius: 24,
      backgroundColor: colors.surface,
      paddingTop: 18,
      paddingBottom: 24,
      overflow: 'hidden',
    },
    skip: {
      alignSelf: 'flex-end',
      paddingHorizontal: 20,
      paddingBottom: 4,
    },
    skipText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    slide: {
      width: SLIDE_W,
      paddingHorizontal: 20,
      alignItems: 'center',
      paddingTop: 6,
    },
    iconRing: {
      width: 64,
      height: 64,
      borderRadius: 32,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 18,
    },
    title: {
      fontFamily: font.serif,
      fontSize: 28,
      lineHeight: 34,
      color: colors.text,
      textAlign: 'center',
    },
    body: {
      marginTop: 10,
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
      textAlign: 'center',
      maxWidth: 300,
    },
    dots: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 7,
      marginTop: 18,
      marginBottom: 16,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.border,
    },
    dotActive: {
      backgroundColor: colors.text,
    },
    actions: {
      paddingHorizontal: 20,
      gap: 4,
    },
    secondary: {
      alignItems: 'center',
      paddingVertical: 13,
    },
    secondaryText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.textSecondary,
    },
  });
