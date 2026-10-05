import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Check, X, Search as SearchIcon } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { useFilters } from '../contexts/FiltersContext';
import { useAuth } from '../contexts/AuthContext';
import { COUNTRIES, getFeaturedCities } from '../types/filters';
import { METROS } from '../data/metros';
import { RADIUS, SPACING } from '../config/brand';

// Accent/case-insensitive match so "petion" finds "Pétion-Ville" and "cote"
// finds "Côte-des-Arcadins". Deliberately not locale-aware collation: strip
// combining marks so every language typed on any keyboard hits the same rows.
const normalize = (s: any): string =>
  (s ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const matchesQuery = (candidate: string, query: string): boolean =>
  normalize(candidate).includes(normalize(query));

interface LocationPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Currently selected city ('' = all areas). */
  selectedCity?: string;
  /** Called with the chosen city ('' means "all areas" in the country). */
  onSelect: (city: string) => void;
}

/**
 * Bottom-sheet location picker. Location is the primary way people browse here
 * (Haiti-first), so tapping the header location opens this to switch country
 * and jump to a town.
 */
export default function LocationPickerSheet({
  visible,
  onClose,
  selectedCity = '',
  onSelect,
}: LocationPickerSheetProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { userCountry, setUserCountry } = useFilters();
  const { user, userProfile, updateUserProfile } = useAuth();

  // Signed in, the choice also goes on the profile: FiltersContext re-applies
  // the profile's default_country on every launch, so a pick kept only on the
  // device was undone at the next cold start. Best-effort (offline, demo).
  const persistToProfile = (patch: { default_country?: string; default_city?: string }) => {
    if (!user?.uid || !userProfile) return;
    const changed =
      (patch.default_country !== undefined && patch.default_country !== (userProfile.default_country || '')) ||
      (patch.default_city !== undefined && patch.default_city !== (userProfile.default_city || ''));
    if (!changed) return;
    updateUserProfile(patch).catch((e) => console.warn('[LocationPickerSheet] Could not save location', e));
  };
  const insets = useSafeAreaInsets();
  const styles = getStyles(colors);

  const [areaQuery, setAreaQuery] = useState('');
  /** Swaps the list below from areas to countries. Closed by default. */
  const [pickingCountry, setPickingCountry] = useState(false);

  // You pick a METRO, not a street address: choosing Port-au-Prince has to
  // include Pétion-Ville and Delmas, and choosing Miami has to include Fort
  // Lauderdale. Listing the raw featured cities offered "Pétion-Ville" and
  // "Port-au-Prince" as if they were different places to browse. The satellite
  // towns are shown as a hint so the scope is never a surprise.
  const areas = useMemo(() => {
    const metros = METROS.filter((m) => m.country === userCountry);
    if (metros.length > 0) {
      return metros.map((m) => ({
        value: m.label,
        label: m.label,
        hint: m.cities.filter((c) => c !== m.label).slice(0, 3).join(' · '),
      }));
    }
    // A country we have no metro map for yet — fall back to its towns.
    return getFeaturedCities(userCountry).map((c) => ({ value: c, label: c, hint: '' }));
  }, [userCountry]);
  const trimmedQuery = areaQuery.trim();

  // "All areas" is the clear-selection affordance, not a searchable row, so it
  // is rendered outside this list and always stays on top. Searching also looks
  // inside the hint, so typing "delmas" finds Port-au-Prince.
  const visibleCities = useMemo(
    () =>
      trimmedQuery
        ? areas.filter(
            (a) => matchesQuery(a.label, trimmedQuery) || matchesQuery(a.hint, trimmedQuery)
          )
        : areas,
    [areas, trimmedQuery]
  );

  // A filter left over from a previous visit would make the list look empty.
  useEffect(() => {
    if (!visible) setAreaQuery('');
  }, [visible]);

  const renderCityRow = (label: string, value: string, hint?: string) => {
    const active = selectedCity === value;
    return (
      <TouchableOpacity
        key={value || '__all__'}
        style={[styles.cityRow, active && styles.cityRowActive]}
        onPress={() => {
          onSelect(value);
          persistToProfile({ default_country: userCountry, default_city: value });
        }}
        activeOpacity={0.8}
      >
        <MapPin size={18} color={active ? colors.primary : colors.textSecondary} />
        <View style={styles.cityTextWrap}>
          <Text style={[styles.cityText, active && styles.cityTextActive]}>{label}</Text>
          {!!hint && (
            <Text style={styles.cityHint} numberOfLines={1}>
              {hint}
            </Text>
          )}
        </View>
        {active && <Check size={18} color={colors.primary} />}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{t('location.title')}</Text>
              <Text style={styles.subtitle}>{t('location.subtitle')}</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/*
            THE ACTIVE COUNTRY, not a rack of five.
            This sheet's job is choosing an AREA; the country is context for
            that list, and showing every option turned the top of the sheet into
            a second picker competing with the first. It reads as one line now,
            and switching country swaps the list below — the same idiom as the
            header, where you tap where you are to change it.
          */}
          <View style={styles.countryLine}>
            <Text style={styles.sectionLabel}>{t('location.country').toUpperCase()}</Text>
            <TouchableOpacity
              onPress={() => setPickingCountry((v) => !v)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
            >
              <Text style={styles.countryChange}>
                {pickingCountry ? t('common.cancel') : t('location.changeCountry')}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.countryValue}>
            {COUNTRIES.find((c) => c.code === userCountry)?.name || ''}
          </Text>

          {/* Area search — scopes the list below it. Never auto-focused: the
              keyboard must not cover the towns the moment the sheet opens. */}
          <View style={styles.searchField}>
            <SearchIcon size={18} color={colors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder={t('location.searchPlaceholder')}
              placeholderTextColor={colors.textSecondary}
              selectionColor={colors.primary}
              value={areaQuery}
              onChangeText={setAreaQuery}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={t('location.searchPlaceholder')}
            />
            {areaQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => setAreaQuery('')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('location.clearSearch')}
              >
                <X size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {/* The list is either countries or areas — never both at once. */}
          <Text style={styles.sectionLabel}>
            {(pickingCountry ? t('location.country') : t('location.area')).toUpperCase()}
          </Text>
          <ScrollView
            style={styles.cityList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {pickingCountry ? (
              COUNTRIES.map((c) => (
                <TouchableOpacity
                  key={c.code}
                  style={[styles.cityRow, userCountry === c.code && styles.cityRowActive]}
                  onPress={() => {
                    // A new country has different towns, so a stale query would
                    // make its list look empty.
                    setAreaQuery('');
                    setUserCountry(c.code);
                    // A new country's towns differ, so the old one goes too.
                    persistToProfile(
                      c.code !== userCountry
                        ? { default_country: c.code, default_city: '' }
                        : { default_country: c.code },
                    );
                    setPickingCountry(false);
                  }}
                  activeOpacity={0.8}
                >
                  <MapPin size={18} color={userCountry === c.code ? colors.primary : colors.textSecondary} />
                  <View style={styles.cityTextWrap}>
                    <Text
                      style={[styles.cityText, userCountry === c.code && styles.cityTextActive]}
                    >
                      {c.name}
                    </Text>
                  </View>
                  {userCountry === c.code ? <Check size={18} color={colors.primary} /> : null}
                </TouchableOpacity>
              ))
            ) : (
              <>
            {renderCityRow(t('location.allAreas'), '')}
            {visibleCities.map((area) => renderCityRow(area.label, area.value, area.hint))}
            {trimmedQuery.length > 0 && visibleCities.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>{t('location.noAreasMatch')}</Text>
                <Text style={styles.emptyQuery} numberOfLines={2}>
                  “{trimmedQuery}”
                </Text>
              </View>
            )}
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.6)',
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: RADIUS.xl,
      borderTopRightRadius: RADIUS.xl,
      paddingHorizontal: SPACING.lg,
      paddingTop: 10,
      maxHeight: '80%',
      borderTopWidth: 1,
      borderColor: colors.border,
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginBottom: 14,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: 18,
    },
    title: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.text,
      letterSpacing: -0.3,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 2,
    },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: RADIUS.sm,
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSecondary,
      letterSpacing: 0.6,
      marginBottom: 10,
    },
    countryLine: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    countryValue: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 14,
    },
    countryChange: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.primary,
      marginBottom: 10,
    },
    countryRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: SPACING.sm,
      paddingBottom: 4,
    },
    countryChip: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: RADIUS.sm,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
    },
    countryChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    countryChipText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    countryChipTextActive: {
      color: colors.onPrimary,
    },
    searchField: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.surfaceMuted,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginTop: 14,
      marginBottom: 18,
    },
    searchInput: {
      flex: 1,
      fontSize: 15,
      color: colors.text,
      padding: 0,
    },
    cityList: {
      // Shrink to whatever the sheet has left (RN defaults flexShrink to 0) so
      // the list scrolls inside itself instead of being clipped — matters most
      // when the keyboard is up and the sheet is short.
      flexShrink: 1,
      marginTop: 14,
      marginBottom: 4,
    },
    emptyState: {
      paddingVertical: 24,
      paddingHorizontal: 14,
      alignItems: 'center',
    },
    emptyTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    emptyQuery: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 4,
      textAlign: 'center',
    },
    cityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: 'transparent',
      marginBottom: 8,
      backgroundColor: colors.surfaceMuted,
    },
    cityRowActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    cityTextWrap: {
      flex: 1,
    },
    cityText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    // The towns this area covers — the metro rule, stated plainly.
    cityHint: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    cityTextActive: {
      color: colors.primarySoftText,
      fontWeight: '700',
    },
  });
