/**
 * AddOnsEditor — the create/edit flow's "Add-ons" section: extras sold with
 * tickets (a meal, a T-shirt in sizes, parking, a book, raffle entries).
 *
 * Compact cards; tapping one opens a FormSheet that edits a COPY, so closing
 * discards and Done saves. The parent owns the list and saves it on the event
 * as `add_ons` (+ `add_ons_enabled`), normalized by lib/addOns. The stored
 * shape is unchanged: sales_start / sales_end are ISO instants (null = open),
 * tier_ids are ticket_tiers doc ids. A ticket not saved yet is referenced by
 * its local key and swapped for its doc id on save (lib/addOnDraft).
 * A photo uploads the moment it is picked, so the saved add-on carries an
 * https URL.
 */
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Check, ChevronRight, ImagePlus, Plus, ShoppingBag, X } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { useAuth } from '../../contexts/AuthContext';
import { formatCurrency } from '../../lib/currency';
import { uploadLineupPhoto } from '../../lib/api/events';
import { MAX_ADD_ON_OPTIONS, newAddOnId, normalizeAddOns, type EventAddOn } from '../../lib/addOns';
import { addOnProblem } from '../../lib/addOnDraft';
import FormSheet, { SheetInput, SheetLabel } from './FormSheet';
import DateTimeField from './DateTimeField';
import { fromWallClockCarrier, isValidZone, toWallClockCarrier } from '../../lib/zonedTime';
import WhitePillCTA from '../WhitePillCTA';
import { radius } from '../../theme/tokens';

const K = 'addOns.editor';
const S = 'addOnSheet';
const OPTION_MAX = 30;

interface Draft {
  id: string;
  name: string;
  price: string;
  description: string;
  image_url: string;
  quantity: string;
  options: string[];
  max_per_order: string;
  /** ISO instants, '' = open. */
  sales_start: string;
  sales_end: string;
  tier_ids: string[];
  is_active: boolean;
}

function toDraft(a: EventAddOn): Draft {
  return {
    id: a.id,
    name: a.name,
    price: String(a.price ?? ''),
    description: a.description || '',
    image_url: a.image_url || '',
    quantity: a.quantity ? String(a.quantity) : '',
    options: [...(a.options || [])],
    max_per_order: a.max_per_order ? String(a.max_per_order) : '',
    sales_start: a.sales_start || '',
    sales_end: a.sales_end || '',
    tier_ids: a.tier_ids || [],
    is_active: a.is_active !== false,
  };
}

function fromDraft(d: Draft): EventAddOn | null {
  const [clean] = normalizeAddOns([
    {
      id: d.id,
      name: d.name,
      price: Number(d.price.replace(',', '.')),
      description: d.description,
      image_url: d.image_url,
      quantity: d.quantity.trim() ? Number(d.quantity) : null,
      options: d.options,
      max_per_order: d.max_per_order.trim() ? Number(d.max_per_order) : null,
      sales_start: d.sales_start || null,
      sales_end: d.sales_end || null,
      tier_ids: d.tier_ids,
      is_active: d.is_active,
    },
  ]);
  // normalizeAddOns keeps tier ids as given (local keys included); the save
  // path swaps those for doc ids (lib/api/events).
  return clean ? { ...clean, id: d.id, tier_ids: d.tier_ids } : null;
}

export interface AddOnsEditorTier {
  /** The saved tier doc id. */
  id?: string;
  /** The local key of a tier not saved yet. */
  key?: string;
  name: string;
}

interface Props {
  value: EventAddOn[];
  onChange: (next: EventAddOn[]) => void;
  tiers: AddOnsEditorTier[];
  currency: string;
  /** The event's zone: the sales window is shown and picked as the venue's wall clock. */
  zone?: string;
}

// The pickers edit a wall-clock "carrier" Date (lib/zonedTime): its local
// fields are the venue's clock; the stored value is the instant in the zone.
const isoOrNull = (d: Date | null, zone?: string) =>
  d ? (zone && isValidZone(zone) ? fromWallClockCarrier(d, zone) : d).toISOString() : '';
const dateOrNull = (iso: string, zone?: string) => {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  return zone && isValidZone(zone) ? toWallClockCarrier(new Date(t), zone) : new Date(t);
};

export default function AddOnsEditor({ value, onChange, tiers, currency, zone }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { user } = useAuth();
  const styles = getStyles(colors);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [showProblem, setShowProblem] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const [optionText, setOptionText] = useState('');

  const refTiers = tiers
    .map((tr) => ({ ref: tr.id || tr.key || '', refs: [tr.id, tr.key].filter(Boolean) as string[], name: tr.name }))
    .filter((tr) => tr.ref);
  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const openNew = () => {
    setIsNew(true);
    setShowProblem(false);
    setOptionText('');
    setDraft({
      id: newAddOnId(),
      name: '',
      price: '',
      description: '',
      image_url: '',
      quantity: '',
      options: [],
      max_per_order: '',
      sales_start: '',
      sales_end: '',
      tier_ids: [],
      is_active: true,
    });
  };

  const openEdit = (a: EventAddOn) => {
    setIsNew(false);
    setShowProblem(false);
    setOptionText('');
    setDraft(toDraft(a));
  };

  const save = () => {
    if (!draft) return;
    if (addOnProblem(draft)) {
      setShowProblem(true);
      return;
    }
    const clean = fromDraft(draft);
    if (!clean) return;
    onChange(isNew ? [...value, clean] : value.map((a) => (a.id === clean.id ? clean : a)));
    setDraft(null);
  };

  const remove = () => {
    if (!draft) return;
    onChange(value.filter((a) => a.id !== draft.id));
    setDraft(null);
  };

  const addOption = () => {
    if (!draft) return;
    const next = optionText.replace(/,/g, ' ').trim().slice(0, OPTION_MAX);
    if (!next || draft.options.length >= MAX_ADD_ON_OPTIONS) return;
    if (!draft.options.some((o) => o.toLowerCase() === next.toLowerCase())) patch({ options: [...draft.options, next] });
    setOptionText('');
  };

  const pickPhoto = async () => {
    if (uploading || !draft) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]?.uri || !user?.uid) return;
    setUploadError(false);
    setUploading(true);
    try {
      const url = await uploadLineupPhoto(user.uid, result.assets[0].uri);
      patch({ image_url: url });
    } catch {
      setUploadError(true);
    } finally {
      setUploading(false);
    }
  };

  const problem = draft && showProblem ? addOnProblem(draft) : null;
  const problemText =
    problem === 'name'
      ? t(`${K}.needsName`)
      : problem === 'price'
        ? t(`${K}.needsPrice`)
        : problem === 'window'
          ? t(`${K}.badWindow`)
          : null;
  const salesStart = draft ? dateOrNull(draft.sales_start, zone) : null;
  const salesEnd = draft ? dateOrNull(draft.sales_end, zone) : null;

  return (
    <View>
      <View style={styles.headerRow}>
        <ShoppingBag size={16} color={colors.textSecondary} />
        <Text style={styles.title}>{t(`${K}.title`)}</Text>
      </View>
      <Text style={styles.info}>{t(`${K}.info`)}</Text>

      {value.map((a) => {
        const meta = [
          formatCurrency(a.price, currency),
          a.quantity ? t(`${K}.stockCount`, { count: a.quantity }) : t(`${K}.unlimited`),
          a.options && a.options.length ? a.options.join(' · ') : null,
          a.is_active === false ? t(`${K}.hiddenBadge`) : null,
        ]
          .filter(Boolean)
          .join('  ·  ');
        return (
          <TouchableOpacity
            key={a.id}
            style={styles.card}
            onPress={() => openEdit(a)}
            accessibilityRole="button"
            accessibilityLabel={a.name}
          >
            {a.image_url ? (
              <Image source={{ uri: a.image_url }} style={styles.thumb} contentFit="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbEmpty]}>
                <ShoppingBag size={16} color={colors.textTertiary} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.cardName} numberOfLines={1}>
                {a.name}
              </Text>
              <Text style={styles.cardMeta} numberOfLines={1}>
                {meta}
              </Text>
            </View>
            <ChevronRight size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        );
      })}

      <TouchableOpacity style={styles.addRow} onPress={openNew} accessibilityRole="button">
        <Plus size={18} color={colors.text} />
        <Text style={styles.addText}>{t(`${K}.add`)}</Text>
      </TouchableOpacity>

      <FormSheet
        visible={draft !== null}
        title={isNew ? t(`${K}.newTitle`) : t(`${K}.editTitle`)}
        onClose={() => setDraft(null)}
        closeLabel={t('a11y.close')}
        busy={uploading}
        footer={
          <View style={{ gap: 12 }}>
            {problemText ? <Text style={styles.problem}>{problemText}</Text> : null}
            <WhitePillCTA label={t(`${K}.done`)} onPress={save} />
            {!isNew && (
              <TouchableOpacity onPress={remove} style={styles.removeLink} accessibilityRole="button">
                <Text style={styles.removeText}>{t(`${K}.remove`)}</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      >
        {draft && (
          <View style={{ gap: 4 }}>
            {/* Photo, then name and price, each with its own label. */}
            <TouchableOpacity style={styles.photoWell} onPress={pickPhoto} accessibilityRole="button" accessibilityLabel={t(`${K}.photo`)}>
              {uploading ? (
                <ActivityIndicator color={colors.text} />
              ) : draft.image_url ? (
                <Image source={{ uri: draft.image_url }} style={styles.photo} contentFit="cover" />
              ) : (
                <>
                  <ImagePlus size={20} color={colors.textSecondary} />
                  <Text style={styles.photoText}>{t(`${S}.addPhoto`)}</Text>
                </>
              )}
            </TouchableOpacity>
            {uploadError && <Text style={styles.problem}>{t(`${K}.photoFailed`)}</Text>}

            <SheetLabel>{t(`${K}.name`)}</SheetLabel>
            <SheetInput
              value={draft.name}
              onChangeText={(name) => patch({ name })}
              placeholder={t(`${K}.namePlaceholder`)}
              maxLength={60}
            />

            <SheetLabel>{t(`${K}.price`, { currency })}</SheetLabel>
            <SheetInput
              value={draft.price}
              onChangeText={(price) => patch({ price: price.replace(/[^0-9.,]/g, '') })}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />

            <SheetLabel>{t(`${K}.description`)}</SheetLabel>
            <SheetInput
              value={draft.description}
              onChangeText={(description) => patch({ description })}
              placeholder={t(`${S}.descriptionPlaceholder`)}
              multiline
              maxLength={240}
              style={{ minHeight: 64, textAlignVertical: 'top' }}
            />

            {/* Options as chips with an add field. */}
            <SheetLabel>{t(`${K}.options`)}</SheetLabel>
            {draft.options.length > 0 && (
              <View style={styles.chips}>
                {draft.options.map((o) => (
                  <View key={o} style={styles.optionChip}>
                    <Text style={styles.optionChipText}>{o}</Text>
                    <TouchableOpacity
                      onPress={() => patch({ options: draft.options.filter((x) => x !== o) })}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={t(`${S}.removeOption`, { name: o })}
                    >
                      <X size={14} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            {draft.options.length < MAX_ADD_ON_OPTIONS && (
              <View style={styles.optionRow}>
                <View style={{ flex: 1 }}>
                  <SheetInput
                    value={optionText}
                    onChangeText={setOptionText}
                    placeholder={t(`${S}.optionPlaceholder`)}
                    maxLength={OPTION_MAX}
                    returnKeyType="done"
                    onSubmitEditing={addOption}
                    blurOnSubmit={false}
                  />
                </View>
                <TouchableOpacity
                  style={[styles.optionAdd, !optionText.trim() && { opacity: 0.4 }]}
                  onPress={addOption}
                  disabled={!optionText.trim()}
                  accessibilityRole="button"
                >
                  <Plus size={16} color={colors.text} />
                  <Text style={styles.optionAddText}>{t(`${S}.optionAdd`)}</Text>
                </TouchableOpacity>
              </View>
            )}
            <Text style={styles.hint}>{t(`${S}.optionsHint`)}</Text>

            <View style={styles.twoCol}>
              <View style={{ flex: 1 }}>
                <SheetLabel>{t(`${K}.quantity`)}</SheetLabel>
                <SheetInput value={draft.quantity} onChangeText={(quantity) => patch({ quantity: quantity.replace(/[^0-9]/g, '') })} keyboardType="number-pad" placeholder={t(`${K}.unlimited`)} />
              </View>
              <View style={{ flex: 1 }}>
                <SheetLabel>{t(`${K}.maxPerOrder`)}</SheetLabel>
                <SheetInput value={draft.max_per_order} onChangeText={(m) => patch({ max_per_order: m.replace(/[^0-9]/g, '') })} keyboardType="number-pad" placeholder="10" />
              </View>
            </View>

            {/* Sales window: the same picker as the event's own dates. */}
            <SheetLabel>{t(`${K}.salesStart`)}</SheetLabel>
            <DateTimeField
              variant="filled"
              label={t(`${S}.from`)}
              title={t(`${K}.salesStart`)}
              value={salesStart}
              onChange={(d) => patch({ sales_start: isoOrNull(d, zone) })}
              clearable
              placeholder={t(`${S}.now`)}
              helper={t(`${S}.salesStartHint`)}
            />
            <SheetLabel>{t(`${K}.salesEnd`)}</SheetLabel>
            <DateTimeField
              variant="filled"
              label={t(`${S}.until`)}
              title={t(`${K}.salesEnd`)}
              value={salesEnd}
              onChange={(d) => patch({ sales_end: isoOrNull(d, zone) })}
              minimumDate={salesStart || undefined}
              clearable
              placeholder={t(`${S}.eventStarts`)}
              helper={t(`${S}.salesEndHint`)}
              error={showProblem && problem === 'window' ? t(`${K}.badWindow`) : undefined}
            />

            {/* Ticket restriction: one checkbox per ticket, saved or not. */}
            <SheetLabel>{t(`${K}.onlyWith`)}</SheetLabel>
            {refTiers.length === 0 ? (
              <Text style={styles.hint}>{t(`${S}.noTickets`)}</Text>
            ) : (
              <View style={styles.checkList}>
                {refTiers.map((tr) => {
                  const on = draft.tier_ids.some((x) => tr.refs.includes(x));
                  return (
                    <TouchableOpacity
                      key={tr.ref}
                      style={styles.checkRow}
                      onPress={() =>
                        patch({
                          tier_ids: on ? draft.tier_ids.filter((x) => !tr.refs.includes(x)) : [...draft.tier_ids, tr.ref],
                        })
                      }
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                    >
                      <View style={[styles.checkbox, on && styles.checkboxOn]}>
                        {on ? <Check size={14} color="#FFFFFF" strokeWidth={3} /> : null}
                      </View>
                      <Text style={styles.checkText} numberOfLines={1}>
                        {tr.name.trim() || t(`${K}.ticket`)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                <Text style={styles.hint}>{t(`${K}.anyTicket`)}</Text>
              </View>
            )}

            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>{t(`${K}.onSale`)}</Text>
                <Text style={styles.hint}>{t(`${S}.onSaleHint`)}</Text>
              </View>
              <Switch
                value={draft.is_active}
                onValueChange={(is_active) => patch({ is_active })}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>
          </View>
        )}
      </FormSheet>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    title: { fontSize: 15, fontWeight: '700', color: colors.text },
    info: { fontSize: 13, color: colors.textSecondary, marginBottom: 10 },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      marginBottom: 8,
    },
    thumb: { width: 36, height: 36, borderRadius: radius.sm },
    thumbEmpty: { backgroundColor: colors.surfaceRaised ?? colors.surface, alignItems: 'center', justifyContent: 'center' },
    cardName: { fontSize: 15, fontWeight: '600', color: colors.text },
    cardMeta: { marginTop: 2, fontSize: 12, color: colors.textSecondary },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
    addText: { fontSize: 15, fontWeight: '600', color: colors.text },
    photoWell: {
      flexDirection: 'row',
      gap: 8,
      height: 72,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised ?? colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      marginBottom: 8,
    },
    photo: { width: '100%', height: 72 },
    photoText: { fontSize: 15, color: colors.textSecondary, fontWeight: '600' },
    hint: { fontSize: 12, color: colors.textTertiary, marginTop: 2, marginBottom: 6 },
    twoCol: { flexDirection: 'row', gap: 10 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
    optionChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingLeft: 12,
      paddingRight: 8,
      paddingVertical: 6,
      borderRadius: radius.chip,
      backgroundColor: colors.surfaceRaised ?? colors.background,
    },
    optionChipText: { fontSize: 13, fontWeight: '600', color: colors.text },
    optionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    optionAdd: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      height: 48,
      paddingHorizontal: 14,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised ?? colors.background,
    },
    optionAddText: { fontSize: 15, fontWeight: '600', color: colors.text },
    checkList: { gap: 2 },
    checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: radius.sm,
      borderWidth: 1.5,
      borderColor: colors.textTertiary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    checkText: { flex: 1, fontSize: 15, color: colors.text },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
    switchLabel: { fontSize: 15, color: colors.text, fontWeight: '600' },
    problem: { fontSize: 13, color: colors.error },
    removeLink: { alignItems: 'center', paddingVertical: 4 },
    removeText: { fontSize: 15, color: colors.error, fontWeight: '600' },
  });
