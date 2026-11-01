/**
 * Location Detection Banner for Mobile
 * Shows when device region differs from saved profile country
 * Offers to update user's location preferences
 *
 * Design (2026-10-29 TestFlight: "what the heck is this? … more subtle and
 * premium"): one slim filled row, not a card with a headline and buttons.
 * The flag, one quiet question ("Wè evènman nan Miami?"), then the answers as
 * words: "Chanje" in grey, "Wi" in white, and a small ×. Teal stays out of it
 * (POSH: the chrome is black, white and grey).
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
const BANNER_ACCEPTED_KEY = 'location_banner_accepted';
// Written by FiltersContext; the country the user last browsed.
const RESOLVED_COUNTRY_KEY = 'resolved_user_country';

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
  const { user, userProfile, loading: authLoading, updateUserProfile } = useAuth();
  const { setUserCountry, setActiveCity } = useFilters();

  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);
  visibleRef.current = visible;
  const [detectedCountry, setDetectedCountry] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  // 0 = hidden above the screen, 1 = resting in place.
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Wait for auth to settle: before the profile loads, a signed-in user who
    // already said "Yes" would read as the HT default and get asked again.
    // A signed-in user's profile arrives after auth settles; wait for it too.
    if (authLoading || (user && !userProfile)) return;
    checkLocationMismatch();
  }, [authLoading, user, userProfile?.default_country]);

  const checkLocationMismatch = async () => {
    try {
      const deviceInfo = getDeviceLocationInfo();
      const deviceCountry = deviceInfo.country;

      // The user already confirmed this country ("Yes"). Remembered on the
      // device, so it also holds for guests and if the profile write failed.
      const accepted = await AsyncStorage.getItem(BANNER_ACCEPTED_KEY);
      if (accepted === deviceCountry) return hideIfShown();

      // Check if banner was recently dismissed for this same country
      const dismissedData = await AsyncStorage.getItem(BANNER_DISMISSED_KEY);
      if (dismissedData) {
        const { timestamp, country } = JSON.parse(dismissedData);
        if (Date.now() - timestamp < BANNER_DISMISSED_EXPIRY && deviceCountry === country) {
          return hideIfShown();
        }
      }

      // Compare with the user's saved country; guests fall back to the country
      // they last browsed (persisted by FiltersContext), then to Haiti.
      const profileCountry =
        userProfile?.default_country ||
        (await AsyncStorage.getItem(RESOLVED_COUNTRY_KEY)) ||
        'HT';

      if (deviceCountry === profileCountry || !deviceInfo.isSupported) {
        return hideIfShown();
      }

      setDetectedCountry(deviceCountry);
      setVisible(true);
      Animated.spring(progress, {
        toValue: 1,
        useNativeDriver: true,
        tension: 60,
        friction: 9,
      }).start();
    } catch (error) {
      console.error('[LocationBanner] Error checking location:', error);
    }
  };

  const hideIfShown = () => {
    if (visibleRef.current) hideBanner();
  };

  const handleAccept = async () => {
    if (!detectedCountry) return;

    setUpdating(true);
    const defaultCity = DEFAULT_CITIES[detectedCountry] || '';
    // Remember the answer on the device first, so "Yes" sticks even for a
    // guest or when the profile write below fails.
    await AsyncStorage.setItem(BANNER_ACCEPTED_KEY, detectedCountry).catch(() => {});

    // Move the ONE active location to the detected country. setUserCountry
    // owns this: it drops the old town (its metro does not exist here) and
    // forgets the persisted one, so the next launch cannot restore a
    // Port-au-Prince scope under a US country.
    setUserCountry(detectedCountry);
    setActiveCity(defaultCity);

    if (user) {
      try {
        await updateUserProfile({
          default_country: detectedCountry,
          default_city: defaultCity,
        });
      } catch (error) {
        console.error('[LocationBanner] Error updating location:', error);
      }
    }

    setUpdating(false);
    hideBanner();
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
    outputRange: [-(insets.top + 80), 0],
  });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.container,
        { top: insets.top + 8, opacity: progress, transform: [{ translateY }] },
      ]}
    >
      <View style={styles.bar} accessibilityRole="alert">
        <Text style={styles.flagText} allowFontScaling={false}>{flag}</Text>
        <Text style={styles.question} numberOfLines={1}>
          {city
            ? t('locationBanner.subtitle', { city })
            : t('locationBanner.title', { inCountry })}
        </Text>

        {!!onChangeLocation && (
          <TouchableOpacity
            onPress={handleChange}
            disabled={updating}
            hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
            accessibilityRole="button"
            style={styles.action}
          >
            <Text style={styles.changeText}>{t('locationBanner.change')}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={handleAccept}
          disabled={updating}
          hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
          accessibilityRole="button"
          style={styles.action}
        >
          {updating ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Text style={styles.yesText}>{t('locationBanner.yes')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleDismiss}
          disabled={updating}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('locationBanner.notNow')}
          style={styles.close}
        >
          <X size={14} color={colors.textTertiary} />
        </TouchableOpacity>
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
  // A fill, not a hairline: one slim raised row with a soft shadow for lift
  // over the header and the feed.
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    paddingLeft: 14,
    paddingRight: 10,
    borderRadius: 4,
    backgroundColor: colors.surfaceRaised,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 10,
  },
  flagText: {
    fontSize: 16,
    marginRight: 10,
  },
  question: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  action: {
    paddingHorizontal: 8,
    minWidth: 28,
    alignItems: 'center',
  },
  changeText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  yesText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  close: {
    marginLeft: 4,
    padding: 4,
  },
});
