/**
 * LineupEntrySheet — the bottom sheet where ONE lineup act is filled in.
 *
 * Mobile twin of the web's components/organizer/GuestEditorSheet.tsx, same
 * layout organizers know from posh: a circular photo well with the name and
 * link stacked beside it, then the role, a line about them, and the set
 * window, with Cancel / Save pinned at the foot.
 *
 * It edits a COPY held by the parent, so Cancel genuinely discards. The photo
 * uploads the moment it is picked (like the web), so the saved entry always
 * carries a real https URL rather than a device-local file path.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { useAuth } from '../../contexts/AuthContext';
import WhitePillCTA from '../WhitePillCTA';
import { uploadLineupPhoto } from '../../lib/api/events';
import { GUEST_ROLES, ROLE_LABEL_KEY, type LineupEntry } from '../../lib/lineup';
import { colors as T, font, radius } from '../../theme/tokens';

const K = 'organizerCreateEventFlow.canvas.lineup';

type Which = 'start' | 'end';

interface Props {
  /** The entry being edited; null = sheet closed. */
  draft: LineupEntry | null;
  isNew: boolean;
  onPatch: (patch: Partial<LineupEntry>) => void;
  onSave: () => void;
  onCancel: () => void;
}

/** 'HH:mm' → a Date today at that wall-clock time (or 8 PM when unset). */
function timeToDate(hhmm: string): Date {
  const d = new Date();
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (m) d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  else d.setHours(20, 0, 0, 0);
  return d;
}

function dateToTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function LineupEntrySheet({ draft, isNew, onPatch, onSave, onCancel }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const styles = getStyles(colors);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Which set-time row has its picker open (iOS inline spinner / Android dialog).
  const [timeOpen, setTimeOpen] = useState<Which | null>(null);

  const visible = !!draft;
  useEffect(() => {
    if (visible) {
      setUploadError(null);
      setTimeOpen(null);
    }
  }, [visible]);

  const pickPhoto = async () => {
    if (uploading) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      // A portrait sits in a circle, so the OS square crop is exactly right here.
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    if (!user?.uid) {
      setUploadError(t(`${K}.photoFailed`));
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      const url = await uploadLineupPhoto(user.uid, result.assets[0].uri);
      onPatch({ photoUrl: url });
    } catch {
      setUploadError(t(`${K}.photoFailed`));
    } finally {
      setUploading(false);
    }
  };

  const onTimeChange = (which: Which) => (event: any, selected?: Date) => {
    if (Platform.OS === 'android') setTimeOpen(null);
    if (event?.type === 'dismissed' || !selected) return;
    onPatch(which === 'start' ? { startTime: dateToTime(selected) } : { endTime: dateToTime(selected) });
  };

  const canSave = !!draft?.name.trim() && !uploading;

  const timeRow = (which: Which, label: string, value: string, first: boolean) => {
    const open = timeOpen === which;
    return (
      <View key={which}>
        <View style={[styles.timeRow, !first && styles.timeRowDivider]}>
          <Text style={styles.timeLabel}>{label}</Text>
          <View style={styles.timeRight}>
            {!!value && (
              <TouchableOpacity
                onPress={() => {
                  onPatch(which === 'start' ? { startTime: '' } : { endTime: '' });
                  if (open) setTimeOpen(null);
                }}
                hitSlop={8}
              >
                <Text style={styles.timeClear}>{t(`${K}.clear`)}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.timeValue}
              onPress={() => {
                // Opening a picker on an empty row seeds it, so "Done" is never a no-op.
                if (!value) onPatch(which === 'start' ? { startTime: '20:00' } : { endTime: '21:00' });
                setTimeOpen(open ? null : which);
              }}
              activeOpacity={0.75}
            >
              <Ionicons name="time-outline" size={15} color={open ? colors.primary : value ? colors.text : colors.textSecondary} />
              <Text style={[styles.timeValueText, !value && styles.timeValuePlaceholder, open && styles.timeValueTextOpen]}>
                {value || '--:--'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        {open && Platform.OS === 'ios' && (
          // Fixed-height container: the iOS spinner renders at 0 height without it.
          <View style={styles.spinnerWrap}>
            <DateTimePicker
              value={timeToDate(value)}
              mode="time"
              display="spinner"
              is24Hour
              onChange={onTimeChange(which)}
              textColor={colors.text}
              style={styles.spinner}
            />
          </View>
        )}
        {open && Platform.OS === 'android' && (
          <DateTimePicker value={timeToDate(value)} mode="time" is24Hour display="default" onChange={onTimeChange(which)} />
        )}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={uploading ? undefined : onCancel} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.avoid}
        pointerEvents="box-none"
      >
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {isNew ? t(`${K}.addTitle`) : t(`${K}.editTitle`)}
            </Text>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
              hitSlop={8}
            >
              <Ionicons name="close" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          {draft && (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Photo well + the two identity fields beside it */}
              <View style={styles.identity}>
                <TouchableOpacity
                  style={styles.photoWell}
                  onPress={pickPhoto}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={draft.photoUrl ? t(`${K}.changePhoto`) : t(`${K}.addPhoto`)}
                >
                  {draft.photoUrl ? (
                    <Image source={{ uri: draft.photoUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <Ionicons name="person-outline" size={28} color={colors.textTertiary} />
                  )}
                  {uploading ? (
                    <View style={styles.photoScrim}>
                      <ActivityIndicator color={colors.white} />
                    </View>
                  ) : (
                    <View style={styles.photoBadge}>
                      <Ionicons name={draft.photoUrl ? 'camera' : 'add'} size={14} color={T.onWhite} />
                    </View>
                  )}
                </TouchableOpacity>

                <View style={styles.identityFields}>
                  <TextInput
                    value={draft.name}
                    onChangeText={(name) => onPatch({ name })}
                    placeholder={t(`${K}.namePlaceholder`)}
                    placeholderTextColor={colors.textTertiary}
                    selectionColor={colors.primary}
                    style={styles.field}
                    autoCorrect={false}
                    autoComplete="off"
                    textContentType="none"
                    maxLength={80}
                    returnKeyType="next"
                  />
                  <View style={styles.linkField}>
                    <Ionicons name="link-outline" size={17} color={colors.textTertiary} />
                    <TextInput
                      value={draft.link}
                      onChangeText={(link) => onPatch({ link })}
                      placeholder={t(`${K}.linkPlaceholder`)}
                      placeholderTextColor={colors.textTertiary}
                      selectionColor={colors.primary}
                      style={styles.linkInput}
                      keyboardType="url"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="off"
                      textContentType="none"
                    />
                  </View>
                </View>
              </View>

              {!!uploadError && <Text style={styles.error}>{uploadError}</Text>}

              <Text style={styles.label}>{t(`${K}.role`)}</Text>
              <View style={styles.roles}>
                {GUEST_ROLES.map((role) => {
                  const on = draft.role === role;
                  return (
                    <TouchableOpacity
                      key={role}
                      style={[styles.roleChip, on && styles.roleChipOn]}
                      onPress={() => onPatch({ role })}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.roleText, on && styles.roleTextOn]}>
                        {t(`${K}.roles.${ROLE_LABEL_KEY[role]}`)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.label}>{t(`${K}.description`)}</Text>
              <TextInput
                value={draft.description}
                onChangeText={(description) => onPatch({ description })}
                placeholder={t(`${K}.descriptionPlaceholder`)}
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
                style={[styles.field, styles.multiline]}
                multiline
                maxLength={500}
                textAlignVertical="top"
              />

              <Text style={styles.label}>{t(`${K}.setTime`)}</Text>
              <View style={styles.timeCard}>
                {timeRow('start', t(`${K}.startTime`), draft.startTime, true)}
                {timeRow('end', t(`${K}.endTime`), draft.endTime, false)}
              </View>
            </ScrollView>
          )}

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.8}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <WhitePillCTA label={t(`${K}.save`)} onPress={onSave} disabled={!canSave} style={styles.saveBtn} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
    avoid: { flex: 1, justifyContent: 'flex-end' },
    sheet: {
      maxHeight: '92%',
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: 20,
      paddingTop: 10,
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
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 12,
    },
    title: {
      flex: 1,
      fontFamily: font.serif,
      fontSize: 28,
      lineHeight: 32,
      color: colors.text,
    },
    closeBtn: {
      width: 34,
      height: 34,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: { flexGrow: 0 },
    scrollContent: { paddingBottom: 8 },

    identity: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
    photoWell: {
      width: 84,
      height: 84,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'visible',
    },
    photoScrim: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: radius.pill,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Small white disc on the well's edge: the affordance, not a label.
    photoBadge: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      width: 26,
      height: 26,
      borderRadius: radius.pill,
      backgroundColor: colors.white,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.surface,
    },
    identityFields: { flex: 1, minWidth: 0, gap: 10 },
    // Filled fields, no outlines (POSH "a fill, not a hairline").
    field: {
      minHeight: 46,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      color: colors.text,
    },
    multiline: { minHeight: 88 },
    linkField: {
      minHeight: 46,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
      paddingHorizontal: 12,
    },
    linkInput: { flex: 1, minWidth: 0, paddingVertical: 12, fontSize: 16, color: colors.text },
    error: { marginTop: 12, fontSize: 13, color: colors.error },

    label: {
      marginTop: 20,
      marginBottom: 8,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: colors.textSecondary,
    },
    roles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    roleChip: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: radius.chip,
      backgroundColor: colors.surfaceRaised,
    },
    // A chosen chip is the one pure white (fill ladder top step).
    roleChipOn: { backgroundColor: colors.white },
    roleText: { fontSize: 14, fontWeight: '500', color: colors.textSecondary },
    roleTextOn: { color: T.onWhite, fontWeight: '700' },

    timeCard: { borderRadius: radius.md, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
    timeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 10,
      minHeight: 52,
    },
    timeRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    timeLabel: { fontSize: 15, color: colors.text },
    timeRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    timeClear: { fontSize: 13, color: colors.textSecondary },
    timeValue: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
    },
    // Teal marks the row whose picker is open (focus indicator, POSH §1).
    timeValueTextOpen: { color: colors.primary },
    timeValueText: { fontSize: 15, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
    timeValuePlaceholder: { color: colors.textSecondary, fontWeight: '400' },
    spinnerWrap: { height: 200, alignItems: 'center', justifyContent: 'center' },
    spinner: { width: '100%' },

    footer: { flexDirection: 'row', gap: 10, paddingTop: 12 },
    // Secondary = dark-grey pill (POSH §2.2), same 56pt as the white primary.
    cancelBtn: {
      height: 56,
      paddingHorizontal: 22,
      borderRadius: radius.button,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelText: { fontSize: 16, fontWeight: '600', color: colors.text },
    saveBtn: { flex: 1 },
  });
