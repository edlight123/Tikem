/**
 * Location Detection Banner for Mobile
 * Shows when device region differs from saved profile country
 * Offers to update user's location preferences
 *
 * Design (2026-10-03 TestFlight feedback, "make this more premium"): a compact
 * FILLED card inset from the screen edges, not a full-width strip with a
 * hairline under it. The flag carries the place, one confident line names it,
 * and the actions are words, not icon circles: "Yes" as a small white pill and
 * "Change" as a quiet text button. Teal stays out of it (POSH: the chrome is
 * black, white and grey).
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { useFilters } from '../contexts/FiltersContext';
import { useI18n } from '../contexts/I18nContext';
import { getDeviceLocationInfo, DEFAULT_CITIES } from '../utils/deviceLocation';
import { locationLabel } from '../data/metros';
import { useTheme } from '../contexts/ThemeContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BANNER_DISMISSED_KEY = 'location_banner_dismissed';
const BANNER_DISMISSED_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days

/** ISO-2 country code to its flag emoji ("US" -> regional indicators U+S). */
function flagFor(code: string | null): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return '';
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65));
}

interface LocationDetectionBannerProps {
  /**
   * Opens the app's location picker. When given, the banner shows a quiet
   * "Change" action that remembers the dismissal and hands over to the picker.
   */
  onChangeLocation?: () => void;
}

export default function LocationDetectionBanner({ onChangeLocation }: LocationDetectionBannerProps = {}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
  const { user, userProfile, updateUserProfile } = useAuth();
  const { setUserCountry, setActiveCity } = useFilters();

  const [visible, setVisible] = useState(false);
  const [detectedCountry, setDetectedCountry] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  // 0 = hidden above the screen, 1 = resting in place.
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    checkLocationMismatch();
  }, [userProfile]);

  const checkLocationMismatch = async () => {
    try {
      // Check if banner was recently dismissed
      const dismissedData = await AsyncStorage.getItem(BANNER_DISMISSED_KEY);
      if (dismissedData) {
        const { timestamp, country } = JSON.parse(dismissedData);
        const now = Date.now();
        if (now - timestamp < BANNER_DISMISSED_EXPIRY) {
          // Still within dismiss period for same country
          const deviceInfo = getDeviceLocationInfo();
          if (deviceInfo.country === country) {
            return;
          }
        }
      }

      // Get device location
      const deviceInfo = getDeviceLocationInfo();
      const deviceCountry = deviceInfo.country;

      // Compare with user's saved country
      const profileCountry = userProfile?.default_country || 'HT';

      console.log('[LocationBanner] Device country:', deviceCountry, 'Profile country:', profileCountry);

      // Show banner if device country differs from profile
      if (deviceCountry !== profileCountry && deviceInfo.isSupported) {
        setDetectedCountry(deviceCountry);
        setVisible(true);

        // Animate in
        Animated.spring(progress, {
          toValue: 1,
          useNativeDriver: true,
          tension: 60,
          friction: 9,
        }).start();
      }
    } catch (error) {
      console.error('[LocationBanner] Error checking location:', error);
    }
  };

  const handleAccept = async () => {
    if (!detectedCountry) return;

    setUpdating(true);
    try {
      const defaultCity = DEFAULT_CITIES[detectedCountry] || '';

      // Update user profile if logged in
      if (user) {
        await updateUserProfile({
          default_country: detectedCountry,
          default_city: defaultCity,
        });
      }

      // Move the ONE active location to the detected country. setUserCountry
      // owns this now: it drops the old town (its metro does not exist here)
      // and forgets the persisted one, so the next launch cannot restore a
      // Port-au-Prince scope under a US country.
      setUserCountry(detectedCountry);
      setActiveCity(defaultCity);

      // Dismiss banner
      hideBanner();
    } catch (error) {
      console.error('[LocationBanner] Error updating location:', error);
    } finally {
      setUpdating(false);
    }
  };

  const rememberDismissal = async () => {
    if (detectedCountry) {
      await AsyncStorage.setItem(BANNER_DISMISSED_KEY, JSON.stringify({
        timestamp: Date.now(),
        country: detectedCountry,
      }));
    }
  };

  const handleDismiss = async () => {
    await rememberDismissal();
    hideBanner();
  };

  const handleChange = async () => {
    await rememberDismissal();
    hideBanner();
    onChangeLocation?.();
  };

  const hideBanner = () => {
    Animated.timing(progress, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      setVisible(false);
    });
  };

  if (!visible || !detectedCountry) return null;

  const city = locationLabel(DEFAULT_CITIES[detectedCountry] || '', detectedCountry);
  const flag = flagFor(detectedCountry);
  const inCountry = t(`locationBanner.inCountry.${detectedCountry}`);
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-(insets.top + 140), 0],
  });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.container,
        { top: insets.top + 8, opacity: progress, transform: [{ translateY }] },
      ]}
    >
      <View style={styles.card} accessibilityRole="alert">
        <View style={styles.row}>
          <View style={styles.flag}>
            <Text style={styles.flagText} allowFontScaling={false}>{flag}</Text>
          </View>

          <View style={styles.textContainer}>
            <Text style={styles.title} numberOfLines={2}>
              {t('locationBanner.title', { inCountry })}
            </Text>
            {!!city && (
              <Text style={styles.subtitle} numberOfLines={1}>
                {t('locationBanner.subtitle', { city })}
              </Text>
            )}
          </View>

          <TouchableOpacity
            onPress={handleDismiss}
            disabled={updating}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={t('locationBanner.notNow')}
            style={styles.close}
          >
            <X size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <View style={styles.actions}>
          {!!onChangeLocation && (
            <TouchableOpacity
              onPress={handleChange}
              disabled={updating}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              style={styles.changeButton}
            >
              <Text style={styles.changeText}>{t('locationBanner.change')}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.yesButton}
            onPress={handleAccept}
            disabled={updating}
            activeOpacity={0.85}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityRole="button"
          >
            {updating ? (
              <ActivityIndicator size="small" color={colors.background} />
            ) : (
              <Text style={styles.yesText}>{t('locationBanner.yes')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 1000,
  },
  // A fill, not a hairline: the card separates from the black canvas by being
  // lighter, with a soft shadow for lift over the header and the feed.
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 20,
    paddingTop: 14,
    paddingBottom: 12,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flag: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  flagText: {
    fontSize: 22,
  },
  textContainer: {
    flex: 1,
    paddingRight: 8,
  },
  title: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  close: {
    alignSelf: 'flex-start',
    padding: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 12,
    gap: 6,
  },
  changeButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  changeText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  yesButton: {
    minWidth: 72,
    height: 34,
    paddingHorizontal: 18,
    borderRadius: 17,
    // White on the dark canvas; inverts with the theme so it never vanishes.
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yesText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.background,
    letterSpacing: -0.1,
  },
});
