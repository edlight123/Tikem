import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { X } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { backendJson } from '../lib/api/backend';
import { colors as T, font, radius } from '../theme/tokens';
import { Touchable } from '../components/ui/Touchable';
import WhitePillCTA from '../components/WhitePillCTA';
import FollowButton from '../components/FollowButton';
import { FEEDBACK_FACES } from '../components/FeedbackFace';

/**
 * "How was it?" — opened from the morning-after notification. Three faces, an
 * optional one-line comment, and Follow. One tap on a face is enough; the
 * comment is extra. Private to the organizer (their recap).
 */

type Payload = {
  event: { id: string; title: string; posterUrl: string | null; organizerId: string | null; organizerName: string | null };
  canRate: boolean;
  feedback: { rating: number | null; comment: string } | null;
};

const COMMENT_MAX = 280;

export default function EventFeedbackScreen() {
  const navigation: any = useNavigation();
  const route: any = useRoute();
  const eventId: string = String(route.params?.eventId || '');
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = getStyles(colors);

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [rating, setRating] = useState<1 | 2 | 3 | null>(null);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let live = true;
    backendJson<Payload>(`/api/events/${encodeURIComponent(eventId)}/feedback`)
      .then((d) => {
        if (!live) return;
        setData(d);
        const r = Number(d?.feedback?.rating);
        if (r === 1 || r === 2 || r === 3) setRating(r);
        if (d?.feedback?.comment) setComment(d.feedback.comment);
      })
      .catch(() => live && setFailed(true))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [eventId]);

  const close = () => navigation.goBack();

  const send = async () => {
    if (!rating || sending) return;
    setSending(true);
    try {
      await backendJson(`/api/events/${encodeURIComponent(eventId)}/feedback`, {
        method: 'POST',
        body: JSON.stringify({ rating, comment }),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setSent(true);
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  const ev = data?.event;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior="padding"
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <Touchable
            onPress={close}
            hitSlop={10}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <X size={20} color={colors.text} />
          </Touchable>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.textSecondary} style={{ marginTop: 80 }} />
        ) : !ev ? (
          <Text style={styles.muted}>{t('eventFeedback.loadFailed')}</Text>
        ) : (
          <>
            {ev.posterUrl ? (
              <Image source={{ uri: ev.posterUrl }} style={styles.poster} contentFit="cover" transition={150} />
            ) : null}
            <Text style={styles.eventTitle} numberOfLines={2}>
              {ev.title}
            </Text>

            {sent ? (
              <View style={styles.thanks}>
                <Text style={styles.heading}>{t('eventFeedback.thanks')}</Text>
                {ev.organizerId ? (
                  <View style={styles.followRow}>
                    <Text style={styles.followName} numberOfLines={1}>
                      {ev.organizerName || ''}
                    </Text>
                    <FollowButton organizerId={ev.organizerId} compact />
                  </View>
                ) : null}
                <WhitePillCTA label={t('common.done')} onPress={close} style={styles.cta} />
              </View>
            ) : !data?.canRate ? (
              <Text style={styles.muted}>{t('eventFeedback.notAttended')}</Text>
            ) : (
              <>
                <Text style={styles.heading}>{t('eventFeedback.howWasIt')}</Text>
                <View style={styles.faces}>
                  {FEEDBACK_FACES.map((f) => {
                    const active = rating === f.rating;
                    const Icon = f.Icon;
                    return (
                      // Touchable styles its INNER view; the outer cell takes the flex.
                      <View key={f.rating} style={styles.faceCell}>
                        <Touchable
                          style={[styles.face, active && styles.faceActive]}
                          onPress={() => {
                            Haptics.selectionAsync().catch(() => {});
                            setRating(f.rating);
                          }}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          accessibilityLabel={t(f.key)}
                        >
                          <Icon size={30} strokeWidth={1.5} color={active ? T.onWhite : colors.text} />
                          <Text style={[styles.faceLabel, active && styles.faceLabelActive]} numberOfLines={1}>
                            {t(f.key)}
                          </Text>
                        </Touchable>
                      </View>
                    );
                  })}
                </View>

                <TextInput
                  value={comment}
                  onChangeText={(v) => setComment(v.slice(0, COMMENT_MAX))}
                  placeholder={t('eventFeedback.commentPlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  style={styles.input}
                  multiline
                  maxLength={COMMENT_MAX}
                />

                {ev.organizerId ? (
                  <View style={styles.followRow}>
                    <Text style={styles.followName} numberOfLines={1}>
                      {ev.organizerName || ''}
                    </Text>
                    <FollowButton organizerId={ev.organizerId} compact />
                  </View>
                ) : null}

                {failed ? <Text style={styles.error}>{t('eventFeedback.sendFailed')}</Text> : null}
                <WhitePillCTA
                  label={t('eventFeedback.send')}
                  onPress={send}
                  disabled={!rating}
                  loading={sending}
                  style={styles.cta}
                />
              </>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: 20, paddingTop: 12 },
    topBar: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 8 },
    closeButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: T.surfaceRaised,
    },
    poster: {
      width: 120,
      aspectRatio: 4 / 5,
      borderRadius: radius.button,
      alignSelf: 'center',
      backgroundColor: T.surface,
    },
    eventTitle: {
      fontFamily: font.serif,
      fontSize: 30,
      color: colors.text,
      textAlign: 'center',
      marginTop: 16,
    },
    heading: {
      fontFamily: font.serif,
      fontSize: 24,
      color: colors.text,
      textAlign: 'center',
      marginTop: 28,
      marginBottom: 18,
    },
    faces: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
    faceCell: { flex: 1 },
    face: {
      height: 104,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.button,
      backgroundColor: T.surfaceRaised,
    },
    faceActive: { backgroundColor: T.white },
    faceLabel: { marginTop: 10, fontSize: 13, fontWeight: '600', letterSpacing: 0.2, color: colors.textSecondary },
    faceLabelActive: { color: T.onWhite },
    input: {
      marginTop: 16,
      minHeight: 72,
      borderRadius: radius.button,
      backgroundColor: T.surface,
      color: colors.text,
      fontSize: 16,
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 12,
      textAlignVertical: 'top',
    },
    followRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 24,
      gap: 12,
    },
    followName: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: colors.text },
    cta: { marginTop: 24 },
    thanks: { alignItems: 'stretch' },
    muted: { marginTop: 32, fontSize: 15, color: colors.textSecondary, textAlign: 'center' },
    error: { marginTop: 16, fontSize: 14, color: T.red, textAlign: 'center' },
  });
