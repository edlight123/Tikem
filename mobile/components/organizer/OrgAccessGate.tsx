import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Lock } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { useActiveOrg } from '../../lib/activeOrg';
import type { OrgAction } from '../../lib/orgTeamRoles';
import EmptyState from '../EmptyState';
import OrganizerScreenHeader from './OrganizerScreenHeader';

/** The calm "not for your role" line for each gated action ('finance' = read-only finances). */
function noticeKeys(action: OrgAction | 'finance'): { title: string; body: string } {
  switch (action) {
    case 'finance':
      return { title: 'orgTeam.gate.financeTitle', body: 'orgTeam.gate.financeBody' };
    case 'owner_only':
      return { title: 'orgTeam.gate.ownerOnlyTitle', body: 'orgTeam.gate.ownerOnlyBody' };
    case 'manage_team':
      return { title: 'orgTeam.gate.teamTitle', body: 'orgTeam.gate.teamBody' };
    case 'manage_settings':
      return { title: 'orgTeam.gate.settingsTitle', body: 'orgTeam.gate.settingsBody' };
    default:
      return { title: 'orgTeam.gate.viewTitle', body: 'orgTeam.gate.viewBody' };
  }
}

/**
 * Shown in place of a screen the acting role may not use (a manager who
 * reaches Payouts through a deep link, say). Never an error: a header with a
 * back button and one quiet line saying who can do this.
 */
export function OrgAccessNotice({ action }: { action: OrgAction | 'finance' }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const navigation = useNavigation<any>();
  const { orgName } = useActiveOrg();
  const keys = noticeKeys(action);
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OrganizerScreenHeader
        title={orgName || t('orgTeam.gate.header')}
        onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
      />
      <View style={styles.body}>
        <EmptyState icon={Lock} title={t(keys.title as any)} subtitle={t(keys.body as any)} />
      </View>
    </View>
  );
}

/**
 * Wrap a screen so it only renders when the acting role allows `action`
 * (lib/orgTeamRoles.ts). Everyone acting for their own org is the owner, so
 * accounts without a team see no change.
 */
export function withOrgAccess<P extends object>(Screen: React.ComponentType<P>, action: OrgAction) {
  function Gated(props: P) {
    const { can } = useActiveOrg();
    if (!can(action)) return <OrgAccessNotice action={action} />;
    return <Screen {...props} />;
  }
  Gated.displayName = `withOrgAccess(${Screen.displayName || Screen.name || 'Screen'})`;
  return Gated;
}

/**
 * Wrap a finance screen (earnings, payout history): the owner, or an admin
 * the owner granted read-only finances. The screen itself drops every
 * money-out action when the viewer is not the owner; the server enforces both.
 */
export function withFinanceAccess<P extends object>(Screen: React.ComponentType<P>) {
  function Gated(props: P) {
    const { financeView } = useActiveOrg();
    if (!financeView) return <OrgAccessNotice action="finance" />;
    return <Screen {...props} />;
  }
  Gated.displayName = `withFinanceAccess(${Screen.displayName || Screen.name || 'Screen'})`;
  return Gated;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 80 },
});
