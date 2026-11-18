import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Bell, Clock, Heart, Send } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { colors as T } from '../../theme/tokens';
import { backendJson } from '../../lib/api/backend';
import { inboxTime } from '../../lib/messageTime';
import { safeFormatForLanguage } from '../../lib/dates';
import SectionHeader from '../SectionHeader';
import WhitePillCTA from '../WhitePillCTA';
import { ListGroup, ListRow } from '../ui/ListRow';
import { Skeleton } from '../Skeleton';

type Update = { id: string; title: string; message: string; createdAt: string | null; recipients: number | null };
type Auto = { type: string; at: string | null; sentAt: string | null };
type Data = { updates: Update[]; automatic: Auto[] };

const AUTO_ICON: Record<string, any> = {
  event_reminder_24h: Bell,
  event_reminder_3h: Clock,
  event_reminder_30min: Clock,
  post_event_followup: Heart,
};

/**
 * The one-to-many half of an event's Messages page (owner, 2026-11-18: "include
 * the template messages as well, like bulk messages, notifications"): a compact
 * New message, what was sent to everyone, and the messages Tikèm sends on its
 * own with when they go out. No explainer copy.
 */
export default function EventAnnouncements({ eventId, eventTitle }: { eventId: string; eventTitle: string }) {
  const { colors } = useTheme();
  const { t, language } = useI18n();
  const navigation: any = useNavigation();
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      backendJson<Data>(`/api/organizer/event-update?eventId=${encodeURIComponent(eventId)}`)
        .then((d) => {
          if (alive) {
            setData(d);
            setFailed(false);
          }
        })
        .catch(() => alive && setFailed(true));
      return () => {
        alive = false;
      };
    }, [eventId])
  );

  const status = (a: Auto) => {
    if (a.sentAt) return { color: T.textTertiary, label: t('organizerMessages.statusSent') };
    if (a.at && new Date(a.at).getTime() < Date.now()) return null; // window passed before the event existed
    const when = a.at ? safeFormatForLanguage(a.at, 'MMM d, h:mm a', language) : t('organizerMessages.morningAfter');
    return { color: T.accent, label: when };
  };

  return (
    <View style={styles.wrap}>
      <WhitePillCTA
        size="sm"
        label={t('organizerMessages.newMessage')}
        onPress={() => navigation.navigate('SendEventUpdate', { eventId, eventTitle })}
        style={styles.cta}
      />

      <SectionHeader title={t('organizerMessages.sentSection')} />
      {!data && !failed ? (
        <Skeleton width="100%" height={52} />
      ) : (data?.updates || []).length === 0 ? (
        <Text style={styles.quiet}>{t('organizerMessages.nothingSent')}</Text>
      ) : (
        <ListGroup>
          {data!.updates.map((u) => (
            <ListRow
              key={u.id}
              icon={Send}
              title={u.title}
              subtitle={[
                u.createdAt ? inboxTime(u.createdAt, language, { yesterday: t('attendeeMessages.yesterday') }) : '',
                u.recipients == null
                  ? ''
                  : u.recipients === 1
                    ? t('organizerMessages.recipientsOne')
                    : t('organizerMessages.recipients', { count: u.recipients }),
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))}
        </ListGroup>
      )}

      <View style={styles.gap} />
      <SectionHeader title={t('organizerMessages.automaticTitle')} />
      <ListGroup>
        {(data?.automatic || [
          { type: 'event_reminder_24h', at: null, sentAt: null },
          { type: 'event_reminder_3h', at: null, sentAt: null },
          { type: 'event_reminder_30min', at: null, sentAt: null },
          { type: 'post_event_followup', at: null, sentAt: null },
        ]).map((a) => {
          const s = data ? status(a) : null;
          return (
            <ListRow
              key={a.type}
              icon={AUTO_ICON[a.type] || Bell}
              title={t(`organizerMessages.auto.${a.type}`)}
              trailing={
                s ? (
                  <View style={styles.dotRow}>
                    <View style={[styles.dot, { backgroundColor: s.color }]} />
                    <Text style={[styles.dotLabel, { color: colors.textSecondary }]} numberOfLines={1}>
                      {s.label}
                    </Text>
                  </View>
                ) : undefined
              }
            />
          );
        })}
      </ListGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8 },
  cta: { alignSelf: 'flex-start', marginBottom: 24 },
  quiet: { fontSize: 13, color: T.textSecondary },
  gap: { height: 28 },
  dotRow: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 160 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotLabel: { fontSize: 12 },
});
