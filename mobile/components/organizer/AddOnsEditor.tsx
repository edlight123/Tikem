/**
 * AddOnsEditor: the create/edit flow's "Add-ons" section. Paid extras sold
 * with tickets: a bottle or table package, a VIP upgrade, parking, drinks, a
 * T-shirt in sizes.
 *
 * Compact rows; tapping one opens a FormSheet that edits a COPY, so closing
 * discards. Quick starts prefill the common Haiti add-ons. The parent owns the
 * list and saves it on the event as `add_ons` (+ `add_ons_enabled`),
 * normalized by lib/addOns.
 *
 * Quiet by design (owner, 2026-11-18): compact rows, 40pt controls, one 4px
 * corner, a fill and never a hairline, dot + label for state. Sale-window
 * times read 12-hour AM/PM, like the tiers' sale window above it.
 */
import React, { useState } from 'react';
import { Platform, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ChevronRight, Plus } from 'lucide-react-native';
import { useI18n } from '../../contexts/I18nContext';
import { formatCurrency } from '../../lib/currency';
import {
  ADD_ON_PRESETS,
  newAddOnId,
  normalizeAddOns,
  parseOptionList,
  type AddOnPresetKey,
  type EventAddOn,
} from '../../lib/addOns';
import FormSheet, { SheetInput, SheetLabel } from './FormSheet';
import WhitePillCTA from '../WhitePillCTA';
import { colors as T, radius } from '../../theme/tokens';

const K = 'addOns.editor';

interface Draft {
  id: string;
  name: string;
  price: string;
  description: string;
  image_url: string;
  quantity: string;
  options: string;
  max_per_order: string;
  /** ISO instants; '' = open. */
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
    options: (a.options || []).join(', '),
    max_per_order: a.max_per_order ? String(a.max_per_order) : '',
    sales_start: a.sales_start || '',
    sales_end: a.sales_end || '',
    tier_ids: a.tier_ids || [],
    is_active: a.is_active !== false,
  };
}

type Problem = 'name' | 'price' | 'window' | null;

function problemOf(d: Draft): Problem {
  if (!d.name.trim()) return 'name';
  const price = Number(d.price.replace(',', '.'));
  if (!Number.isFinite(price) || price <= 0) return 'price';
  if (d.sales_start && d.sales_end && new Date(d.sales_end).getTime() <= new Date(d.sales_start).getTime()) return 'window';
  return null;
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
      options: parseOptionList(d.options),
      max_per_order: d.max_per_order.trim() ? Number(d.max_per_order) : null,
      sales_start: d.sales_start || null,
      sales_end: d.sales_end || null,
      tier_ids: d.tier_ids,
      is_active: d.is_active,
    },
  ]);
  return clean ? { ...clean, id: d.id } : null;
}

/** "Mar 1" / "1 mars", the organizer's language. */
function dateText(iso: string, locale: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/** "8:00 PM" — 12-hour, like the tiers' sale window (Haiti reads AM/PM). */
function timeText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export interface AddOnsEditorTier {
  /** The saved tier doc id (a tier not saved yet cannot be a restriction). */
  id?: string;
  name: string;
}

interface Props {
  value: EventAddOn[];
  onChange: (next: EventAddOn[]) => void;
  tiers: AddOnsEditorTier[];
  currency: string;
}

type PickField = 'sales_start' | 'sales_end';

export default function AddOnsEditor({ value, onChange, tiers, currency }: Props) {
  const { t, language } = useI18n();
  const locale = language === 'fr' ? 'fr-FR' : language === 'ht' ? 'fr-HT' : 'en-US';
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [showProblem, setShowProblem] = useState(false);
  const [pick, setPick] = useState<{ field: PickField; mode: 'date' | 'time' } | null>(null);

  const savedTiers = tiers.filter((tr): tr is { id: string; name: string } => Boolean(tr.id));
  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const openNew = (preset?: AddOnPresetKey) => {
    setIsNew(true);
    setShowProblem(false);
    setPick(null);
    setDraft({
      id: newAddOnId(),
      name: preset ? t(`addOns.presets.${preset}`) : '',
      price: '',
      description: '',
      image_url: '',
      quantity: '',
      options: preset ? ADD_ON_PRESETS[preset].options.join(', ') : '',
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
    setPick(null);
    setDraft(toDraft(a));
  };

  const save = () => {
    if (!draft) return;
    if (problemOf(draft)) {
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

  /** Open the picker; an empty bound starts at today 8:00 PM so "Done" keeps a real value. */
  const openPick = (field: PickField, mode: 'date' | 'time') => {
    if (draft && !draft[field]) {
      const seed = new Date();
      seed.setHours(20, 0, 0, 0);
      patch({ [field]: seed.toISOString() } as Partial<Draft>);
    }
    setPick({ field, mode });
  };

  const onPicked = (_e: any, selected?: Date) => {
    if (Platform.OS === 'android') setPick(null);
    if (!selected || !pick || !draft) return;
    const existing = draft[pick.field];
    const base = existing ? new Date(existing) : new Date();
    if (Number.isNaN(base.getTime())) base.setTime(Date.now());
    if (pick.mode === 'date') base.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
    else base.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    patch({ [pick.field]: base.toISOString() } as Partial<Draft>);
  };

  const problem = draft && showProblem ? problemOf(draft) : null;
  const problemText =
    problem === 'name'
      ? t(`${K}.needsName`)
      : problem === 'price'
        ? t(`${K}.needsPrice`)
        : problem === 'window'
          ? t(`${K}.badWindow`)
          : null;

  const windowRow = (field: PickField, label: string) => {
    const iso = draft?.[field] || '';
    return (
      <View style={styles.windowRow}>
        <Text style={styles.windowLabel}>{label}</Text>
        <TouchableOpacity
          style={styles.windowCell}
          onPress={() => openPick(field, 'date')}
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${t(`${K}.date`)}`}
        >
          <Text style={iso ? styles.windowValue : styles.windowPlaceholder}>{iso ? dateText(iso, locale) : t(`${K}.date`)}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.windowCell}
          onPress={() => openPick(field, 'time')}
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${t(`${K}.time`)}`}
        >
          <Text style={iso ? styles.windowValue : styles.windowPlaceholder}>{iso ? timeText(iso) : t(`${K}.time`)}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View>
      <Text style={styles.title}>{t(`${K}.title`)}</Text>

      {value.map((a) => {
        const meta = [
          formatCurrency(a.price, currency),
          a.quantity ? t(`${K}.stockCount`, { count: a.quantity }) : t(`${K}.unlimited`),
          a.options && a.options.length ? a.options.join(' · ') : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <TouchableOpacity
            key={a.id}
            style={styles.row}
            onPress={() => openEdit(a)}
            accessibilityRole="button"
            accessibilityLabel={a.name}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.rowName} numberOfLines={1}>
                {a.name}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {meta}
              </Text>
            </View>
            {a.is_active === false && (
              <View style={styles.state}>
                <View style={[styles.dot, { backgroundColor: T.textTertiary }]} />
                <Text style={styles.stateText}>{t(`${K}.hiddenBadge`)}</Text>
              </View>
            )}
            <ChevronRight size={18} color={T.textTertiary} />
          </TouchableOpacity>
        );
      })}

      {/* Quick starts for what Haitian organizers sell most; each prefills a sheet. */}
      <View style={styles.presets}>
        {(Object.keys(ADD_ON_PRESETS) as AddOnPresetKey[]).map((key) => (
          <TouchableOpacity key={key} style={styles.preset} onPress={() => openNew(key)} accessibilityRole="button">
            <Plus size={14} color={T.textTertiary} />
            <Text style={styles.presetText}>{t(`addOns.presets.${key}`)}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.preset} onPress={() => openNew()} accessibilityRole="button">
          <Plus size={14} color={T.textTertiary} />
          <Text style={styles.presetText}>{t(`${K}.add`)}</Text>
        </TouchableOpacity>
      </View>

      <FormSheet
        visible={draft !== null}
        title={isNew ? t(`${K}.newTitle`) : t(`${K}.editTitle`)}
        onClose={() => setDraft(null)}
        closeLabel={t('common.close')}
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
            <View style={styles.twoCol}>
              <View style={{ flex: 2 }}>
                <SheetLabel>{t(`${K}.name`)}</SheetLabel>
                <SheetInput
                  value={draft.name}
                  onChangeText={(name) => patch({ name })}
                  placeholder={t(`${K}.namePlaceholder`)}
                  maxLength={60}
                />
              </View>
              <View style={{ flex: 1 }}>
                <SheetLabel>{t(`${K}.price`, { currency })}</SheetLabel>
                <SheetInput value={draft.price} onChangeText={(price) => patch({ price })} keyboardType="decimal-pad" placeholder="0" />
              </View>
            </View>

            <SheetLabel>{t(`${K}.description`)}</SheetLabel>
            <SheetInput
              value={draft.description}
              onChangeText={(description) => patch({ description })}
              placeholder={t(`${K}.descriptionPlaceholder`)}
              maxLength={240}
            />

            <SheetLabel>{t(`${K}.options`)}</SheetLabel>
            <SheetInput value={draft.options} onChangeText={(options) => patch({ options })} placeholder={t(`${K}.optionsPlaceholder`)} />
            <Text style={styles.hint}>{t(`${K}.optionsHint`)}</Text>

            <View style={styles.twoCol}>
              <View style={{ flex: 1 }}>
                <SheetLabel>{t(`${K}.quantity`)}</SheetLabel>
                <SheetInput
                  value={draft.quantity}
                  onChangeText={(quantity) => patch({ quantity: quantity.replace(/[^0-9]/g, '') })}
                  keyboardType="number-pad"
                  placeholder={t(`${K}.unlimited`)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <SheetLabel>{t(`${K}.maxPerOrder`)}</SheetLabel>
                <SheetInput
                  value={draft.max_per_order}
                  onChangeText={(m) => patch({ max_per_order: m.replace(/[^0-9]/g, '') })}
                  keyboardType="number-pad"
                  placeholder="10"
                />
              </View>
            </View>

            <SheetLabel>{t(`${K}.salesWindow`)}</SheetLabel>
            {windowRow('sales_start', t(`${K}.from`))}
            {windowRow('sales_end', t(`${K}.until`))}
            {(draft.sales_start || draft.sales_end) && (
              <TouchableOpacity
                onPress={() => {
                  setPick(null);
                  patch({ sales_start: '', sales_end: '' });
                }}
                style={styles.clearLink}
                accessibilityRole="button"
              >
                <Text style={styles.clearText}>{t(`${K}.clearWindow`)}</Text>
              </TouchableOpacity>
            )}
            {pick && Platform.OS === 'ios' && (
              <View style={styles.pickerWell}>
                <DateTimePicker
                  value={draft[pick.field] ? new Date(draft[pick.field]) : new Date()}
                  mode={pick.mode}
                  display="spinner"
                  themeVariant="dark"
                  // 12-hour times, the way the tiers' sale window reads.
                  locale={pick.mode === 'time' ? 'en_US' : undefined}
                  onChange={onPicked}
                />
                <TouchableOpacity onPress={() => setPick(null)} style={styles.pickerDoneRow} accessibilityRole="button">
                  <Text style={styles.pickerDone}>{t(`${K}.pickerDone`)}</Text>
                </TouchableOpacity>
              </View>
            )}
            {pick && Platform.OS === 'android' && (
              <DateTimePicker
                value={draft[pick.field] ? new Date(draft[pick.field]) : new Date()}
                mode={pick.mode}
                is24Hour={false}
                display="default"
                onChange={onPicked}
              />
            )}

            <SheetLabel>{t(`${K}.onlyWith`)}</SheetLabel>
            {savedTiers.length === 0 ? (
              <Text style={styles.hint}>{t(`${K}.onlyWithSaveFirst`)}</Text>
            ) : (
              <>
                <View style={styles.chips}>
                  {savedTiers.map((tr) => {
                    const on = draft.tier_ids.includes(tr.id);
                    return (
                      <TouchableOpacity
                        key={tr.id}
                        style={[styles.chip, on && styles.chipOn]}
                        onPress={() =>
                          patch({ tier_ids: on ? draft.tier_ids.filter((x) => x !== tr.id) : [...draft.tier_ids, tr.id] })
                        }
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                      >
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>{tr.name || t(`${K}.ticket`)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {draft.tier_ids.length === 0 && <Text style={styles.hint}>{t(`${K}.anyTicket`)}</Text>}
              </>
            )}

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>{t(`${K}.onSale`)}</Text>
              <Switch
                value={draft.is_active}
                onValueChange={(is_active) => patch({ is_active })}
                trackColor={{ false: T.border, true: T.teal }}
                thumbColor={T.white}
                ios_backgroundColor={T.border}
              />
            </View>
          </View>
        )}
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '700', color: T.textPrimary, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: T.surface,
    marginBottom: 6,
  },
  rowName: { fontSize: 15, fontWeight: '600', color: T.textPrimary },
  rowMeta: { marginTop: 2, fontSize: 12, color: T.textSecondary },
  state: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  stateText: { fontSize: 12, color: T.textTertiary },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  preset: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: T.surface,
  },
  presetText: { fontSize: 13, fontWeight: '600', color: T.textPrimary },
  hint: { fontSize: 12, color: T.textTertiary, marginTop: 2, marginBottom: 6 },
  twoCol: { flexDirection: 'row', gap: 10 },
  windowRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  windowLabel: { width: 56, fontSize: 13, color: T.textSecondary },
  windowCell: {
    flex: 1,
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: T.surfaceRaised,
  },
  windowValue: { fontSize: 15, color: T.textPrimary },
  windowPlaceholder: { fontSize: 15, color: T.textTertiary },
  pickerWell: { borderRadius: radius.sm, backgroundColor: T.surfaceRaised, marginTop: 4, marginBottom: 6 },
  pickerDoneRow: { alignSelf: 'flex-end', height: 40, justifyContent: 'center', paddingHorizontal: 16 },
  pickerDone: { fontSize: 15, fontWeight: '700', color: T.textPrimary },
  clearLink: { alignSelf: 'flex-start', paddingVertical: 8 },
  clearText: { fontSize: 13, color: T.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { height: 40, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radius.sm, backgroundColor: T.surfaceRaised },
  chipOn: { backgroundColor: T.white },
  chipText: { fontSize: 13, color: T.textPrimary },
  chipTextOn: { color: T.onWhite, fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  switchLabel: { fontSize: 15, color: T.textPrimary },
  problem: { fontSize: 13, color: T.red },
  removeLink: { alignItems: 'center', paddingVertical: 8 },
  removeText: { fontSize: 15, color: T.red, fontWeight: '600' },
});
