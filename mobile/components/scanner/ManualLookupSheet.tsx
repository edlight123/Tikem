import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, X, ScanSearch, CloudOff } from 'lucide-react-native';
import { colors, font, radius, spacing } from '../../theme/tokens';
import { useI18n } from '../../contexts/I18nContext';
import SectionHeader from '../SectionHeader';
import StatusChip from '../StatusChip';

export interface DoorGuest {
  ticketId: string;
  name: string;
  /** Held in memory only — never written to the on-device manifest. */
  email: string;
  tier: string;
  checkedIn: boolean;
  /** False for refunded / cancelled / pending tickets. */
  live: boolean;
}

interface ManualLookupSheetProps {
  visible: boolean;
  onClose: () => void;
  guests: DoorGuest[];
  /** True when the guest list could not be loaded (offline with no cache, or
      no attendee-list permission). Code entry still works. */
  listUnavailable?: boolean;
  /** Door-only staff: the list is the server's door list (name, tier, code; no email). */
  doorOnly?: boolean;
  /** Runs the SAME validation + check-in path as a camera scan. */
  onSelect: (ticketId: string) => void;
}

const CODE_PATTERN = /^[a-zA-Z0-9_-]{6,}$/;

/**
 * Manual lookup — mirrors the web's components/scan/ManualLookupSheet: search
 * the event's guest list by name, email or ticket code and hand the chosen
 * ticket to the scanner, which validates and checks it in exactly as if its QR
 * had been read (recorded as check_in_method 'manual').
 */
export default function ManualLookupSheet({
  visible,
  onClose,
  guests,
  listUnavailable,
  doorOnly,
  onSelect,
}: ManualLookupSheetProps) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();

  const results = useMemo(() => {
    const list = needle
      ? guests.filter(
          (g) =>
            g.name.toLowerCase().includes(needle) ||
            g.email.toLowerCase().includes(needle) ||
            g.ticketId.toLowerCase().includes(needle),
        )
      : guests;
    // Still-to-arrive guests first — that is who the door is looking for.
    return [...list].sort((a, b) => {
      if (a.checkedIn !== b.checkedIn) return a.checkedIn ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [guests, needle]);

  // A typed code that is not an exact id on the list can still be checked:
  // the scanner reads the ticket itself, so a guest missing from a stale list
  // is not turned away.
  const offerCode =
    CODE_PATTERN.test(trimmed) && !guests.some((g) => g.ticketId === trimmed);

  const pick = (ticketId: string) => {
    onClose();
    onSelect(ticketId);
  };

  const subtitle = listUnavailable
    ? t('doorScanner.lookup.listUnavailable')
    : doorOnly
      ? t('doorScanner.door.lookupSubtitle').replace('{count}', String(guests.length))
      : t('doorScanner.lookup.guestCount').replace('{count}', String(guests.length));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.sm }]}>
          <View style={styles.grabber} />

          <View style={styles.headerRow}>
            <View style={styles.headerTitle}>
              <SectionHeader
                title={t('doorScanner.lookup.title')}
                subtitle={subtitle}
                subtitleLines={2}
              />
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <X size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchField}>
            <Search size={18} color={colors.textSecondary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t(doorOnly ? 'doorScanner.door.placeholder' : 'doorScanner.lookup.placeholder')}
              placeholderTextColor={colors.textTertiary}
              style={styles.searchInput}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              selectionColor={colors.accent}
              onSubmitEditing={() => {
                if (results.length === 1) pick(results[0].ticketId);
                else if (offerCode) pick(trimmed);
              }}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={10}>
                <X size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            data={results}
            keyExtractor={(g) => g.ticketId}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              offerCode ? (
                <TouchableOpacity
                  style={[styles.row, styles.codeRow]}
                  onPress={() => pick(trimmed)}
                  accessibilityRole="button"
                >
                  <ScanSearch size={20} color={colors.textPrimary} />
                  <View style={styles.rowText}>
                    <Text style={styles.rowName}>{t('doorScanner.lookup.checkCode')}</Text>
                    <Text style={styles.code} numberOfLines={1}>
                      {trimmed}
                    </Text>
                  </View>
                </TouchableOpacity>
              ) : null
            }
            ListEmptyComponent={
              offerCode ? null : (
                <View style={styles.empty}>
                  {listUnavailable ? (
                    <CloudOff size={28} color={colors.textTertiary} />
                  ) : (
                    <Search size={28} color={colors.textTertiary} />
                  )}
                  <Text style={styles.emptyText}>
                    {listUnavailable
                      ? t('doorScanner.lookup.listUnavailableHint')
                      : t('doorScanner.lookup.noResults')}
                  </Text>
                </View>
              )
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.row}
                onPress={() => pick(item.ticketId)}
                accessibilityRole="button"
                accessibilityLabel={item.name}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.name || t('common.attendee')}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {[item.tier, item.email].filter(Boolean).join(' · ')}
                  </Text>
                  <Text style={styles.code} numberOfLines={1}>
                    {item.ticketId.slice(0, 10).toUpperCase()}
                  </Text>
                </View>
                {!item.live ? (
                  <StatusChip status="error" label={t('doorScanner.lookup.notValid')} />
                ) : item.checkedIn ? (
                  <StatusChip status="pending" label={t('doorScanner.lookup.checkedIn')} />
                ) : null}
              </TouchableOpacity>
            )}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    height: '85%',
    paddingTop: spacing.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  headerTitle: {
    flex: 1,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A filled field, not a hairline box (POSH "fill, not a hairline").
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: 14,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    // 16pt floor so iOS doesn't zoom on focus.
    fontSize: 16,
    paddingVertical: 0,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  codeRow: {
    marginBottom: spacing.sm,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  rowMeta: {
    marginTop: 3,
    fontSize: 13,
    color: colors.textSecondary,
  },
  code: {
    marginTop: 4,
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: 0.6,
    color: colors.textTertiary,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    color: colors.textSecondary,
  },
});
