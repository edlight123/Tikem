/**
 * "Is this your event? Claim it" for a community-shared event (lib/community).
 * The organizer proves it is theirs with an Instagram handle, a link, or an
 * uploaded proof (a screenshot of the account, a letter). An uploaded proof
 * goes to the PRIVATE claim-proofs/{uid}/ folder and only its path is sent.
 * An admin decides; once approved the event moves to their account and they
 * can edit it and sell.
 *
 * Images only: the app has no document picker module, and adding one would
 * need a store build (the website takes a PDF).
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { ArrowLeft, ImagePlus } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import WhitePillCTA from '../components/WhitePillCTA';
import RequestStatusDot, { requestTone } from '../components/RequestStatusDot';
import { Touchable } from '../components/ui/Touchable';
import { ChipRow, FieldInput } from '../components/community/Fields';
import { useAppAlert } from '../components/AppAlert';
import { font, radius } from '../theme/tokens';
import { cleanHandle, getMyClaim, isSafeHttpUrl, submitClaim, uploadClaimProof, type ClaimMethod } from '../lib/community';

export default function ClaimEventScreen({ route, navigation }: any) {
  const { eventId, eventTitle } = (route?.params || {}) as { eventId: string; eventTitle?: string };
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { t } = useI18n();
  const showAlert = useAppAlert();
  const insets = useSafeAreaInsets();
  const { height: headerH, onHeight } = useOverlayHeaderInset();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [claimable, setClaimable] = useState(true);
  const [method, setMethod] = useState<ClaimMethod>('instagram');
  const [handle, setHandle] = useState('');
  const [link, setLink] = useState('');
  const [proof, setProof] = useState<{ uri: string; mime?: string | null } | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    getMyClaim(eventId)
      .then((r) => {
        if (!live) return;
        setClaimable(r.claimable);
        setStatus(r.claim?.status || null);
      })
      .catch(() => undefined)
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [eventId]);

  const pickProof = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      });
      if (!result.canceled && result.assets?.[0]?.uri) {
        setProof({ uri: result.assets[0].uri, mime: result.assets[0].mimeType });
      }
    } catch {
      showAlert(t('common.error'), t('verification.common.failedToPickImageFromLibrary'));
    }
  };

  const ready =
    (method === 'instagram' && !!cleanHandle(handle)) ||
    (method === 'link' && !!isSafeHttpUrl(link)) ||
    (method === 'upload' && !!proof);

  const send = async () => {
    if (!ready || sending) return;
    setSending(true);
    try {
      const proofPath = method === 'upload' && proof ? await uploadClaimProof(proof.uri, proof.mime) : undefined;
      await submitClaim(eventId, {
        method,
        instagram_handle: method === 'instagram' ? cleanHandle(handle) : undefined,
        proof_url: method === 'link' ? isSafeHttpUrl(link) || undefined : undefined,
        proof_path: proofPath,
        message: message.trim() || undefined,
      });
      setStatus('pending');
    } catch (e: any) {
      const code = e?.code;
      showAlert(
        t('common.error'),
        code === 'rate_limited'
          ? t('community.claim.errors.limited')
          : code === 'not_claimable'
            ? t('community.claim.errors.notClaimable')
            : code === 'invalid_proof' || code === 'too_large'
              ? t('community.claim.errors.proof')
              : t('community.claim.errors.generic')
      );
    } finally {
      setSending(false);
    }
  };

  const statusLabel =
    status === 'approved'
      ? t('community.claim.status.approved')
      : status === 'rejected'
        ? t('community.claim.status.rejected')
        : t('community.claim.status.pending');

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <OverlayHeader onHeight={onHeight} style={styles.headerBar}>
        <Touchable
          style={styles.iconButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={colors.text} />
        </Touchable>
        <Text style={styles.headerTitle}>{t('community.claim.title')}</Text>
        <View style={styles.iconButton} />
      </OverlayHeader>

      {loading ? (
        <View style={[styles.center, { paddingTop: headerH }]}>
          <ActivityIndicator color={colors.text} />
        </View>
      ) : status === 'pending' || status === 'approved' ? (
        <View style={[styles.body, { paddingTop: headerH + 16 }]}>
          <RequestStatusDot tone={requestTone(status === 'approved' ? 'approved' : 'pending')} label={statusLabel} />
          {eventTitle ? <Text style={styles.eventTitle}>{eventTitle}</Text> : null}
          <Text style={styles.muted}>
            {status === 'approved' ? t('community.claim.approvedBody') : t('community.claim.pendingBody')}
          </Text>
        </View>
      ) : !claimable ? (
        <View style={[styles.body, { paddingTop: headerH + 16 }]}>
          <Text style={styles.muted}>{t('community.claim.errors.notClaimable')}</Text>
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={{ paddingTop: headerH + 8, paddingHorizontal: 16, paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {eventTitle ? <Text style={styles.eventTitle}>{eventTitle}</Text> : null}
            {status === 'rejected' ? (
              <View style={styles.statusLine}>
                <RequestStatusDot tone="declined" label={statusLabel} />
              </View>
            ) : null}
            <ChipRow
              label={t('community.claim.proofLabel')}
              options={[
                { value: 'instagram', label: t('community.claim.methods.instagram') },
                { value: 'link', label: t('community.claim.methods.link') },
                { value: 'upload', label: t('community.claim.methods.upload') },
              ]}
              value={method}
              onChange={setMethod}
            />
            {method === 'instagram' ? (
              <FieldInput
                label={t('community.claim.handle')}
                value={handle}
                onChangeText={setHandle}
                placeholder="@"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={60}
              />
            ) : method === 'link' ? (
              <FieldInput
                label={t('community.claim.link')}
                value={link}
                onChangeText={setLink}
                placeholder="https://"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                maxLength={500}
              />
            ) : (
              <Touchable style={styles.proofRow} onPress={pickProof} accessibilityRole="button">
                <View style={styles.proofTile}>
                  {proof ? (
                    <Image source={{ uri: proof.uri }} style={styles.proofImage} contentFit="cover" />
                  ) : (
                    <ImagePlus size={22} color={colors.textSecondary} strokeWidth={1.5} />
                  )}
                </View>
                <View style={styles.flex}>
                  <Text style={styles.proofTitle}>{proof ? t('community.claim.changeProof') : t('community.claim.addProof')}</Text>
                  <Text style={styles.muted}>{t('community.claim.proofPrivate')}</Text>
                </View>
              </Touchable>
            )}
            <FieldInput
              label={t('community.claim.message')}
              value={message}
              onChangeText={setMessage}
              multiline
              maxLength={500}
            />
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <WhitePillCTA size="sm" label={t('community.claim.send')} onPress={send} loading={sending} disabled={!ready} />
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    headerBar: { justifyContent: 'space-between', paddingBottom: 12 },
    iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontFamily: font.serif, fontSize: 22, color: colors.text },
    body: { paddingHorizontal: 16, gap: 8 },
    eventTitle: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 12 },
    statusLine: { marginBottom: 12 },
    muted: { fontSize: 13, lineHeight: 18, color: colors.textSecondary },
    proofRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
    proofTile: {
      width: 64,
      height: 64,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    proofImage: { width: '100%', height: '100%' },
    proofTitle: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 2 },
    footer: { paddingHorizontal: 16, paddingTop: 10, backgroundColor: colors.background },
  });
