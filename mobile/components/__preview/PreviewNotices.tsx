// TEMPORARY visual-check harness. Delete before commit.
import React from 'react';
import { View } from 'react-native';
import { Eye, Users } from 'lucide-react-native';
import { useI18n } from '../../contexts/I18nContext';
import { NoticeStrip } from '../ui/NoticeStrip';
import NationalDayBanner from '../NationalDayBanner';
import EmptyState from '../EmptyState';
import Flag from '../Flag';
import OldAnnouncementCard from './OldAnnouncementCard';
import OldNationalDayBanner from './OldNationalDayBanner';
import OldEmptyState from './OldEmptyState';
import { activeNationalDay } from '../../lib/nationalDays';
import { artByKey } from '../../lib/artLibrary';

const MODE: string = 'after';

export default function PreviewNotices() {
  const { t } = useI18n();
  if (!MODE) return null;
  const before = MODE.startsWith('before');
  const empty = MODE.endsWith('empty');
  const day = activeNationalDay(new Date(), null, { force: 'vertieres' })!;
  const noop = () => {};

  if (empty) {
    const art = artByKey('photo-lavi-crowd');
    return before ? (
      <OldEmptyState art={art} title={t('tickets.emptyUpcomingTitle')} subtitle={t('tickets.emptyUpcomingBody')} actionLabel={'Browse events'} onAction={noop} />
    ) : (
      <EmptyState art={art} title={t('tickets.emptyUpcomingTitle')} subtitle={t('tickets.emptyUpcomingBody')} actionLabel={'Browse events'} onAction={noop} />
    );
  }

  if (before) {
    return (
      <View style={{ gap: 12, marginBottom: 12 }}>
        <OldAnnouncementCard
          icon={Eye}
          eyebrow="Confidentialité"
          title="Vos amis voient vos sorties"
          body="Les événements où vous allez sont maintenant visibles par vos amis. C'est vous qui choisissez qui les voit."
          primary={{ label: 'Voir la confidentialité', onPress: noop }}
          secondary={{ label: 'Compris', onPress: noop }}
          style={{ marginHorizontal: 16 }}
        />
        <OldAnnouncementCard
          icon={Users}
          eyebrow="Amis"
          title="Retrouvez vos proches"
          primary={{ label: 'Trouver des amis', onPress: noop }}
          secondary={{ label: 'Plus tard', onPress: noop }}
          style={{ marginHorizontal: 16 }}
        />
        <OldNationalDayBanner active={day} onSeeEvents={noop} onDismiss={noop} />
      </View>
    );
  }

  return (
    <View style={{ gap: 8, marginBottom: 12 }}>
      <NoticeStrip
        icon={Eye}
        text={t('home.attendanceNotice.text')}
        action={{ label: t('home.attendanceNotice.settings'), onPress: noop }}
        onDismiss={noop}
        dismissLabel={t('home.attendanceNotice.dismiss')}
        style={{ marginHorizontal: 16 }}
      />
      <NoticeStrip
        icon={Users}
        text={t('profile.findFriends.title')}
        onPress={noop}
        action={{ label: t('profile.findFriends.rowAction'), onPress: noop }}
        onDismiss={noop}
        dismissLabel={t('profile.findFriends.dismiss')}
        style={{ marginHorizontal: 16 }}
      />
      <NoticeStrip
        leading={<Flag code="US" size={18} />}
        text={t('locationBanner.ask.US')}
        action={{ label: t('locationBanner.show'), onPress: noop }}
        onDismiss={noop}
        dismissLabel={t('locationBanner.notNow')}
        style={{ marginHorizontal: 16 }}
      />
      <NationalDayBanner active={day} onSeeEvents={noop} onDismiss={noop} />
    </View>
  );
}
