import React, { useState } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useFocusEffect } from '@react-navigation/native';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { useSocialFlags } from '../lib/socialFlags';
import { fetchInviteSummary, type InviteSummary as Summary } from '../lib/api/invites';
import SectionHeader from './SectionHeader';

/**
 * "Your invites" on Profile (web lib/invites): invites sent, friends who joined
 * from your link, friends who bought. Counts only. Nothing when the invites
 * switch is off, signed out, or the user has never invited anyone.
 *
 * Carries no outer margin of its own: the caller passes its block spacing, so
 * the gap above and below matches every other section on the page.
 */
export default function InviteSummary({ style }: { style?: StyleProp<ViewStyle> }) {
  const { t } = useI18n();
  const { colors } = useTheme();
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
    <View style={style}>
      <SectionHeader title={t('invites.summaryTitle')} />
      {/* One quiet line, like the profile stats: three big numerals read heavy
          (TestFlight 2026-11-14). */}
      <Text style={{ fontSize: 13, color: colors.textSecondary }}>
        {[
          { label: t('invites.summarySent'), value: summary.sent },
          { label: t('invites.summaryJoined'), value: summary.joined },
          { label: t('invites.summaryBought'), value: summary.purchased },
        ].map((item, i) => (
          <Text key={item.label}>
            {i > 0 ? '   ·   ' : ''}
            <Text style={{ fontWeight: '700', color: colors.text }}>{item.value}</Text> {item.label.toLowerCase()}
          </Text>
        ))}
      </Text>
    </View>
  );
}
