import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { radius } from '../theme/tokens';
import { nationalDayText, type ActiveNationalDay } from '../lib/nationalDays';
import { nationalDayArt } from '../lib/nationalDaysRemote';
import { NoticeStrip } from './ui/NoticeStrip';

interface Props {
  active: ActiveNationalDay;
  /** Omit to hide the link (a low-key day with no tagged events). */
  onSeeEvents?: () => void;
  onDismiss: () => void;
}

/**
 * The national day at the top of Home, as the house notice strip (owner,
 * TestFlight 2026-11-25: no big cards; this used to be a poster up to 55% of
 * the screen). A small 4:5 thumb of the day's art, the day's name in the
 * serif, when it is on a second line, one quiet "See" link and a ×. Its rail
 * of tagged events sits right under it on Home.
 */
export default function NationalDayBanner({ active, onSeeEvents, onDismiss }: Props) {
  const { colors } = useTheme();
  const { t, language } = useI18n();
  const art = nationalDayArt(active.day);
  const { title } = nationalDayText(active.day, language);

  const when =
    active.phase === 'today'
      ? t('home.nationalDay.today')
      : active.daysUntil === 1
        ? t('home.nationalDay.tomorrow')
        : t('home.nationalDay.inDays', { count: active.daysUntil });

  const thumb = (
    <View style={[styles.thumb, { backgroundColor: colors.surfaceRaised }]}>
      {art && (
        <Image
          source={art.source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory"
          accessibilityLabel={art.alt}
        />
      )}
    </View>
  );

  return (
    <NoticeStrip
      leading={thumb}
      text={title}
      serif
      sub={when}
      onPress={onSeeEvents}
      accessibilityLabel={onSeeEvents ? `${title}. ${t('home.nationalDay.seeEvents')}` : title}
      action={
        onSeeEvents
          ? { label: t('home.nationalDay.see'), onPress: onSeeEvents, accessibilityLabel: t('home.nationalDay.seeEvents') }
          : undefined
      }
      onDismiss={onDismiss}
      dismissLabel={t('home.nationalDay.dismiss')}
      style={styles.strip}
    />
  );
}

const styles = StyleSheet.create({
  strip: { marginHorizontal: 16, marginTop: 8, marginBottom: 20, paddingLeft: 8 },
  thumb: { width: 32, height: 40, borderRadius: radius.poster, overflow: 'hidden' },
});
