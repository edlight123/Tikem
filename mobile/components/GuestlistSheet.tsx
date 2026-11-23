import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Animated,
} from 'react-native';
import { useSwipeToClose } from '../hooks/useSwipeToClose';
import { Image } from 'expo-image';
import { Camera, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { goingCountKey } from '../lib/whosGoingLine';
import { useAppAlert } from './AppAlert';
import { colors as T, font, radius } from '../theme/tokens';
import { fetchEventGuestlist } from '../lib/api/social';
import { pickProfileImage, ProfileImageError, uploadProfileImage } from '../lib/profileImages';
import { defaultAvatar, defaultAvatarAt, defaultAvatarIndex, DEFAULT_AVATAR_COUNT } from '../lib/defaultAvatar';
import type { PublicUserSummary } from '../types/social';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * "View" on the guestlist card. Two faces of one sheet:
 *
 *  - gate: the viewer shows no photo. Posh's rule, ours too: show your face to
 *    see theirs. The faces going sit blurred behind the viewer's own empty
 *    portrait; "Add a photo" picks and uploads right here, and the sheet turns
 *    into the list without ever leaving the event.
 *  - list: everyone who lets themselves be seen, friends first, the viewer on
 *    top, and one quiet line for the rest who keep it private.
 *
 * The photo is picked straight from the library rather than through the
 * Take/Choose alert: that alert is a modal of its own, and a modal opened over
 * this one is dropped on iOS (the dead-button pattern).
 */
interface Props {
  visible: boolean;
  onClose: () => void;
  eventId: string;
  /** Faces already on the card: the blurred crowd behind the gate. */
  previewFaces: PublicUserSummary[];
  totalGoing: number;
  /** Count rule (shouldShowGoingCount): print the number only past half full. */
  showCount: boolean;
  /** Called after the sheet has closed, so navigation is never under a modal. */
  onOpenProfile: (uid: string) => void;
}

export default function GuestlistSheet({
  visible,
  onClose,
  eventId,
  previewFaces,
  totalGoing,
  showCount,
  onOpenProfile,
}: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const swipe = useSwipeToClose(onClose, visible);
  const showAlert = useAppAlert();
  const { user, userProfile, updateUserProfile } = useAuth();
  const hasPhoto = !!userProfile?.photo_url;

  const [mode, setMode] = useState<'gate' | 'list'>(hasPhoto ? 'list' : 'gate');
  const [uploading, setUploading] = useState(false);
  const [list, setList] = useState<{ friends: PublicUserSummary[]; others: PublicUserSummary[]; viewerIsGoing: boolean; total: number } | null>(null);
  const [loading, setLoading] = useState(false);

  // Re-decide every time it opens: the photo may have been added elsewhere.
  useEffect(() => {
    if (visible) setMode(hasPhoto ? 'list' : 'gate');
  }, [visible, hasPhoto]);

  useEffect(() => {
    if (!visible || mode !== 'list') return;
    let live = true;
    setLoading(true);
    fetchEventGuestlist(eventId)
      .then((d) => {
        if (!live) return;
        if (d.needsPhoto) {
          setMode('gate');
          return;
        }
        // An account with no name is listed by the server as "Tikèm user"; a
        // column of those reads as filler, so they count with the rest below.
        const named = (u: PublicUserSummary) => !!u.displayName?.trim() && u.displayName !== 'Tikèm user';
        // Real faces lead: a stable sort keeps the server's order within each
        // half, so the list opens on photos and the silhouettes trail.
        const facesFirst = (a: PublicUserSummary, b: PublicUserSummary) => Number(!!b.photoURL) - Number(!!a.photoURL);
        setList({
          friends: d.friendsGoing.filter(named).sort(facesFirst),
          others: d.publicGoing.filter(named).sort(facesFirst),
          viewerIsGoing: d.viewerIsGoing,
          total: d.totalGoing,
        });
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [visible, mode, eventId]);

  const addPhoto = async () => {
    if (!user?.uid || uploading) return;
    try {
      const asset = await pickProfileImage('library');
      if (!asset) return;
      setUploading(true);
      const url = await uploadProfileImage(user.uid, asset, 'avatar');
      await updateUserProfile({ photo_url: url });
      setMode('list');
    } catch (e: any) {
      const key = e instanceof ProfileImageError ? e.key : null;
      showAlert(t('common.error'), key ? t(key) : e?.message || t('profile.uploads.photoUploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const openProfile = (uid: string) => {
    onClose();
    // After the slide-out: a navigate under a closing Modal is dropped.
    setTimeout(() => onOpenProfile(uid), 350);
  };

  const viewerSeed = String(user?.uid || 'me');

  // Faces behind the gate: real ones first, unnamed portraits to fill four.
  const crowd = previewFaces.slice(0, 4).map((u) => (u.photoURL ? { uri: u.photoURL } : defaultAvatar(String(u.uid))));
  const base = defaultAvatarIndex(eventId);
  while (crowd.length < 4) crowd.push(defaultAvatarAt((base + crowd.length * 5) % DEFAULT_AVATAR_COUNT));

  const shown = list ? list.friends.length + list.others.length + (list.viewerIsGoing ? 1 : 0) : 0;
  const hidden = list ? Math.max(0, list.total - shown) : 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')}>
        {/* Swallow taps on the sheet itself so they do not close it. */}
        <AnimatedPressable style={[styles.sheet, swipe.sheetStyle, { paddingBottom: insets.bottom + 20 }, mode === 'list' && styles.sheetTall]} onPress={() => {}}>
          {/* The grabber is tiny, so its slop widens the drag target; the stage
              (gate) and the title (list) drag too. */}
          <View style={styles.grabber} hitSlop={{ top: 12, bottom: 16, left: 80, right: 80 }} {...swipe.panHandlers} />
          <TouchableOpacity onPress={onClose} style={styles.close} hitSlop={10} accessibilityLabel={t('common.close')}>
            <X size={20} color={T.textSecondary ?? '#A3A3A3'} />
          </TouchableOpacity>

          {mode === 'gate' ? (
            <View style={styles.gate}>
              <View style={styles.stage} {...swipe.panHandlers}>
                {/* The crowd: two faces either side, blurred and stepped back. */}
                {crowd.map((src, i) => {
                  const left = i < 2;
                  const near = i % 2 === 0;
                  return (
                    <Image
                      key={i}
                      source={src}
                      blurRadius={14}
                      contentFit="cover"
                      style={[
                        styles.crowdFace,
                        near ? styles.crowdNear : styles.crowdFar,
                        left
                          ? { right: '50%', marginRight: near ? 34 : 86 }
                          : { left: '50%', marginLeft: near ? 34 : 86 },
                      ]}
                    />
                  );
                })}
                <View style={styles.me}>
                  <Image source={defaultAvatar(viewerSeed)} style={styles.meImg} contentFit="cover" />
                  <View style={styles.badge}>
                    {uploading ? <ActivityIndicator size="small" color="#000" /> : <Camera size={16} color="#000" />}
                  </View>
                </View>
              </View>

              <Text style={styles.gateTitle}>{t('whosGoing.gateTitle')}</Text>
              <Text style={styles.gateSub}>{t('whosGoing.gateSub')}</Text>

              <TouchableOpacity style={styles.primary} onPress={addPhoto} activeOpacity={0.85} disabled={uploading}>
                {uploading ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryText}>{t('whosGoing.addPhoto')}</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={onClose} hitSlop={6}>
                <Text style={styles.secondaryText}>{t('whosGoing.notNow')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <View {...swipe.panHandlers}>
                <Text style={styles.listTitle}>{t('whosGoing.listTitle')}</Text>
                {showCount && <Text style={styles.listSub}>{t(goingCountKey(totalGoing), { count: totalGoing })}</Text>}
              </View>

              {loading || !list ? (
                <ActivityIndicator style={{ marginTop: 40 }} color={T.textSecondary ?? '#A3A3A3'} />
              ) : (
                <ScrollView style={{ marginTop: 12 }} showsVerticalScrollIndicator={false}>
                  {list.viewerIsGoing && (
                    <View style={styles.row}>
                      <Image
                        source={userProfile?.photo_url ? { uri: userProfile.photo_url } : defaultAvatar(viewerSeed)}
                        style={styles.rowAvatar}
                        contentFit="cover"
                      />
                      <View style={styles.rowText}>
                        <Text style={styles.rowName} numberOfLines={1}>
                          {userProfile?.full_name || t('whosGoing.youBadge')}
                        </Text>
                        <Text style={styles.rowMeta}>{t('whosGoing.youBadge')}</Text>
                      </View>
                    </View>
                  )}
                  {[...list.friends.map((u) => ({ u, friend: true })), ...list.others.map((u) => ({ u, friend: false }))]
                    // Photos first across friends and the rest; friends still lead within each.
                    .sort((a, b) => Number(!!b.u.photoURL) - Number(!!a.u.photoURL))
                    .map(
                    ({ u, friend }) => (
                      <TouchableOpacity key={u.uid} style={styles.row} onPress={() => openProfile(u.uid)} activeOpacity={0.7}>
                        <Image
                          source={u.photoURL ? { uri: u.photoURL } : defaultAvatar(String(u.uid))}
                          style={styles.rowAvatar}
                          contentFit="cover"
                          recyclingKey={String(u.uid)}
                        />
                        <View style={styles.rowText}>
                          <Text style={styles.rowName} numberOfLines={1}>
                            {u.displayName}
                          </Text>
                          {friend && <Text style={styles.rowMeta}>{t('whosGoing.friend')}</Text>}
                        </View>
                      </TouchableOpacity>
                    ),
                  )}
                  {hidden > 0 && (
                    <View style={styles.row}>
                      <View style={[styles.rowAvatar, styles.hiddenDot]}>
                        <Image source={defaultAvatarAt(base % DEFAULT_AVATAR_COUNT)} style={styles.rowAvatar} contentFit="cover" />
                      </View>
                      <View style={styles.rowText}>
                        {/* With the number held back, one line; with it, the count leads. */}
                        <Text style={styles.rowMetaStrong}>
                          {showCount ? t('whosGoing.moreGuests', { count: hidden }) : t('whosGoing.morePrivate')}
                        </Text>
                        {showCount && <Text style={styles.rowMeta}>{t('whosGoing.morePrivate')}</Text>}
                      </View>
                    </View>
                  )}
                  {shown === 0 && hidden === 0 && <Text style={styles.rowMeta}>{t('whosGoing.noFaces')}</Text>}
                </ScrollView>
              )}
            </View>
          )}
        </AnimatedPressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: T.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: 24,
    paddingTop: 10,
  },
  sheetTall: { height: '78%' },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  close: { position: 'absolute', right: 18, top: 18, zIndex: 2 },

  gate: { alignItems: 'center', paddingTop: 28 },
  stage: { width: '100%', height: 132, alignItems: 'center', justifyContent: 'center' },
  crowdFace: { position: 'absolute', borderRadius: 999 },
  crowdNear: { width: 64, height: 64, opacity: 0.75, top: 34 },
  crowdFar: { width: 48, height: 48, opacity: 0.4, top: 42 },
  me: { width: 112, height: 112 },
  meImg: { width: 112, height: 112, borderRadius: 56, borderWidth: 3, borderColor: T.surface },
  badge: {
    position: 'absolute',
    right: 2,
    bottom: 4,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: T.surface,
  },
  gateTitle: { fontFamily: font.serif, fontSize: 34, lineHeight: 40, color: '#FFFFFF', marginTop: 22, textAlign: 'center' },
  gateSub: { fontSize: 15, color: 'rgba(255,255,255,0.6)', marginTop: 6, textAlign: 'center' },
  primary: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: radius.button,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },
  primaryText: { color: '#000', fontSize: 15, fontWeight: '700' },
  secondary: { paddingVertical: 14, marginTop: 4 },
  secondaryText: { color: 'rgba(255,255,255,0.7)', fontSize: 15, fontWeight: '600' },

  listTitle: { fontFamily: font.serif, fontSize: 28, lineHeight: 34, color: '#FFFFFF', marginTop: 12 },
  listSub: { fontSize: 13, color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 56 },
  rowAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: T.surfaceRaised },
  hiddenDot: { overflow: 'hidden', opacity: 0.6 },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 15, lineHeight: 19, fontWeight: '600', color: '#FFFFFF' },
  rowMeta: { fontSize: 13, lineHeight: 17, color: 'rgba(255,255,255,0.5)', marginTop: 1 },
  rowMetaStrong: { fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
});
