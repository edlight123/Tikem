import React from 'react';
import { View, StyleSheet } from 'react-native';
import EventRail from './EventRail';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { REGION_LABELS, elsewhereScopeFor, type Metro } from '../data/metros';
import { countryIn, translateOrNull } from '../lib/locationCopy';

interface ElsewhereRailProps {
  /** Already filtered to "same country/region, other metro" by the caller. */
  events: any[];
  /** The metro the user is browsing. Null = no rail. */
  metro: Metro | null;
  onEventPress: (eventId: string) => void;
  limit?: number;
}

/**
 * The ONE labelled national rail.
 *
 * Browsing is scoped to a single metro and never widens by itself. This rail is
 * the deliberate, visible exception: below the local content, clearly separated
 * by a rule and clearly labelled "elsewhere in Haiti", it surfaces the top
 * events from OTHER metros. It exists because Haiti has few metros and thin
 * supply — an event two towns over is still worth knowing about.
 *
 * It is never mixed into local results, and it is country-aware: in the US
 * "elsewhere in the country" is meaningless, so the caller's event list is
 * scoped to the same state/region there, and to nothing at all where even that
 * makes no sense (see ELSEWHERE_SCOPE in data/metros).
 */
export default function ElsewhereRail({ events, metro, onEventPress, limit = 8 }: ElsewhereRailProps) {
  const { colors } = useTheme();
  const { t } = useI18n();

  if (!metro || events.length === 0) return null;

  const scope = elsewhereScopeFor(metro.country);
  if (scope === 'none') return null;

  // "Haiti" / "Florida", localized — in the form that follows "in", since some
  // languages glue the preposition to the name ("en Haïti", "au Québec").
  const region = metro.region || '';
  const place =
    scope === 'country'
      ? countryIn(t, metro.country)
      : translateOrNull(t, `regionsIn.${region}`) ||
        translateOrNull(t, `regions.${region}`) ||
        REGION_LABELS[region] ||
        metro.label;

  return (
    <View style={[styles.wrap, { borderTopColor: colors.border }]}>
      <EventRail
        title={t('discover.elsewhere.title', { place })}
        events={events.slice(0, limit)}
        onEventPress={onEventPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // A rule and real air above it: this content is NOT from where you are, and
  // the layout has to say so before the label does.
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    paddingTop: 28,
  },
});
