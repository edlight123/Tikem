/**
 * "Add-on sales" on the organizer's event screen: sold, picked up and face
 * revenue per add-on and option, from GET /api/organizer/events/:id/add-ons
 * (live tickets only, so refunded orders drop out). Renders nothing when the
 * event sold no add-ons, and for a team member without the finance permission
 * (the route answers 403 no_finance). Refreshed whenever the screen regains focus.
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { backendJson } from '../../lib/api/backend';
import { formatCurrency } from '../../lib/currency';
import SectionHeader from '../SectionHeader';
import { radius } from '../../theme/tokens';

type Row = { id: string; name: string; option: string | null; sold: number; pickedUp: number; revenue: number };
type Summary = { currency: string; rows: Row[]; totalSold: number; totalPickedUp: number; totalRevenue: number };

export default function AddOnSalesCard({ eventId }: { eventId: string }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = getStyles(colors);
  const [summary, setSummary] = useState<Summary | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      backendJson<Summary>(`/api/organizer/events/${encodeURIComponent(eventId)}/add-ons`)
        .then((data) => {
          if (!cancelled) setSummary(data && Array.isArray(data.rows) ? data : null);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [eventId])
  );

  if (!summary || summary.rows.length === 0) return null;

  return (
    <View style={styles.section}>
      <SectionHeader title={t('addOns.sales.title')} />
      <View style={styles.card}>
        {/* Two lines a row: the name never truncates on a 375pt phone. */}
        {summary.rows.map((r) => (
          <View key={`${r.id}|${r.option || ''}`} style={styles.row}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name} numberOfLines={2}>
                {r.option ? `${r.name} (${r.option})` : r.name}
              </Text>
              <Text style={styles.meta}>
                {`${r.sold} ${t('addOns.sales.sold').toLowerCase()} · ${r.pickedUp} ${t('addOns.sales.pickedUp').toLowerCase()}`}
              </Text>
            </View>
            <Text style={styles.money}>{formatCurrency(r.revenue, summary.currency)}</Text>
          </View>
        ))}
        <View style={[styles.row, styles.totalRow]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, styles.bold]}>{t('addOns.sales.total')}</Text>
            <Text style={styles.meta}>
              {`${summary.totalSold} ${t('addOns.sales.sold').toLowerCase()} · ${summary.totalPickedUp} ${t('addOns.sales.pickedUp').toLowerCase()}`}
            </Text>
          </View>
          <Text style={[styles.money, styles.bold]}>{formatCurrency(summary.totalRevenue, summary.currency)}</Text>
        </View>
      </View>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    section: { paddingHorizontal: 20, paddingTop: 32 },
    card: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 4, marginTop: 10 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 6 },
    totalRow: {},
    name: { fontSize: 15, color: colors.text, fontWeight: '600' },
    meta: { marginTop: 2, fontSize: 12, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
    money: { fontSize: 15, color: colors.text, fontVariant: ['tabular-nums'] },
    bold: { fontWeight: '700' },
  });
