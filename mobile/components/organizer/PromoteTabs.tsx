import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { Touchable } from '../ui/Touchable';

/**
 * Promoters | Tracking links: the two kinds of sales-tracking link for one
 * event, one tap apart (owner: "there should be two tabs, right?"). Underline
 * tabs like My events. Switching replaces the screen so Back still returns to
 * the event.
 */
export default function PromoteTabs({ active, eventId }: { active: 'promoters' | 'links'; eventId: string }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const navigation = useNavigation<any>();
  const styles = getStyles(colors);
  const tabs: Array<{ key: 'promoters' | 'links'; label: string; route: string }> = [
    { key: 'promoters', label: t('organizerEventManagement.actions.promoters'), route: 'OrganizerPromoters' },
    { key: 'links', label: t('organizerEventManagement.actions.trackingLinks'), route: 'OrganizerTrackingLinks' },
  ];
  return (
    <View style={styles.track} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <Touchable
            key={tab.key}
            haptic={false}
            scale={1}
            style={[styles.tab, on && styles.tabOn]}
            onPress={() => {
              if (!on) navigation.replace(tab.route, { eventId });
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.label, on && styles.labelOn]}>{tab.label}</Text>
          </Touchable>
        );
      })}
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    track: {
      flexDirection: 'row',
      gap: 24,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      marginBottom: 20,
    },
    tab: {
      paddingTop: 4,
      paddingBottom: 10,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
      marginBottom: -StyleSheet.hairlineWidth,
    },
    tabOn: { borderBottomColor: colors.text },
    label: { fontSize: 15, fontWeight: '500', color: colors.textSecondary },
    labelOn: { color: colors.text, fontWeight: '600' },
  });
