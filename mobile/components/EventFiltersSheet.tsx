import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
    PanResponder,
  LayoutChangeEvent
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { X } from 'lucide-react-native';
import { useFilters } from '../contexts/FiltersContext';
import { useI18n } from '../contexts/I18nContext';
import { getCategoryLabel } from '../lib/categories';
import { formatPrice } from '../lib/currency';
import RangeSlider from './RangeSlider';
import { 
  CATEGORIES,
  COUNTRIES,
  CITIES_BY_COUNTRY,
  CURRENCY_BY_COUNTRY,
  DATE_OPTIONS,
  EVENT_TYPE_OPTIONS,
  DateFilter,
  PriceFilter,
  EventTypeFilter
} from '../types/filters';
import { useTheme } from '../contexts/ThemeContext';
import { radius } from '../theme/tokens';

// Every filter chip / segment is visually 30pt tall (see getStyles) so the rows
// read as compact. hitSlop grows the effective touch target back to the 44pt
// minimum: (44 - 30) / 2 = 7pt top+bottom, plus 4pt each side (half the 8pt
// column gutter) so neighbouring chips never claim the same pixel.
const CHIP_HIT_SLOP = { top: 7, bottom: 7, left: 4, right: 4 } as const;
// Segments are full-bleed inside their track, so only the vertical axis needs
// growing: (44 - 28) / 2 = 8pt.
const SEGMENT_HIT_SLOP = { top: 8, bottom: 8, left: 0, right: 0 } as const;

// Fixed part of the footer's height: 16pt top padding + the 51pt-tall buttons.
// The variable part is the bottom safe-area inset the footer now absorbs (see
// `footerBottomPad`), and the sum is only used for the very first frame, before
// the footer reports its real height via onLayout.
const FOOTER_FIXED_HEIGHT = 67;
// Floor for the footer's bottom padding on devices with no home indicator
// (insets.bottom === 0), so the buttons never sit flush on the sheet edge.
const FOOTER_MIN_BOTTOM_PAD = 16;

export default function EventFiltersSheet() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { t, language } = useI18n();
  const insets = useSafeAreaInsets();
  const locale = language === 'fr' ? 'fr-FR' : language === 'ht' ? 'fr-HT' : 'en-US';
  const {
    draftFilters,
    isModalOpen,
    setDraftFilters,
    closeFiltersModal,
    applyFilters,
    resetFilters,
    countActiveFilters
  } = useFilters();

  const activeCount = countActiveFilters();

  // Price buckets are currency-aware: they follow the currently-selected FILTER
  // country (HTG for Haiti, USD for US, CAD for Canada, EUR for France) rather
  // than being hardcoded to HTG. Thresholds + symbols come from CURRENCY_BY_COUNTRY.
  const filterCountry = draftFilters.country || 'HT';
  const priceCurrencyCode = CURRENCY_BY_COUNTRY[filterCountry]?.code || 'HTG';

  // The custom min–max range is now the STANDARD price control. Its ceiling and
  // step scale with the selected country's currency (low-denomination HTG/DOP
  // need a higher ceiling than USD/CAD/EUR).
  const isHighDenomination = priceCurrencyCode === 'HTG' || priceCurrencyCode === 'DOP';
  const priceCeiling = isHighDenomination ? 10000 : 200;
  const priceStep = isHighDenomination ? 100 : 5;

  // Shared price formatter keyed by the selected country's currency code so the
  // readout ("1,500 HTG" / "$25" / "RD$300") matches the cards everywhere.
  const priceLabel = (amount: number) => formatPrice(amount, priceCurrencyCode);

  const priceIsCustom = draftFilters.price === 'custom';
  const rangeMin = priceIsCustom ? draftFilters.customPriceRange?.min ?? 0 : 0;
  const rawMax = priceIsCustom ? draftFilters.customPriceRange?.max ?? priceCeiling : priceCeiling;
  // An upper bound at (or above) the ceiling means "and up" — stored as Infinity
  // so applyFilters imposes no maximum.
  const maxIsOpen = !Number.isFinite(rawMax) || rawMax >= priceCeiling;
  const sliderMax = maxIsOpen ? priceCeiling : rawMax;
  const rangeReadout =
    draftFilters.price === 'free'
      ? t('filters.priceOptions.free')
      : !priceIsCustom
        ? t('filters.priceOptions.any')
        : maxIsOpen
          ? `${priceLabel(rangeMin)}+`
          : `${priceLabel(rangeMin)} – ${priceLabel(sliderMax)}`;

  const [showDatePicker, setShowDatePicker] = useState(false);

  // The last row of chips used to end up jammed against — and visually cut off
  // by — the pinned footer's top rule. The scroll content now ends with the
  // footer's MEASURED height plus 24pt of breathing room (replacing a hardcoded
  // 100pt spacer), so whatever the footer grows to, the final row can always be
  // scrolled fully clear of it.
  const [footerHeight, setFooterHeight] = useState(0);
  // The footer — not an outer SafeAreaView — owns the bottom inset, so its
  // surface runs all the way to the physical bottom edge of the sheet. With an
  // outer SafeAreaView the inset was reserved BELOW the footer, which is what
  // left a black strip under it (the footer read as a floating slab).
  const footerBottomPad = Math.max(insets.bottom, FOOTER_MIN_BOTTOM_PAD);
  const scrollBottomPadding =
    (footerHeight || FOOTER_FIXED_HEIGHT + footerBottomPad) + 24;

  const handleDateChange = (date: DateFilter) => {
    if (date === 'pick-date') {
      // Show date picker
      setShowDatePicker(true);
    }
    setDraftFilters({ 
      ...draftFilters, 
      date, 
      pickedDate: date === 'pick-date' ? draftFilters.pickedDate : undefined 
    });
  };

  const handleDatePicked = (event: any, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === 'ios'); // Keep open on iOS, close on Android
    
    if (event.type === 'set' && selectedDate) {
      // Format date as ISO string
      const isoDate = selectedDate.toISOString().split('T')[0];
      setDraftFilters({ 
        ...draftFilters, 
        date: 'pick-date',
        pickedDate: isoDate
      });
    }
    
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
  };

  const handleCityChange = (city: string) => {
    setDraftFilters({ 
      ...draftFilters, 
      city: draftFilters.city === city ? '' : city, 
      commune: undefined 
    });
  };

  const handleCategoryToggle = (category: string) => {
    const categories = draftFilters.categories.includes(category)
      ? draftFilters.categories.filter(c => c !== category)
      : [...draftFilters.categories, category];
    setDraftFilters({ ...draftFilters, categories });
  };

  const handlePriceChange = (price: PriceFilter) => {
    setDraftFilters({ 
      ...draftFilters, 
      price,
      customPriceRange: price === 'custom' ? draftFilters.customPriceRange || { min: 0, max: 2000 } : undefined
    });
  };

  // Single dual-thumb range handler. Dragging either thumb switches the price
  // filter to the custom standard. At the ceiling the max is open-ended
  // (Infinity) so pricey tickets aren't excluded ("min+" readout).
  const handleRange = (lo: number, hi: number) => {
    const nextMax = hi >= priceCeiling ? Number.POSITIVE_INFINITY : hi;
    setDraftFilters({
      ...draftFilters,
      price: 'custom',
      customPriceRange: { min: lo, max: nextMax },
    });
  };

  const handleEventTypeChange = (eventType: EventTypeFilter) => {
    setDraftFilters({ ...draftFilters, eventType });
  };

  return (
    <Modal
      visible={isModalOpen}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={closeFiltersModal}
    >
      {/* Plain View, not SafeAreaView: in a pageSheet the top edge is already
          clear of the status bar, and the bottom inset is absorbed by the
          footer itself so nothing is left over beneath it. */}
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>{t('filters.title')}</Text>
            {activeCount > 0 && (
              <View style={styles.activeBadge}>
                <Text style={styles.activeBadgeText}>{activeCount}</Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={closeFiltersModal}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Scrollable Content */}
        <ScrollView
          style={styles.content}
          contentContainerStyle={{ paddingBottom: scrollBottomPadding }}
          showsVerticalScrollIndicator={false}
        >
          {/* Date Filter */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('filters.date').toUpperCase()}</Text>
            <View style={styles.chipsRow}>
              {DATE_OPTIONS.map(option => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.chip,
                    draftFilters.date === option.value && styles.chipActive
                  ]}
                  onPress={() => handleDateChange(option.value)}
                  hitSlop={CHIP_HIT_SLOP}
                >
                  <Text
                    style={[
                      styles.chipText,
                      draftFilters.date === option.value && styles.chipTextActive
                    ]}
                  >
                    {t(option.labelKey)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            
            {/* Date Picker */}
            {draftFilters.date === 'pick-date' && (
              <>
                {showDatePicker && (
                  <DateTimePicker
                    value={draftFilters.pickedDate ? new Date(draftFilters.pickedDate) : new Date()}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={handleDatePicked}
                    minimumDate={new Date()}
                  />
                )}
                {draftFilters.pickedDate && !showDatePicker && (
                  <TouchableOpacity 
                    style={styles.selectedDateContainer}
                    onPress={() => setShowDatePicker(true)}
                  >
                    <Text style={styles.selectedDateText}>
                      {t('filters.selected')}: {new Date(draftFilters.pickedDate).toLocaleDateString(locale)}
                    </Text>
                    <Text style={styles.selectedDateHint}>{t('filters.tapToChange')}</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>

          {/* Event Type Filter */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('filters.eventType').toUpperCase()}</Text>
            <View style={styles.segmentedControl}>
              {EVENT_TYPE_OPTIONS.map((option, index) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.segment,
                    index === 0 && styles.segmentFirst,
                    index === EVENT_TYPE_OPTIONS.length - 1 && styles.segmentLast,
                    draftFilters.eventType === option.value && styles.segmentActive
                  ]}
                  onPress={() => handleEventTypeChange(option.value)}
                  hitSlop={SEGMENT_HIT_SLOP}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      draftFilters.eventType === option.value && styles.segmentTextActive
                    ]}
                  >
                    {t(option.labelKey)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Price Filter — the custom min–max range is the standard control.
              "Any" and "Free" remain as quick shortcuts. */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('filters.price').toUpperCase()}</Text>

            <View style={styles.chipsRow}>
              {(['any', 'free'] as const).map(value => (
                <TouchableOpacity
                  key={value}
                  style={[styles.chip, draftFilters.price === value && styles.chipActive]}
                  onPress={() => handlePriceChange(value)}
                  hitSlop={CHIP_HIT_SLOP}
                >
                  <Text
                    style={[styles.chipText, draftFilters.price === value && styles.chipTextActive]}
                  >
                    {t(`filters.priceOptions.${value}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* No card, no box: the budget control sits straight on the canvas
                and reads as grouped purely through spacing (18pt off the chips,
                8pt to its own slider) — same rhythm as every other section. */}
            <View style={styles.priceRangeBlock}>
              {/* Caption and readout share one explicit lineHeight so both text
                  boxes match and the glyphs sit on a common baseline. No
                  separate currency suffix: rangeReadout's values already carry
                  the code ("0 HTG – 8,600 HTG"), so the extra label printed
                  HTG twice. */}
              <View style={styles.priceRangeTop}>
                <Text style={styles.priceRangeCaption} numberOfLines={1}>
                  {t('filters.priceRange')}
                </Text>
                <Text style={styles.priceRangeValue} numberOfLines={1}>
                  {rangeReadout}
                </Text>
              </View>

              <RangeSlider
                min={0}
                max={priceCeiling}
                step={priceStep}
                low={rangeMin}
                high={sliderMax}
                onChange={handleRange}
                colors={colors}
              />
            </View>
          </View>

          {/* Categories Filter */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('filters.categories').toUpperCase()}</Text>
            <View style={styles.chipsRow}>
              {CATEGORIES.map(category => (
                <TouchableOpacity
                  key={category}
                  style={[
                    styles.chip,
                    draftFilters.categories.includes(category) && styles.chipActive
                  ]}
                  onPress={() => handleCategoryToggle(category)}
                  hitSlop={CHIP_HIT_SLOP}
                >
                  <Text
                    style={[
                      styles.chipText,
                      draftFilters.categories.includes(category) && styles.chipTextActive
                    ]}
                  >
                    {getCategoryLabel(t, category)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Location Filter */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('filters.country').toUpperCase()}</Text>
            <View style={styles.chipsRow}>
              {COUNTRIES.map(country => (
                <TouchableOpacity
                  key={country.code}
                  style={[
                    styles.chip,
                    (draftFilters.country || 'HT') === country.code && styles.chipActive
                  ]}
                  onPress={() => setDraftFilters({ ...draftFilters, country: country.code, city: '' })}
                  hitSlop={CHIP_HIT_SLOP}
                >
                  <Text
                    style={[
                      styles.chipText,
                      (draftFilters.country || 'HT') === country.code && styles.chipTextActive
                    ]}
                  >
                    {country.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.sectionLabel, { marginTop: 12 }]}>{t('filters.city').toUpperCase()}</Text>
            <View style={styles.chipsRow}>
              {(CITIES_BY_COUNTRY[draftFilters.country || 'HT'] || []).map(city => (
                <TouchableOpacity
                  key={city}
                  style={[
                    styles.chip,
                    draftFilters.city === city && styles.chipActive
                  ]}
                  onPress={() => handleCityChange(city)}
                  hitSlop={CHIP_HIT_SLOP}
                >
                  <Text
                    style={[
                      styles.chipText,
                      draftFilters.city === city && styles.chipTextActive
                    ]}
                  >
                    {city}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>

        {/* Footer with Actions */}
        <View
          style={[styles.footer, { paddingBottom: footerBottomPad }]}
          onLayout={(e: LayoutChangeEvent) => setFooterHeight(e.nativeEvent.layout.height)}
        >
          <TouchableOpacity
            style={styles.resetButton}
            onPress={resetFilters}
          >
            <Text style={styles.resetButtonText}>{t('filters.reset')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.applyButton}
            onPress={applyFilters}
          >
            <Text style={styles.applyButtonText}>
              {t('filters.apply')} {activeCount > 0 ? `(${activeCount})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontFamily: 'InstrumentSerif_400Regular',
    fontSize: 30,
    color: colors.text,
    letterSpacing: 0.2,
  },
  activeBadge: {
    backgroundColor: colors.primary,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  activeBadgeText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  closeButton: {
    padding: 8,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceMuted,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  section: {
    paddingVertical: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textTertiary,
    marginBottom: 12,
    letterSpacing: 1,
  },
  // Justified wrap: chips keep their natural (label-sized) width for the purpose
  // of line-breaking, then flexGrow shares each line's leftover space between
  // that line's chips. Result — every row is flush left AND right, so the grid
  // reads as a uniform block instead of a ragged stack, with no truncation.
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 8,
    rowGap: 10,
  },
  // 30pt visible height: 7 + 16 (chipText lineHeight) + 7. Touch target is
  // restored to 44pt with CHIP_HIT_SLOP.
  chip: {
    flexGrow: 1,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  // Selected = a solid TEAL fill, matching every other selection chip in the
  // app (Discover's FilterPill — the collapsed form of these very filters — is
  // already teal). White is reserved here for the one PRIMARY ACTION, the Apply
  // button in the footer; using it for selection too made "Any date" look like
  // a second button rather than a chosen value.
  chipActive: {
    backgroundColor: colors.primary,
  },
  // lineHeight is explicit so every chip is exactly the same height whatever the
  // label or the device's font metrics.
  chipText: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.onPrimary,
    fontWeight: '700',
  },
  // Shrunk in step with the chips so DATE / EVENT TYPE / CATEGORIES read as one
  // family: 34pt tall overall (3 + 28 + 3) against the chips' 30pt.
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  segmentFirst: {
    borderTopLeftRadius: radius.sm,
    borderBottomLeftRadius: radius.sm,
  },
  segmentLast: {
    borderTopRightRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
  },
  segmentActive: {
    backgroundColor: colors.surfaceRaised,
  },
  segmentText: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  segmentTextActive: {
    color: colors.text,
    fontWeight: '700',
  },
  // The footer sits on the black canvas: a raised (surfaceRaised) fill read as
  // a grey slab floating above the sheet's bottom edge. Separation is carried
  // by the 1pt top rule alone; `paddingBottom` is applied at the call site so
  // the black runs through the home-indicator inset with no gap beneath it.
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 16,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  resetButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Full-strength label (19.8:1 on the black footer) but no fill — Apply keeps
  // the white pill, so hierarchy is carried by the fill, not by dimming Reset.
  resetButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  applyButton: {
    flex: 2,
    paddingVertical: 16,
    borderRadius: radius.button,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.background,
  },
  selectedDateContainer: {
    marginTop: 12,
    padding: 16,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  selectedDateText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  selectedDateHint: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  // Compact budget control, now UNBOXED: no background, no radius, no inner
  // padding, so the slider spans the full content width and its ends line up
  // with the section margins. Grouping comes from the 18pt gap above it.
  priceRangeBlock: {
    marginTop: 18,
  },
  // flex-end + a shared lineHeight on all three labels puts the caption, the
  // value and the currency on one baseline.
  priceRangeTop: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  priceRangeCaption: {
    fontSize: 11,
    lineHeight: 18,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.textTertiary,
  },
  priceRangeValue: {
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.text,
  },
});
