import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useI18n } from '../../contexts/I18nContext';
import { colors as T } from '../../theme/tokens';
import { formatEventDateTime } from '../../lib/eventClock';

type Stamp = {
  at?: string;
  kinds?: string[];
  before?: { start?: string | null; venue?: string; city?: string; online?: boolean };
};

/**
 * "Date and time changed · was Sat, May 1 8:00 PM": shown on the holder's
 * tickets after the organizer moved a live event (events/{id}.change_notice,
 * written by the web's lib/events/change-notices once holders were told).
 * A dot and a quiet line, no card. Hidden once the event is over.
 */
export default function ChangeNoticeLines({ event }: { event: any }) {
  const { t, language } = useI18n();
  const stamp: Stamp | null = event?.change_notice || null;
  if (!stamp || !Array.isArray(stamp.kinds) || stamp.kinds.length === 0) return null;
  const endRaw = event?.end_datetime || event?.start_datetime;
  const ends = endRaw ? new Date(typeof endRaw?.toDate === 'function' ? endRaw.toDate() : endRaw).getTime() : NaN;
  if (Number.isFinite(ends) && ends < Date.now()) return null;

  const before = stamp.before || {};
  const was = (value: string) => (value ? String(t('tickets.changeNotice.was')).replace('{value}', value) : '');
  const lines: Array<{ key: string; label: string; was: string }> = [];
  if (stamp.kinds.includes('when')) {
    const value = before.start
      ? formatEventDateTime(before.start, event, language, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }, { weekday: 'short', month: 'short', day: 'numeric' })
      : '';
    lines.push({ key: 'when', label: t('tickets.changeNotice.when'), was: was(value) });
  }
  if (stamp.kinds.includes('where')) {
    const value = before.online
      ? t('tickets.changeNotice.online')
      : [before.venue, before.city].filter(Boolean).join(', ');
    lines.push({ key: 'where', label: t('tickets.changeNotice.where'), was: was(value) });
  }
  if (stamp.kinds.includes('link') && !stamp.kinds.includes('where')) {
    lines.push({ key: 'link', label: t('tickets.changeNotice.link'), was: '' });
  }
  if (!lines.length) return null;

  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      {lines.map((l) => (
        <View key={l.key} style={styles.row}>
          <View style={styles.dot} />
          <Text style={styles.text}>
            <Text style={styles.label}>{l.label}</Text>
            {l.was ? ` · ${l.was}` : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14, marginHorizontal: 16, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.amber, marginTop: 6 },
  text: { flex: 1, fontSize: 13, lineHeight: 18, color: T.textSecondary },
  label: { fontWeight: '600', color: T.textPrimary },
});
