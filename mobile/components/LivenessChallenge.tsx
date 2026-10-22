import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { radius } from '../theme/tokens';

/**
 * LIVENESS: prove a real person is present, not a photo of one.
 *
 * A still selfie proves nothing — anyone can photograph a photograph. This
 * records a short clip while asking for actions in an order generated fresh for
 * every attempt, so an attacker cannot prepare a video in advance: they would
 * have to know the sequence before it exists.
 *
 * WHY THE PROMPTS ARE RANDOM AND THE SEQUENCE IS SAVED. The recorded order is
 * stored alongside the clip, so the reviewer (and the analysis service) can
 * check the person did THESE things in THIS order. A clip that doesn't match its
 * own challenge is a replay, however convincing the face looks.
 *
 * DELIBERATELY NO ON-DEVICE ML. Landmark and pose analysis runs server-side on
 * the uploaded clip, for two reasons: it needs no native module (this works with
 * the expo-camera the app already ships), and the honest limits of face models
 * on darker skin mean a machine must never be the one to REJECT. Every automated
 * signal is advisory; a human decides. See the KYC notes in the admin review UI.
 */

const { width } = Dimensions.get('window');

/** One instruction, with the machine-checkable signal it should produce. */
export type LivenessPrompt = {
  id: 'turn_left' | 'turn_right' | 'blink' | 'smile' | 'look_up';
  /** What the analysis service should look for: yaw/pitch degrees, or a blendshape. */
  signal: 'yaw_negative' | 'yaw_positive' | 'eye_blink' | 'mouth_smile' | 'pitch_up';
};

const PROMPTS: LivenessPrompt[] = [
  { id: 'turn_left', signal: 'yaw_negative' },
  { id: 'turn_right', signal: 'yaw_positive' },
  { id: 'blink', signal: 'eye_blink' },
  { id: 'smile', signal: 'mouth_smile' },
  { id: 'look_up', signal: 'pitch_up' },
];

/** Seconds each instruction stays on screen. Long enough to read and perform. */
const SECONDS_PER_PROMPT = 3;
/** How many instructions per attempt. Three keeps the clip short but unguessable. */
const PROMPT_COUNT = 3;

export type LivenessResult = {
  /** Local file URI of the recorded clip. */
  videoUri: string;
  /** The challenge actually issued, in order — the server verifies against this. */
  sequence: LivenessPrompt[];
  /** Seconds each prompt was displayed, so frames can be mapped to prompts. */
  secondsPerPrompt: number;
  /** When the recording started, so timings can be reconstructed. */
  startedAt: string;
};

/**
 * A fresh random sequence, never repeating the same instruction twice in a row
 * (two "blink"s back to back are indistinguishable from one long blink).
 */
function buildSequence(): LivenessPrompt[] {
  const pool = [...PROMPTS];
  const out: LivenessPrompt[] = [];
  while (out.length < PROMPT_COUNT && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    out.push(pool[i]);
    pool.splice(i, 1);
  }
  return out;
}

/**
 * Version of the consent wording shown before capture. Stored with the consent
 * record: if the wording changes, an old consent can still be traced to exactly
 * what the organizer was told, which is the whole point of keeping it.
 */
export const LIVENESS_CONSENT_VERSION = '2026-08-13';

export default function LivenessChallenge({
  onComplete,
  onCancel,
  onConsent,
}: {
  onComplete: (result: LivenessResult) => void;
  onCancel: () => void;
  /** Called once, when consent is given, so it can be recorded server-side. */
  onConsent?: (version: string) => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = getStyles(colors);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  // expo-camera records with audio by default; we do not need it and asking for
  // the microphone for an identity check is a permission we cannot justify.
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const cameraRef = useRef<any>(null);
  const [sequence] = useState<LivenessPrompt[]>(() => buildSequence());
  const [promptIndex, setPromptIndex] = useState(-1); // -1 = not started
  const [consented, setConsented] = useState(false);
  const [recording, setRecording] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const startedAtRef = useRef<string>('');
  // Guards the timer against a stop that has already begun, so a late tick
  // cannot advance past the end of the sequence and stop the recording twice.
  const stoppingRef = useRef(false);

  const start = useCallback(async () => {
    if (!cameraRef.current || recording) return;
    stoppingRef.current = false;
    startedAtRef.current = new Date().toISOString();
    setPromptIndex(0);
    setRecording(true);

    try {
      // Resolves when stopRecording() is called below.
      //
      // 480p, deliberately. This clip is watched by a reviewer and measured for
      // head pose — neither needs detail, and 1080p would be ~15MB per organizer
      // for no gain. It is also biometric data on a Haitian mobile connection:
      // the smaller upload is the difference between finishing the check and
      // abandoning it.
      const video = await cameraRef.current.recordAsync({
        maxDuration: PROMPT_COUNT * SECONDS_PER_PROMPT + 2,
        mute: true,
        videoQuality: '480p',
      });
      if (video?.uri) {
        onComplete({
          videoUri: video.uri,
          sequence,
          secondsPerPrompt: SECONDS_PER_PROMPT,
          startedAt: startedAtRef.current,
        });
      }
    } catch {
      // A failed recording must not strand the organizer on a dead screen.
      setRecording(false);
      setPromptIndex(-1);
      setFinishing(false);
    }
  }, [onComplete, recording, sequence]);

  // Advance the prompt every SECONDS_PER_PROMPT, then stop the recording.
  useEffect(() => {
    if (!recording || promptIndex < 0) return;

    const timer = setTimeout(async () => {
      if (promptIndex < sequence.length - 1) {
        setPromptIndex((i) => i + 1);
        return;
      }
      if (stoppingRef.current) return;
      stoppingRef.current = true;
      setFinishing(true);
      try {
        await cameraRef.current?.stopRecording();
      } catch {
        // recordAsync's own catch handles the failure path.
      }
    }, SECONDS_PER_PROMPT * 1000);

    return () => clearTimeout(timer);
  }, [promptIndex, recording, sequence.length]);

  const needsPermission = !cameraPermission?.granted || !micPermission?.granted;

  if (!cameraPermission || !micPermission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  if (needsPermission) {
    return (
      <View style={styles.center}>
        <Ionicons name="videocam-outline" size={64} color={colors.primary} />
        <Text style={styles.permissionTitle}>{t('liveness.permissionTitle')}</Text>
        <Text style={styles.permissionBody}>{t('liveness.permissionBody')}</Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={async () => {
            if (!cameraPermission.granted) await requestCameraPermission();
            // Recording needs the mic permission even when muted on some devices.
            if (!micPermission.granted) await requestMicPermission();
          }}
        >
          <Text style={styles.primaryButtonText}>{t('liveness.grantPermission')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
          <Text style={styles.cancelText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  /**
   * CONSENT BEFORE CAPTURE, and not as a formality.
   *
   * A Haiti payout profile says how someone is paid, not where they are. Much of
   * this audience is diaspora — an organizer in Miami or Brooklyn running an
   * event in Port-au-Prince needs a Haitian profile, and records their face while
   * physically in the United States. Illinois' BIPA and Texas' CUBI attach to the
   * PERSON's location, not the payout currency, and both require notice of what
   * is collected, why, and for how long, plus explicit consent BEFORE capture.
   * GDPR asks the same of an organizer in France.
   *
   * So the screen states it plainly and the answer is recorded. This is also
   * simply the honest thing to show someone before recording their face.
   */
  if (!consented) {
    return (
      <View style={styles.center}>
        <Ionicons name="shield-checkmark-outline" size={56} color={colors.primary} />
        <Text style={styles.permissionTitle}>{t('liveness.consent.title')}</Text>
        <Text style={styles.consentBody}>{t('liveness.consent.what')}</Text>
        <Text style={styles.consentBody}>{t('liveness.consent.why')}</Text>
        <Text style={styles.consentBody}>{t('liveness.consent.retention')}</Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => {
            setConsented(true);
            onConsent?.(LIVENESS_CONSENT_VERSION);
          }}
        >
          <Text style={styles.primaryButtonText}>{t('liveness.consent.agree')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
          <Text style={styles.cancelText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currentPrompt = promptIndex >= 0 ? sequence[promptIndex] : null;

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" mode="video" />

      {/* Face guide — keeps the subject framed so landmarks resolve server-side. */}
      <View pointerEvents="none" style={styles.guideWrap}>
        <View style={[styles.guide, recording && styles.guideActive]} />
      </View>

      <View style={styles.overlay} pointerEvents="box-none">
        {currentPrompt ? (
          <>
            <Text style={styles.promptLabel}>
              {t('liveness.stepOf')
                .replace('{current}', String(promptIndex + 1))
                .replace('{total}', String(sequence.length))}
            </Text>
            <Text style={styles.prompt}>{t(`liveness.prompts.${currentPrompt.id}`)}</Text>
          </>
        ) : (
          <>
            <Text style={styles.prompt}>{t('liveness.introTitle')}</Text>
            <Text style={styles.introBody}>{t('liveness.introBody')}</Text>
          </>
        )}
      </View>

      <View style={styles.footer}>
        {!recording ? (
          <>
            <TouchableOpacity style={styles.primaryButton} onPress={start}>
              <Text style={styles.primaryButtonText}>{t('liveness.start')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.recordingRow}>
            {finishing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <View style={styles.recordDot} />
                <Text style={styles.recordingText}>{t('liveness.recording')}</Text>
              </>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
      backgroundColor: colors.background,
    },
    guideWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
    guide: {
      width: width * 0.66,
      height: width * 0.86,
      borderRadius: width * 0.43,
      borderWidth: 3,
      borderColor: 'rgba(255,255,255,0.45)',
    },
    guideActive: { borderColor: '#22c55e' },
    overlay: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 96, paddingHorizontal: 28 },
    promptLabel: {
      textAlign: 'center',
      color: 'rgba(255,255,255,0.7)',
      fontSize: 12,
      letterSpacing: 1,
      marginBottom: 8,
    },
    prompt: { textAlign: 'center', color: '#fff', fontSize: 28, fontWeight: '700' },
    introBody: {
      textAlign: 'center',
      color: 'rgba(255,255,255,0.75)',
      fontSize: 14,
      marginTop: 12,
      lineHeight: 20,
    },
    footer: { position: 'absolute', left: 0, right: 0, bottom: 48, alignItems: 'center', gap: 12 },
    primaryButton: {
      backgroundColor: '#fff',
      paddingHorizontal: 32,
      paddingVertical: 16,
      borderRadius: radius.button,
    },
    primaryButtonText: { color: '#000', fontWeight: '700', fontSize: 16 },
    cancelButton: { padding: 12 },
    cancelText: { color: 'rgba(255,255,255,0.8)', fontSize: 15 },
    recordingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    recordDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444' },
    recordingText: { color: '#fff', fontSize: 15, fontWeight: '600' },
    permissionTitle: { color: colors.text, fontSize: 20, fontWeight: '700', marginTop: 20 },
    consentBody: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 21,
      textAlign: 'center',
      marginTop: 12,
    },
    permissionBody: {
      color: colors.textSecondary,
      fontSize: 15,
      textAlign: 'center',
      marginTop: 10,
      marginBottom: 24,
      lineHeight: 21,
    },
  });
