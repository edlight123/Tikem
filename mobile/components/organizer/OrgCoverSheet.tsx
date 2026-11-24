/**
 * The organization page's banner: pick one of our photos (the same world
 * photos as the website), upload your own, or have none. Saves at once
 * through /api/organizer/settings/cover (lib/orgPage.ts), which checks the
 * caller is the org's owner or a team admin.
 *
 * Layout (TestFlight 2026-11-24, "not premium"): a live preview of the page's
 * top (banner, overlapping logo, name) as visitors will see it, then the
 * templates as a strip of large 3:2 tiles with a quiet check on the one in
 * use, then the 40pt white Upload pill and, only when a banner is set, a
 * Remove text link. No empty "No banner" box: with none, the preview shows
 * the page's own default band (OrgHeroBackdrop).
 */
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Check, Upload } from 'lucide-react-native';
import FormSheet from './FormSheet';
import OrgHeroBackdrop from './OrgHeroBackdrop';
import OrgMark from '../OrgMark';
import WhitePillCTA from '../WhitePillCTA';
import { useAppAlert } from '../AppAlert';
import { useI18n } from '../../contexts/I18nContext';
import { useTheme } from '../../contexts/ThemeContext';
import { colors as T, font, radius } from '../../theme/tokens';
import {
  COVER_TEMPLATES,
  COVER_TEMPLATE_SOURCES,
  OrgPageError,
  pickOrgPagePhotos,
  saveOrgCoverTemplate,
  uploadOrgCover,
  type CoverTemplate,
  type OrgCoverState,
} from '../../lib/orgPage';

export default function OrgCoverSheet({
  visible,
  orgId,
  current,
  onClose,
  onChanged,
  orgName,
  logoUri,
  posterUri,
}: {
  visible: boolean;
  orgId: string;
  current: OrgCoverState;
  onClose: () => void;
  onChanged: (next: OrgCoverState) => void;
  /** For the live preview: the page's name, logo and newest poster. */
  orgName?: string;
  logoUri?: string | null;
  posterUri?: string | null;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { t } = useI18n();
  const showAlert = useAppAlert();
  const [busy, setBusy] = useState(false);

  const fail = (e: unknown) => {
    const key = e instanceof OrgPageError ? e.key : 'orgPage.errors.saveFailed';
    showAlert(t('orgPage.errors.title'), t(key));
  };

  const pick = async (key: CoverTemplate | null) => {
    if (busy) return;
    setBusy(true);
    try {
      onChanged(await saveOrgCoverTemplate(orgId, key));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    if (busy) return;
    try {
      const [asset] = await pickOrgPagePhotos(1);
      if (!asset) return;
      setBusy(true);
      onChanged(await uploadOrgCover(orgId, asset));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const preview = current.coverTemplate
    ? COVER_TEMPLATE_SOURCES[current.coverTemplate]
    : current.coverImageUrl
      ? { uri: current.coverImageUrl }
      : null;

  return (
    <FormSheet
      visible={visible}
      title={t('orgPage.bannerTitle')}
      onClose={onClose}
      closeLabel={t('common.close')}
      busy={busy}
      footer={
        <>
          <WhitePillCTA
            size="sm"
            label={t('orgPage.uploadBanner')}
            icon={<Upload size={16} color={T.onWhite} />}
            onPress={upload}
            disabled={busy}
          />
          {preview ? (
            <TouchableOpacity
              onPress={() => pick(null)}
              disabled={busy}
              style={styles.removeRow}
              hitSlop={{ top: 6, bottom: 6, left: 12, right: 12 }}
              accessibilityRole="button"
            >
              <Text style={styles.removeText}>{t('orgPage.removeBanner')}</Text>
            </TouchableOpacity>
          ) : null}
        </>
      }
    >
      {/* Live preview: the top of the page as visitors will see it. */}
      <View style={styles.preview}>
        <View style={styles.previewBand}>
          <OrgHeroBackdrop
            coverSource={preview}
            posterUri={posterUri}
            name={orgName}
            monogramSize={110}
            fadeTo={colors.surface}
          />
          {busy ? (
            <View style={styles.busy}>
              <ActivityIndicator color={T.white} />
            </View>
          ) : null}
        </View>
        <View style={styles.previewIdentity}>
          <View style={styles.previewLogo}>
            {logoUri ? (
              <Image source={{ uri: logoUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <OrgMark size={22} color={T.black} />
            )}
          </View>
          {orgName ? (
            <Text style={styles.previewName} numberOfLines={1}>
              {orgName}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Templates: one strip of large tiles, scrolled sideways. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.stripBleed}
        contentContainerStyle={styles.strip}
      >
        {COVER_TEMPLATES.map((key, i) => {
          const selected = current.coverTemplate === key;
          return (
            <TouchableOpacity
              key={key}
              activeOpacity={0.85}
              onPress={() => pick(key)}
              disabled={busy}
              style={styles.tile}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={t('orgPage.templateLabel', { n: i + 1 })}
            >
              <Image source={COVER_TEMPLATE_SOURCES[key]} style={StyleSheet.absoluteFill} contentFit="cover" />
              {selected ? (
                <View style={styles.selected}>
                  <Check size={14} color={T.onWhite} strokeWidth={2.8} />
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </FormSheet>
  );
}

const PREVIEW_BAND_H = 112;
const PREVIEW_LOGO = 44;
const TILE_W = 148;

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    preview: { marginTop: 12 },
    previewBand: {
      height: PREVIEW_BAND_H,
      borderRadius: radius.sm,
      overflow: 'hidden',
      backgroundColor: T.surfaceRaised,
    },
    previewIdentity: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 10,
      paddingHorizontal: 12,
      marginTop: -PREVIEW_LOGO / 2,
    },
    previewLogo: {
      width: PREVIEW_LOGO,
      height: PREVIEW_LOGO,
      borderRadius: radius.sm,
      borderWidth: 2,
      borderColor: colors.surface,
      backgroundColor: T.white,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    previewName: {
      flex: 1,
      fontFamily: font.serif,
      fontSize: 20,
      lineHeight: 24,
      color: colors.text,
      paddingBottom: 2,
    },
    busy: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The strip runs to the sheet's edges (the sheet has 16pt padding).
    stripBleed: { marginTop: 20, marginHorizontal: -16 },
    strip: { gap: 8, paddingHorizontal: 16 },
    tile: {
      width: TILE_W,
      height: Math.round((TILE_W * 2) / 3),
      borderRadius: radius.sm,
      overflow: 'hidden',
      backgroundColor: T.surfaceRaised,
    },
    // The quiet check: a small white disc on the tile in use.
    selected: {
      position: 'absolute',
      right: 6,
      bottom: 6,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: T.white,
      alignItems: 'center',
      justifyContent: 'center',
    },
    removeRow: { alignSelf: 'center', paddingVertical: 4 },
    removeText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  });
