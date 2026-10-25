import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { useActiveOrg, type OrgOption } from '../../lib/activeOrg';
import { colors as T, radius } from '../../theme/tokens';
import FormSheet from './FormSheet';

/** "Org name · Role", the one way an acting org is named in the app. */
export function useOrgLabel() {
  const { t } = useI18n();
  const roleLabel = (role: OrgOption['role'] | null | undefined) =>
    role ? t(`orgTeam.roles.${role}` as any) : '';
  const orgLabel = (o: Pick<OrgOption, 'orgName' | 'role'>) =>
    (o.orgName || '').trim() || (o.role === 'owner' ? t('orgTeam.yourOrg') : t('orgTeam.unnamedOrg'));
  return { roleLabel, orgLabel, line: (o: Pick<OrgOption, 'orgName' | 'role'>) => `${orgLabel(o)} · ${roleLabel(o.role)}` };
}

/**
 * The orgs this person can run, one filled row each with a radio. Picking one
 * makes it the acting org at once (every organizer screen reloads off it).
 */
export function OrgSwitcherList({
  onPicked,
  onSheet = false,
}: {
  onPicked?: (orgId: string) => void;
  /** On a sheet (already `surface`), rows step up one more so they still read as fills. */
  onSheet?: boolean;
}) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { options, orgId, switchTo } = useActiveOrg();
  const { roleLabel, orgLabel } = useOrgLabel();
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <View style={styles.list}>
      {options.map((o, i) => {
        const active = o.orgId === orgId;
        return (
          <TouchableOpacity
            key={o.orgId}
            style={[styles.row, i > 0 && styles.rowGap, (active || onSheet) && styles.rowActive]}
            activeOpacity={0.75}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${orgLabel(o)}, ${roleLabel(o.role)}`}
            onPress={async () => {
              if (active) {
                onPicked?.(o.orgId);
                return;
              }
              setBusy(o.orgId);
              try {
                await switchTo(o.orgId);
              } finally {
                setBusy(null);
              }
              onPicked?.(o.orgId);
            }}
          >
            <View style={styles.meta}>
              <Text style={styles.name} numberOfLines={1}>
                {orgLabel(o)}
              </Text>
              <Text style={styles.role} numberOfLines={1}>
                {roleLabel(o.role)}
              </Text>
            </View>
            {busy === o.orgId ? (
              <ActivityIndicator color={colors.textSecondary} />
            ) : (
              <View style={[styles.radio, active && styles.radioOn]}>
                {active ? <View style={styles.radioDot} /> : null}
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** The switcher as a bottom sheet (organizer home header). */
export function OrgSwitcherSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <FormSheet visible={visible} title={t('orgTeam.switcher.title')} onClose={onClose} closeLabel={t('common.close')}>
      <View style={{ marginTop: 12 }}>
        <OrgSwitcherList onPicked={onClose} onSheet />
      </View>
    </FormSheet>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    list: { marginTop: 10 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderRadius: radius.md,
      backgroundColor: T.surface,
    },
    rowGap: { marginTop: 8 },
    rowActive: { backgroundColor: T.surfaceRaised },
    meta: { flex: 1, minWidth: 0 },
    name: { fontSize: 15, fontWeight: '700', color: colors.text },
    role: { marginTop: 2, fontSize: 12, color: colors.textSecondary },
    radio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: 'rgba(255,255,255,0.14)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioOn: { backgroundColor: T.white },
    radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: T.onWhite },
  });
