import React, { useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { useSocialFlags } from '../lib/socialFlags';
import { fetchInviteSummary, type InviteSummary as Summary } from '../lib/api/invites';
import SectionHeader from './SectionHeader';
import StatTriplet from './StatTriplet';

/**
 * "Your invites" on Profile (web lib/invites): invites sent, friends who joined
 * from your link, friends who bought. Counts only. Nothing when the invites
 * switch is off, signed out, or the user has never invited anyone.
 */
export default function InviteSummary() {
  const { t } = useI18n();
  const { user } = useAuth();
  const flags = useSocialFlags();
  const [summary, setSummary] = useState<Summary | null>(null);
  const on = flags.invites && !!user;

  const load = React.useCallback(() => {
    if (!on) {
      setSummary(null);
      return () => undefined;
    }
    let active = true;
    fetchInviteSummary().then((s) => {
      if (active) setSummary(s);
    });
    return () => {
      active = false;
    };
  }, [on]);

  useFocusEffect(load);

  if (!on || !summary || summary.sent + summary.joined + summary.purchased === 0) return null;
  return (
    <View style={{ marginBottom: 20 }}>
      <SectionHeader title={t('invites.summaryTitle')} />
      <StatTriplet
        items={[
          { label: t('invites.summarySent'), value: summary.sent },
          { label: t('invites.summaryJoined'), value: summary.joined },
          { label: t('invites.summaryBought'), value: summary.purchased },
        ]}
      />
    </View>
  );
}
