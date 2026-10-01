/**
 * LineupEditor — the composer's lineup section (artists, hosts, DJs, guests).
 *
 * Same data and behaviour as the web composer's Guestlist block: the bill in
 * running order, each row the whole entry in miniature (face, name, role, set
 * time, whether a link is attached), tap to edit in a sheet, reorder with the
 * arrows, remove with ×. Persisted on the event doc as `guestlist` via
 * lib/lineup's record shape, so web and mobile read each other's lineups.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import SectionHeader from '../SectionHeader';
import LineupEntrySheet from './LineupEntrySheet';
import {
  ROLE_LABEL_KEY,
  emptyLineupEntry,
  lineupTimeRange,
  type LineupEntry,
} from '../../lib/lineup';
import { font, radius } from '../../theme/tokens';

const K = 'organizerCreateEventFlow.canvas.lineup';

interface Props {
  value: LineupEntry[];
  onChange: (next: LineupEntry[]) => void;
}

export default function LineupEditor({ value, onChange }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = getStyles(colors);

  // The entry open in the sheet — a COPY, so Cancel discards half-typed edits.
  const [draft, setDraft] = useState<LineupEntry | null>(null);
  const [draftIsNew, setDraftIsNew] = useState(true);

  const openNew = () => {
    setDraft(emptyLineupEntry());
    setDraftIsNew(true);
  };
  const openEdit = (g: LineupEntry) => {
    setDraft({ ...g });
    setDraftIsNew(false);
  };
  const save = () => {
    if (!draft) return;
    const entry = { ...draft, name: draft.name.trim() };
    if (!entry.name) return;
    onChange(draftIsNew ? [...value, entry] : value.map((g) => (g.id === entry.id ? entry : g)));
    setDraft(null);
  };
  const remove = (id: string) => onChange(value.filter((g) => g.id !== id));
  // A lineup is a running order, so order must be adjustable in place.
  const move = (id: string, dir: -1 | 1) => {
    const i = value.findIndex((g) => g.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= value.length) return;
    const next = value.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <View style={styles.wrap}>
      <SectionHeader title={t(`${K}.title`)} subtitle={t(`${K}.hint`)} />

      {value.map((g, i) => {
        const when = lineupTimeRange(g.startTime, g.endTime);
        return (
          <View key={g.id} style={styles.row}>
            <TouchableOpacity
              style={styles.rowMain}
              onPress={() => openEdit(g)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={g.name}
            >
              <View style={styles.avatar}>
                {g.photoUrl ? (
                  <Image source={{ uri: g.photoUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <Text style={styles.avatarInitial}>{g.name.trim().charAt(0).toUpperCase()}</Text>
                )}
              </View>
              <View style={styles.rowText}>
                <Text style={styles.name} numberOfLines={1}>
                  {g.name}
                </Text>
                <View style={styles.metaRow}>
                  <Text style={styles.meta} numberOfLines={1}>
                    {t(`${K}.roles.${ROLE_LABEL_KEY[g.role]}`)}
                    {when ? `  ·  ${when}` : ''}
                  </Text>
                  {!!g.link && <Ionicons name="link-outline" size={13} color={colors.textTertiary} />}
                </View>
              </View>
            </TouchableOpacity>

            {/* Running order. Both arrows always render (dimmed at the ends)
                so the row's controls never shift as entries move. */}
            <View style={styles.order}>
              <TouchableOpacity
                onPress={() => move(g.id, -1)}
                disabled={i === 0}
                hitSlop={{ top: 6, bottom: 2, left: 8, right: 8 }}
                accessibilityLabel={t(`${K}.moveUp`)}
              >
                <Ionicons name="chevron-up" size={16} color={i === 0 ? colors.border : colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => move(g.id, 1)}
                disabled={i === value.length - 1}
                hitSlop={{ top: 2, bottom: 6, left: 8, right: 8 }}
                accessibilityLabel={t(`${K}.moveDown`)}
              >
                <Ionicons
                  name="chevron-down"
                  size={16}
                  color={i === value.length - 1 ? colors.border : colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.removeBtn}
              onPress={() => remove(g.id)}
              hitSlop={8}
              accessibilityLabel={`${t(`${K}.remove`)} ${g.name}`}
            >
              <Ionicons name="close" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        );
      })}

      <TouchableOpacity style={styles.addRow} onPress={openNew} activeOpacity={0.8}>
        <Ionicons name="add" size={20} color={colors.text} />
        <Text style={styles.addText}>{t(`${K}.add`)}</Text>
      </TouchableOpacity>

      <LineupEntrySheet
        draft={draft}
        isNew={draftIsNew}
        onPatch={(patch) => setDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
        onSave={save}
        onCancel={() => setDraft(null)}
      />
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    wrap: { marginTop: 28 },
    // Each act is a filled row on the canvas — no outlines.
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      paddingLeft: 12,
      paddingRight: 10,
      paddingVertical: 10,
      marginBottom: 8,
    },
    rowMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      overflow: 'hidden',
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarInitial: { fontFamily: font.serif, fontSize: 22, color: colors.text },
    rowText: { flex: 1, minWidth: 0, gap: 2 },
    name: { fontSize: 15, fontWeight: '600', color: colors.text },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    meta: { flexShrink: 1, fontSize: 12, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
    order: { alignItems: 'center', gap: 2 },
    removeBtn: {
      width: 30,
      height: 30,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceRaised,
    },
    addRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 48,
      borderRadius: radius.button,
      backgroundColor: colors.surface,
    },
    addText: { fontSize: 15, fontWeight: '600', color: colors.text },
  });
