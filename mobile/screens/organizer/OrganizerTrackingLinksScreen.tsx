// Per-event UTM tracking links, mirroring the web's tracking page
// (app/organizer/events/[id]/tracking). Like the web, nothing is stored on the
// server: there is no tracking-links collection and no click or sale counter
// keyed on utm_* anywhere in the backend. The web keeps links in page memory
// only; here they are kept per event on this device (AsyncStorage) so they
// survive leaving the screen.

import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link2, Plus, Share2, Trash2 } from 'lucide-react-native';
import { useAppAlert } from '../../components/AppAlert';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { Skeleton } from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import SectionHeader from '../../components/SectionHeader';
import WhitePillCTA from '../../components/WhitePillCTA';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import InfoNotice from '../../components/organizer/InfoNotice';
import FormSheet, { SheetInput, SheetLabel } from '../../components/organizer/FormSheet';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import { getEventById } from '../../lib/api/organizer';
import {
  TrackingLink,
  buildTrackingUrl,
  eventPageUrl,
  parseStoredLinks,
  trackingStorageKey,
} from '../../lib/trackingLinks';
import { colors as T, font, radius, spacing } from '../../theme/tokens';

type RouteParams = {
  OrganizerTrackingLinks: {
    eventId: string;
  };
};

// Channels organizers in Haiti actually post to. A tap fills `source`; the
// field stays free text for anything else.
const QUICK_SOURCES = ['whatsapp', 'instagram', 'facebook', 'tiktok', 'flyer'];

export default function OrganizerTrackingLinksScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const route = useRoute<RouteProp<RouteParams, 'OrganizerTrackingLinks'>>();
  const navigation = useNavigation<any>();
  const { eventId } = route.params;
  const insets = useSafeAreaInsets();
  const { height: headerH, onHeight } = useOverlayHeaderInset();

  const { t } = useI18n();
  const showAlert = useAppAlert();

  const [eventTitle, setEventTitle] = useState('');
  const [links, setLinks] = useState<TrackingLink[]>([]);
  const [loading, setLoading] = useState(true);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [source, setSource] = useState('');
  const [medium, setMedium] = useState('link');
  const [campaign, setCampaign] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const baseUrl = eventPageUrl(eventId);
  const previewUrl = buildTrackingUrl(baseUrl, source, medium, campaign);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [event, raw] = await Promise.all([
        getEventById(eventId).catch(() => null),
        AsyncStorage.getItem(trackingStorageKey(eventId)).catch(() => null),
      ]);
      if (cancelled) return;
      setEventTitle(event?.title || '');
      setLinks(parseStoredLinks(raw));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const persist = useCallback(
    (next: TrackingLink[]) => {
      setLinks(next);
      AsyncStorage.setItem(trackingStorageKey(eventId), JSON.stringify(next)).catch(() => undefined);
    },
    [eventId]
  );

  const openSheet = () => {
    setLabel('');
    setSource('');
    setMedium('link');
    setCampaign('');
    setFormError(null);
    setSheetOpen(true);
  };

  const handleCreate = () => {
    if (!label.trim()) {
      setFormError(t('organizerTracking.errors.labelRequired'));
      return;
    }
    if (!source.trim()) {
      setFormError(t('organizerTracking.errors.sourceRequired'));
      return;
    }
    const link: TrackingLink = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      label: label.trim(),
      source: source.trim(),
      medium: medium.trim(),
      campaign: campaign.trim(),
      url: buildTrackingUrl(baseUrl, source, medium, campaign),
      createdAt: Date.now(),
    };
    persist([link, ...links]);
    setSheetOpen(false);
  };

  // The system share sheet carries "Copy" on both platforms, so one action
  // covers copy and send without a native clipboard module.
  const handleShare = async (link: TrackingLink) => {
    try {
      await Share.share({
        message: `${eventTitle || t('common.event')}\n\n${link.url}`,
      });
    } catch {
      // Dismissed / unavailable — nothing to surface.
    }
  };

  const handleRemove = (link: TrackingLink) => {
    showAlert(t('organizerTracking.delete.title'), t('organizerTracking.delete.message'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('organizerTracking.delete.confirm'),
        style: 'destructive',
        onPress: () => persist(links.filter((l) => l.id !== link.id)),
      },
    ]);
  };

  const header = (
    <OrganizerScreenHeader
      title={t('organizerTracking.title')}
      subtitle={eventTitle || undefined}
      onBack={() => navigation.goBack()}
      overlay
      onHeight={onHeight}
    />
  );

  if (loading) {
    return (
      <View style={styles.container}>
        {header}
        <View style={{ paddingTop: headerH + spacing.lg, paddingHorizontal: spacing.lg }}>
          <Skeleton width="100%" height={40} radius={radius.md} />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={112} radius={radius.lg} style={{ marginTop: spacing.md }} />
          ))}
        </View>
      </View>
    );
  }

  const hasLinks = links.length > 0;

  return (
    <View style={styles.container}>
      {header}

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: headerH + spacing.lg, paddingBottom: insets.bottom + (hasLinks ? 112 : 32) },
        ]}
      >
        <InfoNotice text={t('organizerTracking.infoNotice')} />

        {!hasLinks ? (
          <EmptyState
            icon={Link2}
            title={t('organizerTracking.empty')}
            subtitle={t('organizerTracking.emptySubtitle')}
            actionLabel={t('organizerTracking.newLink')}
            onAction={openSheet}
          />
        ) : (
          <View style={styles.section}>
            <SectionHeader title={t('organizerTracking.listTitle')} />
            {links.map((link) => (
              <View key={link.id} style={styles.linkCard}>
                <View style={styles.linkTop}>
                  <View style={styles.linkIcon}>
                    <Link2 size={18} color={colors.textSecondary} />
                  </View>
                  <View style={styles.linkBody}>
                    <Text style={styles.linkLabel} numberOfLines={1}>
                      {link.label}
                    </Text>
                    <Text style={styles.linkTags} numberOfLines={1}>
                      {[link.source, link.medium, link.campaign].filter(Boolean).join('  ·  ')}
                    </Text>
                  </View>
                </View>

                <View style={styles.urlWell}>
                  <Text style={styles.urlText} numberOfLines={2} selectable>
                    {link.url}
                  </Text>
                </View>

                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleShare(link)}
                    accessibilityRole="button"
                    accessibilityLabel={t('organizerTracking.shareA11y', { label: link.label })}
                  >
                    <Share2 size={15} color={colors.text} />
                    <Text style={styles.actionText}>{t('organizerTracking.share')}</Text>
                  </TouchableOpacity>
                  <View style={{ flex: 1 }} />
                  <TouchableOpacity
                    style={styles.iconButton}
                    onPress={() => handleRemove(link)}
                    accessibilityRole="button"
                    accessibilityLabel={t('organizerTracking.removeA11y', { label: link.label })}
                  >
                    <Trash2 size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {hasLinks && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <WhitePillCTA
            label={t('organizerTracking.newLink')}
            icon={<Plus size={18} color={T.onWhite} strokeWidth={2.5} />}
            onPress={openSheet}
          />
        </View>
      )}

      <FormSheet
        visible={sheetOpen}
        title={t('organizerTracking.sheet.title')}
        onClose={() => setSheetOpen(false)}
        closeLabel={t('common.cancel')}
        footer={
          <>
            {!!formError && <Text style={styles.errorText}>{formError}</Text>}
            <WhitePillCTA label={t('organizerTracking.sheet.create')} onPress={handleCreate} />
          </>
        }
      >
        <SheetLabel>{t('organizerTracking.sheet.label')}</SheetLabel>
        <SheetInput
          value={label}
          onChangeText={setLabel}
          placeholder={t('organizerTracking.sheet.labelPlaceholder')}
        />

        <SheetLabel>{t('organizerTracking.sheet.source')}</SheetLabel>
        <View style={styles.chipRow}>
          {QUICK_SOURCES.map((s) => {
            const selected = source.trim().toLowerCase() === s;
            return (
              <TouchableOpacity
                key={s}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => setSource(s)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{s}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <SheetInput
          value={source}
          onChangeText={setSource}
          placeholder={t('organizerTracking.sheet.sourcePlaceholder')}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ marginTop: spacing.sm }}
        />

        <View style={styles.twoCol}>
          <View style={styles.col}>
            <SheetLabel>{t('organizerTracking.sheet.medium')}</SheetLabel>
            <SheetInput
              value={medium}
              onChangeText={setMedium}
              placeholder={t('organizerTracking.sheet.mediumPlaceholder')}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View style={styles.col}>
            <SheetLabel>{t('organizerTracking.sheet.campaign')}</SheetLabel>
            <SheetInput
              value={campaign}
              onChangeText={setCampaign}
              placeholder={t('organizerTracking.sheet.campaignPlaceholder')}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>

        <SheetLabel>{t('organizerTracking.sheet.preview')}</SheetLabel>
        <View style={styles.previewWell}>
          <Text style={styles.urlText} selectable>
            {previewUrl}
          </Text>
        </View>
      </FormSheet>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      paddingHorizontal: spacing.lg,
    },
    section: {
      marginTop: spacing.xl,
    },
    linkCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: 14,
      marginBottom: spacing.md,
    },
    linkTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    linkIcon: {
      width: 38,
      height: 38,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    linkBody: {
      flex: 1,
      minWidth: 0,
    },
    linkLabel: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    linkTags: {
      marginTop: 2,
      fontSize: 11,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      color: colors.textSecondary,
    },
    urlWell: {
      marginTop: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    previewWell: {
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    urlText: {
      fontFamily: font.monoRegular,
      fontSize: 12,
      lineHeight: 17,
      color: colors.textSecondary,
    },
    actionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: spacing.md,
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 36,
      paddingHorizontal: 14,
      borderRadius: radius.button,
      backgroundColor: colors.surfaceRaised,
    },
    actionText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
    iconButton: {
      width: 36,
      height: 36,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    footer: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      backgroundColor: colors.background,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.chip,
      backgroundColor: colors.surfaceRaised,
    },
    chipSelected: {
      backgroundColor: T.white,
    },
    chipText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    chipTextSelected: {
      color: T.onWhite,
    },
    twoCol: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    col: {
      flex: 1,
    },
    errorText: {
      color: colors.error,
      fontSize: 13,
      textAlign: 'center',
    },
  });
