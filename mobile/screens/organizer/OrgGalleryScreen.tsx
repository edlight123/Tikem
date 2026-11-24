/**
 * Photos on the organization's page: up to 12, added from the library,
 * removed or reordered from each photo's menu. Saves as you go through
 * /api/organizer/settings/gallery (lib/orgPage.ts), which checks the caller
 * is the org's owner or a team admin and stores the files under
 * org-pages/{orgId}/. The public page shows them as a strip (GalleryStrip).
 *
 * Params: { orgId } (defaults to the signed-in owner's own org).
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { ImagePlus, Images, MoreHorizontal } from 'lucide-react-native';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import EmptyState from '../../components/EmptyState';
import WhitePillCTA from '../../components/WhitePillCTA';
import { Skeleton } from '../../components/Skeleton';
import { Touchable } from '../../components/ui/Touchable';
import { useAppAlert } from '../../components/AppAlert';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { useTheme } from '../../contexts/ThemeContext';
import { AFTER_ALERT_MS } from '../../lib/moderationActions';
import { colors as T, radius, spacing } from '../../theme/tokens';
import {
  MAX_GALLERY_PHOTOS,
  OrgPageError,
  availableMoves,
  fetchOrgGallery,
  moveGalleryPhoto,
  pickOrgPagePhotos,
  saveOrgGallery,
  uploadOrgGalleryPhoto,
  type GalleryMove,
  type GalleryPhoto,
} from '../../lib/orgPage';

const MOVE_KEY: Record<GalleryMove, string> = {
  first: 'orgPage.moveFirst',
  up: 'orgPage.moveUp',
  down: 'orgPage.moveDown',
  last: 'orgPage.moveLast',
};

export default function OrgGalleryScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { t } = useI18n();
  const showAlert = useAppAlert();
  const { user } = useAuth();
  const orgId: string = route?.params?.orgId || user?.uid || '';
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const { width } = useWindowDimensions();
  const tileW = Math.floor((width - spacing.lg * 2 - 8) / 2);

  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const fail = useCallback(
    (e: unknown) => {
      const key = e instanceof OrgPageError ? e.key : 'orgPage.errors.saveFailed';
      showAlert(t('orgPage.errors.title'), t(key));
    },
    [showAlert, t]
  );

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      setPhotos(await fetchOrgGallery(orgId));
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fail, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if (busy) return;
    const room = MAX_GALLERY_PHOTOS - photos.length;
    if (room <= 0) return;
    let assets: Awaited<ReturnType<typeof pickOrgPagePhotos>> = [];
    try {
      assets = await pickOrgPagePhotos(room);
    } catch (e) {
      fail(e);
      return;
    }
    if (!assets.length) return;
    setBusy(true);
    setProgress({ done: 0, total: assets.length });
    try {
      for (let i = 0; i < assets.length; i++) {
        setPhotos(await uploadOrgGalleryPhoto(orgId, assets[i]));
        setProgress({ done: i + 1, total: assets.length });
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const save = async (next: GalleryPhoto[]) => {
    const before = photos;
    setPhotos(next);
    setBusy(true);
    try {
      setPhotos(await saveOrgGallery(orgId, next));
    } catch (e) {
      setPhotos(before);
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const openMenu = (index: number) => {
    const moves = availableMoves(index, photos.length);
    showAlert(t('orgPage.photoMenuTitle', { n: index + 1 }), undefined, [
      ...moves.map((move) => ({
        text: t(MOVE_KEY[move]),
        onPress: () => save(moveGalleryPhoto(photos, index, move)),
      })),
      {
        text: t('orgPage.removePhoto'),
        style: 'destructive' as const,
        onPress: () =>
          setTimeout(
            () =>
              showAlert(t('orgPage.removePhotoTitle'), undefined, [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('orgPage.removePhoto'), style: 'destructive', onPress: () => save(photos.filter((_, j) => j !== index)) },
              ]),
            AFTER_ALERT_MS
          ),
      },
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  };

  const full = photos.length >= MAX_GALLERY_PHOTOS;

  return (
    <View style={styles.container}>
      <OrganizerScreenHeader
        title={t('orgPage.photosTitle')}
        subtitle={loading ? undefined : t('orgPage.photosCount', { n: photos.length, max: MAX_GALLERY_PHOTOS })}
        onBack={() => navigation.goBack()}
        overlay
        onHeight={onHeight}
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: headerH + 16 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            progressViewOffset={headerH}
          />
        }
      >
        {loading ? (
          <View style={styles.grid}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} width={tileW} height={Math.round((tileW * 3) / 4)} radius={radius.sm} />
            ))}
          </View>
        ) : photos.length === 0 ? (
          <EmptyState
            variant="panel"
            icon={Images}
            title={t('orgPage.photosEmptyTitle')}
            subtitle={t('orgPage.photosEmptyLine')}
            actionLabel={busy ? undefined : t('orgPage.addPhotos')}
            onAction={add}
          />
        ) : (
          <>
            <View style={styles.grid}>
              {photos.map((p, i) => (
                <View key={p.url} style={{ width: tileW }}>
                  <Image
                    source={{ uri: p.url }}
                    style={[styles.photo, { width: tileW, height: Math.round((tileW * 3) / 4) }]}
                    contentFit="cover"
                    transition={150}
                  />
                  <View style={styles.index} pointerEvents="none">
                    <Text style={styles.indexText}>{i + 1}</Text>
                  </View>
                  <Touchable
                    style={styles.menuBtn}
                    onPress={() => openMenu(i)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={t('orgPage.photoMenuTitle', { n: i + 1 })}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <MoreHorizontal size={16} color={T.white} />
                  </Touchable>
                </View>
              ))}
            </View>
            <WhitePillCTA
              size="sm"
              label={full ? t('orgPage.photosFull') : t('orgPage.addPhotos')}
              icon={<ImagePlus size={16} color={T.onWhite} />}
              onPress={add}
              disabled={busy || full}
              style={styles.addBtn}
            />
          </>
        )}
        {progress ? (
          <View style={styles.progress}>
            <ActivityIndicator color={colors.textSecondary} />
            <Text style={styles.progressText}>{t('orgPage.uploading', { done: progress.done, total: progress.total })}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: spacing.lg, paddingBottom: 48 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    photo: { borderRadius: radius.sm, backgroundColor: T.surface },
    index: {
      position: 'absolute',
      left: 6,
      top: 6,
      minWidth: 22,
      paddingHorizontal: 6,
      height: 22,
      borderRadius: radius.sm,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    indexText: { fontSize: 12, fontWeight: '600', color: T.white, fontVariant: ['tabular-nums'] },
    menuBtn: {
      position: 'absolute',
      right: 6,
      top: 6,
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    addBtn: { marginTop: 20, alignSelf: 'flex-start' },
    progress: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
    progressText: { fontSize: 13, color: colors.textSecondary },
  });
