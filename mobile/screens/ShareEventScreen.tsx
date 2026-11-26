/**
 * Share an event (web /share-event). A member sends a flyer they saw, with
 * whatever they know about it; an admin checks it and publishes it, credited
 * to the community (lib/community). Compact steps, one title, Send at the
 * bottom. The flyer is read on the website (/api/flyers/read) to fill the
 * EMPTY fields only, so nothing the member typed is overwritten.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ArrowLeft, Check, ImagePlus } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import SectionHeader from '../components/SectionHeader';
import WhitePillCTA from '../components/WhitePillCTA';
import { Touchable } from '../components/ui/Touchable';
import { ListGroup, ListRow } from '../components/ui/ListRow';
import { ChipRow, FieldInput } from '../components/community/Fields';
import { useAppAlert } from '../components/AppAlert';
import { colors as T, font, radius, withAlpha } from '../theme/tokens';
import {
  EMPTY_SHARE_DETAILS,
  SHARE_CATEGORIES,
  SHARE_COUNTRIES,
  readShareFlyer,
  shareCategoryKey,
  shareCurrenciesFor,
  shareDetailsFromRead,
  submitShare,
  uploadShareFlyer,
  type ShareCurrency,
  type ShareDetails,
} from '../lib/community';

type PickerField = 'date' | 'start_time' | 'end_time';

const pad = (n: number) => String(n).padStart(2, '0');
const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toHm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function pickerValue(field: PickerField, d: ShareDetails): Date {
  const now = new Date();
  if (field === 'date') return d.date ? new Date(`${d.date}T12:00:00`) : now;
  const hm = field === 'start_time' ? d.start_time : d.end_time;
  const base = new Date();
  if (hm) {
    const [h, m] = hm.split(':').map(Number);
    base.setHours(h, m, 0, 0);
  } else {
    base.setHours(field === 'start_time' ? 20 : 23, 0, 0, 0);
  }
  return base;
}

export default function ShareEventScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { t, language } = useI18n();
  const { user, userProfile } = useAuth();
  const showAlert = useAppAlert();
  const insets = useSafeAreaInsets();
  const { height: headerH, onHeight } = useOverlayHeaderInset();

  const [localFlyer, setLocalFlyer] = useState<string | null>(null);
  const [flyerUrl, setFlyerUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<string | null>(null);
  const [details, setDetails] = useState<ShareDetails>(EMPTY_SHARE_DETAILS);
  const [organizerName, setOrganizerName] = useState('');
  const [organizerHandle, setOrganizerHandle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [note, setNote] = useState('');
  const [picker, setPicker] = useState<PickerField | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  // Live right away (passed the safety checks) or held for review (web lib/community/publish).
  const [liveEventId, setLiveEventId] = useState<string | null>(null);

  const patch = (p: Partial<ShareDetails>) => setDetails((d) => ({ ...d, ...p }));
  // The flyer read lands after an await: read the LATEST details, not the
  // ones captured when the picker opened, so nothing typed meanwhile is lost.
  const detailsRef = useRef(details);
  useEffect(() => {
    detailsRef.current = details;
  }, [details]);

  const fieldList = (fields: string[]) => fields.map((f) => t(`community.share.fields.${f}`)).join(', ');

  const pickFlyer = useCallback(async () => {
    if (uploading) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const uri = result.assets[0].uri;
      setLocalFlyer(uri);
      setFlyerUrl(null);
      setReadNote(null);
      setUploading(true);
      let url: string;
      try {
        url = await uploadShareFlyer(userProfile?.id || user?.uid || '', uri);
        setFlyerUrl(url);
      } catch {
        setLocalFlyer(null);
        showAlert(t('common.error'), t('community.share.uploadError'));
        return;
      } finally {
        setUploading(false);
      }
      // Read it right away: fills only what is still empty.
      setReading(true);
      try {
        const read = await readShareFlyer(url);
        const { patch: fromFlyer, filled } = shareDetailsFromRead(read, detailsRef.current);
        patch(fromFlyer);
        setReadNote(filled.length ? t('community.share.filled', { fields: fieldList(filled) }) : t('community.share.nothingRead'));
      } catch (e: any) {
        const limited = String(e?.message || '').includes('rate_limited');
        setReadNote(t(limited ? 'community.share.readLimited' : 'community.share.readError'));
      } finally {
        setReading(false);
      }
    } catch {
      showAlert(t('common.error'), t('verification.common.failedToPickImageFromLibrary'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploading, userProfile?.id, user?.uid, language]);

  const onPicked = (_e: any, date?: Date) => {
    const field = picker;
    if (Platform.OS === 'android') setPicker(null);
    if (!date || !field) return;
    patch(field === 'date' ? { date: toYmd(date) } : { [field]: toHm(date) } as Partial<ShareDetails>);
  };

  const send = async () => {
    if (!flyerUrl || sending) return;
    setSending(true);
    try {
      const result = await submitShare({
        image_url: flyerUrl,
        source_url: sourceUrl,
        organizer_name: organizerName,
        organizer_handle: organizerHandle,
        note,
        details,
      });
      setLiveEventId(result?.status === 'published' && result.eventId ? String(result.eventId) : null);
      setSent(true);
    } catch (e: any) {
      const code = e?.code;
      showAlert(
        t('common.error'),
        code === 'rate_limited'
          ? t('community.share.errors.limited')
          : code === 'forbidden'
            ? t('community.share.errors.forbidden')
            : code === 'bad_image'
              ? t('community.share.errors.badImage')
              : t('community.share.errors.generic')
      );
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    setLocalFlyer(null);
    setFlyerUrl(null);
    setReadNote(null);
    setDetails(EMPTY_SHARE_DETAILS);
    setOrganizerName('');
    setOrganizerHandle('');
    setSourceUrl('');
    setNote('');
    setSent(false);
    setLiveEventId(null);
  };

  const country = details.country || 'HT';
  const currencies = shareCurrenciesFor(country);

  const header = (
    <OverlayHeader onHeight={onHeight} style={styles.headerBar}>
      <Touchable
        style={styles.iconButton}
        onPress={() => navigation.goBack()}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
      >
        <ArrowLeft size={24} color={colors.text} />
      </Touchable>
      <Text style={styles.headerTitle}>{t('community.share.title')}</Text>
      <View style={styles.iconButton} />
    </OverlayHeader>
  );

  if (sent) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        {header}
        <View style={[styles.sentWrap, { paddingTop: headerH + 24 }]}>
          <View style={styles.sentRow}>
            <Check size={18} color={colors.text} strokeWidth={1.75} />
            <Text style={styles.sentTitle}>
              {liveEventId ? t('community.share.liveTitle') : t('community.share.reviewTitle')}
            </Text>
          </View>
          <Text style={styles.sentBody}>
            {liveEventId ? t('community.share.liveBody') : t('community.share.reviewBody')}
          </Text>
          <View style={styles.sentActions}>
            {liveEventId ? (
              <WhitePillCTA
                size="sm"
                label={t('community.share.seeEvent')}
                onPress={() => navigation.replace('EventDetail', { eventId: liveEventId })}
                style={styles.flex}
              />
            ) : (
              <WhitePillCTA size="sm" label={t('community.share.done')} onPress={() => navigation.goBack()} style={styles.flex} />
            )}
            <Touchable style={styles.quietButton} onPress={reset} accessibilityRole="button">
              <Text style={styles.quietButtonText}>{t('community.share.another')}</Text>
            </Touchable>
          </View>
          <Touchable style={styles.quietButton} onPress={() => navigation.navigate('MyShares')} accessibilityRole="button">
            <Text style={styles.quietButtonText}>{t('community.share.mine')}</Text>
          </Touchable>
        </View>
      </SafeAreaView>
    );
  }

  const timeLabel = (hm: string) => hm || t('community.share.add');

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {header}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={{ paddingTop: headerH + 8, paddingBottom: 24, paddingHorizontal: 16 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* 1. The flyer */}
          <View style={styles.flyerRow}>
            <Touchable
              style={styles.flyerTile}
              onPress={pickFlyer}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel={localFlyer ? t('community.share.changeFlyer') : t('community.share.addFlyer')}
            >
              {localFlyer ? (
                <Image source={{ uri: localFlyer }} style={styles.flyerImage} contentFit="cover" />
              ) : (
                <ImagePlus size={24} color={colors.textSecondary} strokeWidth={1.5} />
              )}
              {uploading ? (
                <View style={styles.flyerBusy}>
                  <ActivityIndicator color={colors.text} />
                </View>
              ) : null}
            </Touchable>
            <View style={styles.flyerText}>
              <Text style={styles.flyerTitle}>{localFlyer ? t('community.share.changeFlyer') : t('community.share.addFlyer')}</Text>
              <Text style={styles.flyerNote}>
                {uploading
                  ? t('community.share.uploading')
                  : reading
                    ? t('community.share.reading')
                    : readNote || t('community.share.flyerHint')}
              </Text>
            </View>
          </View>

          <FieldInput
            label={t('community.share.fields.title')}
            value={details.title}
            onChangeText={(v) => patch({ title: v })}
            maxLength={120}
          />

          {/* 2. When */}
          <SectionHeader title={t('community.share.when')} />
          <ListGroup style={styles.group}>
            <ListRow title={t('community.share.fields.date')} value={details.date || t('community.share.add')} onPress={() => setPicker('date')} />
            <ListRow title={t('community.share.fields.start_time')} value={timeLabel(details.start_time)} onPress={() => setPicker('start_time')} />
            <ListRow title={t('community.share.fields.end_time')} value={timeLabel(details.end_time)} onPress={() => setPicker('end_time')} />
          </ListGroup>

          {/* 3. Where */}
          <SectionHeader title={t('community.share.where')} />
          <FieldInput label={t('community.share.fields.venue_name')} value={details.venue_name} onChangeText={(v) => patch({ venue_name: v })} maxLength={120} />
          <FieldInput label={t('community.share.fields.address')} value={details.address} onChangeText={(v) => patch({ address: v })} maxLength={200} />
          <FieldInput label={t('community.share.fields.city')} value={details.city} onChangeText={(v) => patch({ city: v })} maxLength={80} />
          <ChipRow
            label={t('community.share.fields.country')}
            options={SHARE_COUNTRIES.map((c) => ({ value: c, label: t(`countries.${c}`) }))}
            value={details.country}
            onChange={(c) => patch({ country: c, currency: shareCurrenciesFor(c).includes(details.currency as ShareCurrency) ? details.currency : '' })}
          />

          {/* 4. Tickets */}
          <SectionHeader title={t('community.share.tickets')} />
          <ChipRow
            options={[
              { value: 'free', label: t('community.share.free') },
              { value: 'paid', label: t('community.share.paid') },
            ]}
            value={details.free === true ? 'free' : details.free === false ? 'paid' : ''}
            onChange={(v) => patch({ free: v === 'free' })}
          />
          {details.free === false ? (
            <>
              <FieldInput
                label={t('community.share.fields.price')}
                value={details.price}
                onChangeText={(v) => patch({ price: v.replace(/[^0-9.,]/g, '') })}
                keyboardType="decimal-pad"
                maxLength={10}
              />
              <ChipRow
                options={currencies.map((c) => ({ value: c, label: c }))}
                value={details.currency || currencies[0]}
                onChange={(c) => patch({ currency: c })}
              />
            </>
          ) : null}
          <FieldInput
            label={t('community.share.fields.ticket_url')}
            value={details.ticket_url}
            onChangeText={(v) => patch({ ticket_url: v })}
            placeholder="https://"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            maxLength={500}
          />

          {/* 5. Category */}
          <SectionHeader title={t('community.share.category')} />
          <ChipRow
            options={SHARE_CATEGORIES.map((c) => ({ value: c, label: t(shareCategoryKey(c)) }))}
            value={details.category}
            onChange={(c) => patch({ category: c })}
          />

          {/* 6. Who posted it, and where */}
          <SectionHeader title={t('community.share.source')} />
          <FieldInput label={t('community.share.fields.organizer_name')} value={organizerName} onChangeText={setOrganizerName} maxLength={120} />
          <FieldInput
            label={t('community.share.fields.organizer_handle')}
            value={organizerHandle}
            onChangeText={setOrganizerHandle}
            placeholder="@"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={60}
          />
          <FieldInput
            label={t('community.share.fields.source_url')}
            value={sourceUrl}
            onChangeText={setSourceUrl}
            placeholder="https://instagram.com/p/…"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            maxLength={500}
          />
          <FieldInput label={t('community.share.fields.note')} value={note} onChangeText={setNote} multiline maxLength={500} />
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <WhitePillCTA
            size="sm"
            label={t('community.share.send')}
            onPress={send}
            loading={sending}
            disabled={!flyerUrl || uploading}
          />
        </View>
      </KeyboardAvoidingView>

      {/* Date and time: Android opens its own dialog; iOS a spinner sheet. */}
      {picker && Platform.OS === 'android' ? (
        <DateTimePicker
          value={pickerValue(picker, details)}
          mode={picker === 'date' ? 'date' : 'time'}
          is24Hour={false}
          display="default"
          onChange={onPicked}
        />
      ) : null}
      {Platform.OS === 'ios' ? (
        <Modal visible={!!picker} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
          <View style={styles.sheetScrim}>
            <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
              {picker ? (
                <DateTimePicker
                  value={pickerValue(picker, details)}
                  mode={picker === 'date' ? 'date' : 'time'}
                  display="spinner"
                  textColor={colors.text}
                  onChange={onPicked}
                />
              ) : null}
              <WhitePillCTA
                size="sm"
                label={t('community.share.pickerDone')}
                onPress={() => {
                  // Done with the wheel untouched still takes what it shows.
                  if (picker) onPicked(null, pickerValue(picker, details));
                  setPicker(null);
                }}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    headerBar: { justifyContent: 'space-between', paddingBottom: 12 },
    iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontFamily: font.serif, fontSize: 22, color: colors.text },
    flyerRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
    flyerTile: {
      width: 88,
      height: 110,
      borderRadius: radius.poster,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    flyerImage: { width: '100%', height: '100%' },
    flyerBusy: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      opacity: 0.85,
    },
    flyerText: { flex: 1 },
    flyerTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
    flyerNote: { marginTop: 4, fontSize: 13, lineHeight: 18, color: colors.textSecondary },
    group: { marginBottom: 16 },
    footer: { paddingHorizontal: 16, paddingTop: 10, backgroundColor: colors.background },
    sheetScrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: withAlpha(T.black, 0.5) },
    sheet: { backgroundColor: colors.surfaceRaised, paddingHorizontal: 16, paddingTop: 8, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
    sentWrap: { paddingHorizontal: 16 },
    sentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    sentTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
    sentBody: { marginTop: 6, fontSize: 15, lineHeight: 22, color: colors.textSecondary },
    sentActions: { marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 12 },
    quietButton: {
      height: 44,
      paddingHorizontal: 16,
      borderRadius: radius.button,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    quietButtonText: { fontSize: 15, fontWeight: '600', color: colors.text },
  });
