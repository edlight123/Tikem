import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Dimensions,
  ScrollView,
  Modal,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import SelfieCameraWithGuide from '../../components/SelfieCameraWithGuide';
import LivenessChallenge, { type LivenessResult } from '../../components/LivenessChallenge';
import OverlayHeader, { useOverlayHeaderInset } from '../../components/OverlayHeader';
import * as ImagePicker from 'expo-image-picker';
import {
  uploadLivenessVideo,
  updateVerificationFiles,
  updateVerificationStep,
  getDocumentDownloadURL,
  getVerificationRequest,
} from '../../lib/verification';
import { useAppAlert } from '../../components/AppAlert';
import { radius } from '../../theme/tokens';
import { AFTER_ALERT_MS } from '../../lib/moderationActions';

type RouteParams = {
  SelfieUpload: {
    onComplete?: () => void;
  };
};

export default function SelfieUploadScreen() {
  const { colors, isDark } = useTheme();
  const showAlert = useAppAlert();
  const styles = getStyles(colors);
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RouteParams, 'SelfieUpload'>>();
  const { userProfile } = useAuth();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  // The header floats over the scroll view, so the content has to reserve its
  // measured height or the facial guide starts life hidden behind it.
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const [selfiePath, setSelfiePath] = useState<string | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  // Liveness is a separate artefact from the selfie: the selfie is what gets
  // matched against the ID, the clip is what proves a live person produced it.
  const [showLiveness, setShowLiveness] = useState(false);
  const [livenessDone, setLivenessDone] = useState(false);
  const [savingLiveness, setSavingLiveness] = useState(false);

  /**
   * Recorded the moment consent is given, not after the upload succeeds — a
   * recording that fails to upload was still captured, and the consent that
   * authorised capturing it has to exist independently of the file.
   */
  const handleLivenessConsent = async (version: string) => {
    if (!userProfile?.id) return;
    try {
      await updateVerificationFiles(userProfile.id, {
        liveness: { consent: { version, grantedAt: new Date().toISOString() } },
      });
    } catch (error) {
      console.error('[Liveness] failed to record consent', error);
    }
  };

  const handleLivenessComplete = async (result: LivenessResult) => {
    if (!userProfile?.id) return;
    setShowLiveness(false);
    setSavingLiveness(true);
    try {
      const storagePath = await uploadLivenessVideo(userProfile.id, result.videoUri);
      await updateVerificationFiles(userProfile.id, {
        liveness: {
          path: storagePath,
          uploadedAt: new Date(),
          // Stored WITH the clip: the challenge is what makes the video evidence.
          sequence: result.sequence.map((p) => ({ id: p.id, signal: p.signal })),
          secondsPerPrompt: result.secondsPerPrompt,
          startedAt: result.startedAt,
        },
      });
      setLivenessDone(true);
      showAlert(t('common.success'), t('liveness.saved'));
    } catch (error: any) {
      showAlert(
        t('verification.common.uploadErrorTitle'),
        error?.message || t('verification.common.failedToUploadImage')
      );
    } finally {
      setSavingLiveness(false);
    }
  };

  useEffect(() => {
    loadExistingSelfie();
  }, [userProfile?.id]);

  const loadExistingSelfie = async () => {
    if (!userProfile?.id) return;

    try {
      const request = await getVerificationRequest(userProfile.id);
      if (request?.files?.selfie?.path) {
        const path = request.files.selfie.path;
        setSelfiePath(path);
        const url = await getDocumentDownloadURL(path);
        setSelfiePreview(url);
      }
    } catch (error) {
      console.error('Error loading existing selfie:', error);
    }
  };

  const uploadImageFromUri = async (uri: string) => {
    if (!userProfile?.id) return;

    try {
      setUploading(true);

      // Fetch the image as blob
      const response = await fetch(uri);
      if (!response.ok) {
        throw new Error('Failed to fetch image');
      }
      const blob = await response.blob();

      // Upload to storage using the same logic
      const { storage } = await import('../../config/firebase');
      const { ref, uploadBytes } = await import('firebase/storage');
      
      const timestamp = Date.now();
      const extension = uri.split('.').pop()?.toLowerCase() || 'jpg';
      const fileName = `selfie_${timestamp}.${extension}`;
      const storagePath = `verification/${userProfile.id}/${fileName}`;
      const storageRef = ref(storage, storagePath);

      const metadata = {
        contentType: `image/${extension === 'jpg' ? 'jpeg' : extension}`,
        customMetadata: {
          uploadedAt: new Date().toISOString(),
          documentType: 'selfie',
        },
      };

      await uploadBytes(storageRef, blob, metadata);
      setSelfiePath(storagePath);

      // Get preview URL
      const url = await getDocumentDownloadURL(storagePath);
      setSelfiePreview(url);

      // Update Firestore
      await updateVerificationFiles(userProfile.id, {
        selfie: {
          path: storagePath,
          uploadedAt: new Date(),
        },
      });

      showAlert(t('common.success'), t('verification.selfie.alerts.uploaded'));
    } catch (error: any) {
      console.error('[Selfie Upload] Error details:', {
        message: error.message,
        code: error.code,
        name: error.name,
      });
      showAlert(
        t('verification.common.uploadErrorTitle'),
        error.message || t('verification.common.failedToUploadImage')
      );
    } finally {
      setUploading(false);
    }
  };

  const handleCameraCapture = (uri: string) => {
    setShowCamera(false);
    uploadImageFromUri(uri);
  };

  const handleLibraryPick = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showAlert(
          t('verification.common.permissionRequiredTitle'),
          t('verification.common.photoLibraryPermissionBody')
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.9,
      });

      if (!result.canceled && result.assets[0]) {
        await uploadImageFromUri(result.assets[0].uri);
      }
    } catch (error: any) {
      console.error('[Library Pick] Error:', error);
      showAlert(t('common.error'), t('verification.common.failedToPickImageFromLibrary'));
    }
  };

  const showUploadOptions = () => {
    showAlert(t('verification.selfie.uploadTitle'), t('verification.common.chooseOption'), [
      {
        text: t('verification.selfie.buttons.takeSelfieWithCamera'),
        // Wait for the alert to finish closing: iOS drops a modal or picker
        // presented while it is still animating out.
        onPress: () => setTimeout(() => setShowCamera(true), AFTER_ALERT_MS),
      },
      {
        text: t('verification.common.chooseFromLibrary'),
        onPress: () => setTimeout(() => handleLibraryPick(), AFTER_ALERT_MS),
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const handleContinue = async () => {
    if (!selfiePath) {
      showAlert(t('verification.selfie.validation.missingTitle'), t('verification.selfie.validation.missingBody'));
      return;
    }

    if (!userProfile?.id) return;

    try {
      setSaving(true);

      // Mark step as complete
      await updateVerificationStep(userProfile.id, 'selfie', {
        status: 'complete',
        missingFields: [],
      });

      showAlert(t('common.success'), t('verification.selfie.alerts.verificationCompleted'), [
        {
          text: t('common.ok'),
          onPress: () => {
            if (route.params?.onComplete) {
              route.params.onComplete();
            }
            navigation.goBack();
          },
        },
      ]);
    } catch (error) {
      console.error('Error saving:', error);
      showAlert(t('common.error'), t('verification.common.saveStepFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={isDark ? colors.surface : colors.white} />

      {/* Header */}
      <OverlayHeader onHeight={onHeight} style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('verification.selfie.title')}</Text>
        <View style={{ width: 40 }} />
      </OverlayHeader>

      <ScrollView
        style={styles.content}
        contentContainerStyle={[styles.contentContainer, { paddingTop: headerH }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Facial Guide Visual */}
        <View style={styles.guideVisual}>
          <Text style={styles.guideTitle}>{t('verification.selfie.guide.title')}</Text>
          <View style={styles.ovalContainer}>
            <View style={styles.ovalGuide}>
              {/* Horizontal center line */}
              <View style={styles.horizontalLine} />
              {/* Vertical center line */}
              <View style={styles.verticalLine} />
              <Ionicons 
                name="person" 
                size={80} 
                color={colors.primary} 
                style={styles.personIcon}
              />
            </View>
          </View>
          <Text style={styles.guideSubtitle}>{t('verification.selfie.guide.subtitle')}</Text>
        </View>

        {/* Instructions */}
        <View style={styles.instructionsCard}>
          <Ionicons name="camera" size={32} color={colors.primary} />
          <Text style={styles.instructionsTitle}>{t('verification.selfie.instructions.title')}</Text>
          {/* The 3 tips that most affect whether a verification passes. */}
          <View style={styles.tipsList}>
            <Text style={styles.tipItem}>✓ {t('verification.selfie.tips.holdIdNextToFace')}</Text>
            <Text style={styles.tipItem}>✓ {t('verification.selfie.tips.faceVisible')}</Text>
            <Text style={styles.tipItem}>✓ {t('verification.selfie.tips.idReadable')}</Text>
          </View>
        </View>

        {/* Selfie Upload */}
        <View style={styles.uploadSection}>
          <Text style={styles.uploadLabel}>{t('verification.selfie.labels.selfieWithId')}</Text>
          {selfiePreview ? (
            <View style={styles.previewContainer}>
              <Image source={{ uri: selfiePreview }} style={styles.preview} />
              <TouchableOpacity
                style={styles.changeButton}
                onPress={showUploadOptions}
                disabled={uploading}
              >
                <Ionicons name="camera" size={20} color={colors.primary} />
                <Text style={styles.changeButtonText}>{t('verification.selfie.buttons.retake')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.uploadButton}
              onPress={showUploadOptions}
              disabled={uploading}
            >
              {uploading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Ionicons name="camera-outline" size={64} color={colors.primary} />
                  <Text style={styles.uploadButtonText}>{t('verification.selfie.buttons.takeSelfieWithId')}</Text>
                  <Text style={styles.uploadButtonSubtext}>
                    {t('verification.selfie.uploadHint')}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Liveness — the step that makes the selfie mean something. */}
        <View style={styles.uploadSection}>
          <Text style={styles.uploadLabel}>{t('liveness.sectionLabel')}</Text>
          <TouchableOpacity
            style={styles.uploadButton}
            onPress={() => setShowLiveness(true)}
            disabled={savingLiveness}
          >
            {savingLiveness ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <Ionicons
                  name={livenessDone ? 'checkmark-circle' : 'videocam-outline'}
                  size={64}
                  color={livenessDone ? '#22c55e' : colors.primary}
                />
                <Text style={styles.uploadButtonText}>
                  {livenessDone ? t('liveness.redo') : t('liveness.start')}
                </Text>
                <Text style={styles.uploadButtonSubtext}>{t('liveness.sectionHint')}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Example */}
        <View style={styles.exampleCard}>
          <Ionicons name="checkmark-circle" size={24} color={colors.success} />
          <View style={styles.exampleText}>
            <Text style={styles.exampleTitle}>{t('verification.selfie.example.goodTitle')}</Text>
            <Text style={styles.exampleDescription}>
              {t('verification.selfie.example.goodDescription')}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Continue Button */}
      <View style={[styles.footer, { paddingBottom: 16 + insets.bottom }]}>
        <TouchableOpacity
          style={[
            styles.continueButton,
            (!selfiePath || uploading || saving) && styles.continueButtonDisabled,
          ]}
          onPress={handleContinue}
          disabled={!selfiePath || uploading || saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.continueButtonText}>{t('verification.common.saveAndContinue')}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Camera Modal with Facial Guide */}
      <Modal
        visible={showCamera}
        animationType="slide"
        presentationStyle="fullScreen"
      >
        <SelfieCameraWithGuide
          onCapture={handleCameraCapture}
          onCancel={() => setShowCamera(false)}
        />
      </Modal>

      {/* Liveness: a still selfie proves nothing on its own. */}
      <Modal visible={showLiveness} animationType="slide" presentationStyle="fullScreen">
        <LivenessChallenge
          onComplete={handleLivenessComplete}
          onCancel={() => setShowLiveness(false)}
          onConsent={handleLivenessConsent}
        />
      </Modal>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // OverlayHeader owns the layout, the safe-area padding and the blurred
  // backdrop; only the title-centering rule is ours.
  header: {
    justifyContent: 'space-between',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  guideVisual: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
  },
  guideTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 16,
  },
  ovalContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 20,
  },
  ovalGuide: {
    width: Dimensions.get('window').width * 0.5,
    height: Dimensions.get('window').width * 0.65,
    borderRadius: (Dimensions.get('window').width * 0.5) / 2,
    borderWidth: 3,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  horizontalLine: {
    position: 'absolute',
    width: '60%',
    height: 2,
    backgroundColor: colors.primary,
    opacity: 0.4,
  },
  verticalLine: {
    position: 'absolute',
    width: 2,
    height: '60%',
    backgroundColor: colors.primary,
    opacity: 0.4,
  },
  personIcon: {
    opacity: 0.3,
  },
  guideSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  instructionsCard: {
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24,
    alignItems: 'center',
  },
  instructionsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginTop: 8,
    marginBottom: 12,
  },
  tipsList: {
    alignSelf: 'stretch',
  },
  tipItem: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 6,
    lineHeight: 20,
  },
  uploadSection: {
    marginBottom: 24,
  },
  uploadLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  uploadButton: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    padding: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginTop: 16,
  },
  uploadButtonSubtext: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  previewContainer: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  preview: {
    width: '100%',
    height: 300,
    resizeMode: 'cover',
  },
  changeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  changeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
    marginLeft: 8,
  },
  exampleCard: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: colors.success + '10',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.success + '30',
  },
  exampleText: {
    flex: 1,
    marginLeft: 12,
  },
  exampleTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.success,
    marginBottom: 4,
  },
  exampleDescription: {
    fontSize: 13,
    color: colors.success,
    lineHeight: 18,
  },
  footer: {
    padding: 16,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  continueButton: {
    backgroundColor: colors.primary,
    minHeight: 56,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonDisabled: {
    backgroundColor: colors.textSecondary,
    opacity: 0.5,
  },
  continueButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
});
