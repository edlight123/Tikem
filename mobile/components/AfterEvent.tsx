/**
 * On an event page once it is over (the post-event loop), the app's twin of
 * the website's components/events/AfterEvent: "How was it?" for people who
 * were checked in (opens the rating sheet), the photos people who went added
 * (moderated: the organizer side approves or removes them right here), "Add
 * your photos", and the organizer's next event with Follow.
 * Reads /api/events/[id]/photos; photos upload to that route as multipart.
 * Ported from Tikra (f832197a), adapted to Tikèm's design (4px, fills, quiet).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Camera, Check, ChevronRight, Trash2 } from 'lucide-react-native';

import FollowButton from './FollowButton';
import SectionHeader from './SectionHeader';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { backendFetch } from '../lib/api/backend';
import { localeForLanguage } from '../lib/format';
import { pickProfileImage } from '../lib/profileImages';
import { formatEventDateTime } from '../lib/eventClock';
import { colors as T } from '../theme/tokens';

type Photo = { id: string; url: string; caption: string | null; user_name?: string };
type NextEvent = {
  id: string;
  title: string;
  start_datetime: string | null;
  banner_image_url: string | null;
  venue_name: string;
  city: string;
  country: string | null;
  timezone: string | null;
};
type Data = {
  photos: Photo[];
  pending: Photo[];
  canAdd: boolean;
  isManager: boolean;
  mine: number;
  maxPerPerson?: number;
  nextEvent: NextEvent | null;
};

export default function AfterEvent({
  eventId,
  organizerId,
  organizerName,
  onEvent,
  onRate,
}: {
  eventId: string;
  /** Null for the organizer's own event (no "follow yourself"). */
  organizerId: string | null;
  organizerName: string;
  onEvent: (eventId: string) => void;
  onRate: () => void;
}) {
  const { user } = useAuth();
  const { t, language } = useI18n();
  const [data, setData] = useState<Data | null>(null);
  const [canRate, setCanRate] = useState(false);
  const [rated, setRated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    backendFetch(`/api/events/${encodeURIComponent(eventId)}/photos`, { method: 'GET' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d))
      .catch(() => {});
  }, [eventId]);

  useEffect(() => {
    load();
    if (!user?.uid) return;
    backendFetch(`/api/events/${encodeURIComponent(eventId)}/feedback`, { method: 'GET' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setCanRate(!!d.canRate);
        setRated(!!d.feedback?.rating);
      })
      .catch(() => {});
  }, [eventId, user?.uid, load]);

  const addPhoto = async () => {
    if (!user?.uid || busy) return;
    setNote('');
    try {
      const asset = await pickProfileImage('library', { osEditor: false });
      if (!asset) return;
      setBusy(true);
      const type = asset.mimeType || 'image/jpeg';
      const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
      const form = new FormData();
      form.append('file', { uri: asset.uri, name: `photo.${ext}`, type } as any);
      const res = await backendFetch(`/api/events/${encodeURIComponent(eventId)}/photos`, { method: 'POST', body: form as any });
      const d: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote(d?.code === 'too_large' ? t('afterEvent.photoTooLarge') : t('afterEvent.photoFailed'));
        return;
      }
      setNote(d?.status === 'approved' ? '' : t('afterEvent.photoAdded'));
      load();
    } catch {
      setNote(t('afterEvent.photoFailed'));
    } finally {
      setBusy(false);
    }
  };

  const review = async (photoId: string, status: 'approved' | 'rejected') => {
    await backendFetch(`/api/events/${encodeURIComponent(eventId)}/photos`, {
      method: 'PATCH',
      body: JSON.stringify({ photoId, status }),
    }).catch(() => {});
    load();
  };

  const next = data?.nextEvent;
  const max = data?.maxPerPerson ?? 6;
  const showPhotos = !!data && (data.photos.length > 0 || data.canAdd || data.pending.length > 0);
  if (!canRate && !showPhotos && !organizerId) return null;
  const nextDay = next?.start_datetime
    ? formatEventDateTime(next.start_datetime, next, localeForLanguage(language), { weekday: 'short', month: 'short', day: 'numeric' }, { weekday: 'short', month: 'short', day: 'numeric' })
    : '';

  return (
    <View style={styles.wrap}>
      {canRate && (
        <Pressable style={styles.row} onPress={onRate} accessibilityRole="button">
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.rowTitle}>{t('afterEvent.howWasIt')}</Text>
            <Text style={styles.sub}>{rated ? t('afterEvent.thanks') : t('afterEvent.howWasItBody')}</Text>
          </View>
          <ChevronRight size={18} color={T.textTertiary} strokeWidth={1.75} />
        </Pressable>
      )}

      {showPhotos && data && (
        <View style={{ marginTop: 24 }}>
          <SectionHeader
            title={t('afterEvent.photosTitle')}
            trailing={
              data.canAdd && data.mine < max ? (
                <Pressable onPress={addPhoto} disabled={busy} style={[styles.addBtn, busy && { opacity: 0.6 }]} accessibilityRole="button">
                  {busy ? <ActivityIndicator size="small" color={T.textPrimary} /> : <Camera size={15} color={T.textPrimary} strokeWidth={1.75} />}
                  <Text style={styles.addText}>{busy ? t('afterEvent.uploading') : t('afterEvent.addPhotos')}</Text>
                </Pressable>
              ) : undefined
            }
          />
          {note ? <Text style={styles.note}>{note}</Text> : null}
          {data.photos.length > 0 && (
            <View style={styles.grid}>
              {data.photos.map((p) => (
                <Image key={p.id} source={{ uri: p.url }} style={styles.photo} contentFit="cover" accessibilityLabel={p.caption || undefined} />
              ))}
            </View>
          )}
          {data.isManager && data.pending.length > 0 && (
            <View style={{ marginTop: 14 }}>
              <Text style={styles.pendingTitle}>{`${t('afterEvent.pendingTitle')} · ${data.pending.length}`}</Text>
              {data.pending.map((p) => (
                <View key={p.id} style={styles.pendingRow}>
                  <Image source={{ uri: p.url }} style={styles.pendingPhoto} contentFit="cover" />
                  <Text style={[styles.sub, { flex: 1 }]} numberOfLines={1}>{p.user_name || ''}</Text>
                  <Pressable onPress={() => review(p.id, 'approved')} style={styles.approve} accessibilityRole="button" accessibilityLabel={t('afterEvent.approve')}>
                    <Check size={16} color={T.onWhite} strokeWidth={2} />
                  </Pressable>
                  <Pressable onPress={() => review(p.id, 'rejected')} style={styles.reject} accessibilityRole="button" accessibilityLabel={t('afterEvent.remove')}>
                    <Trash2 size={16} color={T.textSecondary} strokeWidth={1.75} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {organizerId ? (
        <View style={{ marginTop: 24 }}>
          <SectionHeader title={organizerName ? t('afterEvent.nextFrom', { name: organizerName }) : t('afterEvent.nextFromThem')} />
          {next ? (
            <Pressable onPress={() => onEvent(next.id)} style={styles.nextRow} accessibilityRole="button">
              {next.banner_image_url ? (
                <Image source={{ uri: next.banner_image_url }} style={styles.nextPoster} contentFit="cover" />
              ) : (
                <View style={[styles.nextPoster, { backgroundColor: T.surfaceRaised }]} />
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.nextTitle} numberOfLines={2}>{next.title}</Text>
                <Text style={styles.sub} numberOfLines={1}>{[nextDay, next.venue_name || next.city].filter(Boolean).join(' · ')}</Text>
              </View>
            </Pressable>
          ) : (
            <Text style={styles.sub}>{t('afterEvent.followPrompt')}</Text>
          )}
          <FollowButton organizerId={organizerId} compact style={{ marginTop: 10, alignSelf: 'flex-start' }} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 4, backgroundColor: T.surface },
  rowTitle: { fontSize: 15, fontWeight: '600', color: T.textPrimary },
  sub: { marginTop: 2, fontSize: 13, color: T.textSecondary },
  note: { fontSize: 13, color: T.textSecondary, marginBottom: 8 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 32, borderRadius: 4, backgroundColor: T.surfaceRaised },
  addText: { fontSize: 13, fontWeight: '600', color: T.textPrimary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  photo: { width: '32.5%', aspectRatio: 1, borderRadius: 4, backgroundColor: T.surface },
  pendingTitle: { fontSize: 13, fontWeight: '600', color: T.textPrimary, marginBottom: 6 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  pendingPhoto: { width: 52, height: 52, borderRadius: 4 },
  approve: { width: 36, height: 36, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: T.white },
  reject: { width: 36, height: 36, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: T.surfaceRaised },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nextPoster: { width: 48, height: 60, borderRadius: 4 },
  nextTitle: { fontSize: 15, fontWeight: '600', color: T.textPrimary },
});
