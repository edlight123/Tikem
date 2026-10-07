import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import {
  pickAndUploadImage,
  uploadIdImageFromUri,
  updateVerificationFiles,
  updateVerificationStep,
  getDocumentDownloadURL,
  getVerificationRequest,
} from '../../lib/verification';
import { useAppAlert } from '../../components/AppAlert';
import OverlayHeader, { useOverlayHeaderInset } from '../../components/OverlayHeader';
import { radius } from '../../theme/tokens';
import DocumentScanner, { ResponseType } from 'react-native-document-scanner-plugin';
import { AFTER_ALERT_MS } from '../../lib/moderationActions';

type DocumentType = 'passport' | 'national_id' | 'drivers_license';

type RouteParams = {
  GovernmentIDUpload: {
    onComplete?: () => void;
  };
};

export default function GovernmentIDUploadScreen() {
  const { colors, isDark } = useTheme();
  const showAlert = useAppAlert();
  const styles = getStyles(colors);
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RouteParams, 'GovernmentIDUpload'>>();
  const { userProfile } = useAuth();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  // The header floats over the scroll view, so the content has to reserve its
  // measured height or the photo tips start life hidden behind it.
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const [frontPath, setFrontPath] = useState<string | null>(null);
  const [backPath, setBackPath] = useState<string | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [backPreview, setBackPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  /**
   * Which document they are submitting. Chosen FIRST, because it decides how
   * many photos we ask for: a passport is a single photo page, so asking for a
   * "back" gets either a blank submission or a picture of nothing — and the
   * reviewer cannot tell those from a missing upload.
   */
  const [documentType, setDocumentType] = useState<DocumentType | null>(null);
  const needsBack = documentType !== 'passport';

  useEffect(() => {
    loadExistingImages();
  }, [userProfile?.id]);

  const loadExistingImages = async () => {
    if (!userProfile?.id) return;

    try {
      const request = await getVerificationRequest(userProfile.id);
      if (request?.files?.governmentId) {
        const { front, back, documentType: savedType } = request.files.governmentId;
        if (savedType) setDocumentType(savedType as DocumentType);
        
        if (front) {
          setFrontPath(front);
          const url = await getDocumentDownloadURL(front);
          setFrontPreview(url);
        }
        
        if (back) {
          setBackPath(back);
          const url = await getDocumentDownloadURL(back);
          setBackPreview(url);
        }
      }
    } catch (error) {
      console.error('Error loading existing images:', error);
    }
  };

  /**
   * Store a captured image (from the scanner) for one side, then mirror exactly
   * what the picker path records so a scanned ID and a photographed one are
   * indistinguishable downstream.
   */
  const uploadFromUri = async (uri: string, side: 'front' | 'back') => {
    if (!userProfile?.id) return;
    try {
      setUploading(true);
      const storagePath = await uploadIdImageFromUri(
        userProfile.id,
        uri,
        side === 'front' ? 'id_front' : 'id_back'
      );
      const url = await getDocumentDownloadURL(storagePath);

      if (side === 'front') {
        setFrontPath(storagePath);
        setFrontPreview(url);
      } else {
        setBackPath(storagePath);
        setBackPreview(url);
      }

      // Never write an undefined side: Firestore rejects undefined field values.
      const nextFront = side === 'front' ? storagePath : frontPath;
      const nextBack = side === 'back' ? storagePath : backPath;
      await updateVerificationFiles(userProfile.id, {
        governmentId: {
          documentType: documentType || undefined,
          ...(nextFront ? { front: nextFront } : {}),
          ...(nextBack ? { back: nextBack } : {}),
          uploadedAt: new Date(),
        },
      });

      showAlert(
        t('common.success'),
        side === 'front'
          ? t('verification.governmentId.alerts.frontUploaded')
          : t('verification.governmentId.alerts.backUploaded')
      );
    } catch (error: any) {
      showAlert(
        t('verification.common.uploadErrorTitle'),
        error?.message || t('verification.common.failedToUploadImage')
      );
    } finally {
      setUploading(false);
    }
  };

  const handleUploadFront = async (useCamera: boolean) => {
    if (!userProfile?.id) return;

    try {
      setUploading(true);
      const storagePath = await pickAndUploadImage(userProfile.id, 'id_front', useCamera);
      setFrontPath(storagePath);

      // Get preview URL
      const url = await getDocumentDownloadURL(storagePath);
      setFrontPreview(url);

      // Update Firestore — never include an undefined side: Firestore's
      // updateDoc rejects `undefined` field values outright ("Unsupported
      // field value"), which used to kill the very first upload.
      await updateVerificationFiles(userProfile.id, {
        governmentId: {
          documentType: documentType || undefined,
          front: storagePath,
          ...(backPath ? { back: backPath } : {}),
          uploadedAt: new Date(),
        },
      });

      showAlert(t('common.success'), t('verification.governmentId.alerts.frontUploaded'));
    } catch (error: any) {
      console.error('[ID Front Upload] Error details:', {
        message: error.message,
        code: error.code,
        name: error.name,
      });
      if (error.message !== 'Image selection cancelled') {
        const errorMsg = error.message || 'Failed to upload image';
        showAlert(t('verification.common.uploadErrorTitle'), errorMsg);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleUploadBack = async (useCamera: boolean) => {
    if (!userProfile?.id) return;

    try {
      setUploading(true);
      const storagePath = await pickAndUploadImage(userProfile.id, 'id_back', useCamera);
      setBackPath(storagePath);

      // Get preview URL
      const url = await getDocumentDownloadURL(storagePath);
      setBackPreview(url);

      // Same undefined-guard as the front upload.
      await updateVerificationFiles(userProfile.id, {
        governmentId: {
          ...(frontPath ? { front: frontPath } : {}),
          back: storagePath,
          uploadedAt: new Date(),
        },
      });

      showAlert(t('common.success'), t('verification.governmentId.alerts.backUploaded'));
    } catch (error: any) {
      console.error('[ID Back Upload] Error details:', {
        message: error.message,
        code: error.code,
        name: error.name,
      });
      if (error.message !== 'Image selection cancelled') {
        const errorMsg = error.message || 'Failed to upload image';
        showAlert(t('verification.common.uploadErrorTitle'), errorMsg);
      }
    } finally {
      setUploading(false);
    }
  };

  /**
   * AUTO-CAPTURE. Apple's VisionKit (and MLKit on Android) finds the document's
   * edges in the live preview, fires the shutter itself when the frame is square
   * and sharp, then deskews and crops. That removes the two things that actually
   * fail a review: a photo taken at an angle, and a blurry one. It also removes
   * a step — the organizer holds the ID up and it is captured, rather than
   * aiming and tapping.
   *
   * Manual photo and library pick stay available: scanning needs decent light,
   * and an organizer who cannot get a clean scan must still be able to submit.
   */
  const scanDocument = async (side: 'front' | 'back') => {
    try {
      const { scannedImages } = await DocumentScanner.scanDocument({
        // One page per side, so the scanner returns and we upload immediately
        // instead of the organizer having to end a multi-page session.
        maxNumDocuments: 1,
        responseType: ResponseType.ImageFilePath,
        croppedImageQuality: 90,
      });

      const uri = scannedImages?.[0];
      // Cancelling is not an error — the organizer simply changed their mind.
      if (!uri) return;

      if (side === 'front') {
        await uploadFromUri(uri, 'front');
      } else {
        await uploadFromUri(uri, 'back');
      }
    } catch (error: any) {
      showAlert(
        t('verification.common.uploadErrorTitle'),
        error?.message || t('verification.common.failedToUploadImage')
      );
    }
  };

  const showUploadOptions = (side: 'front' | 'back') => {
    const sideLabel = side === 'front' ? t('verification.governmentId.sides.front') : t('verification.governmentId.sides.back');
    showAlert(
      `${t('verification.governmentId.uploadTitlePrefix')} ${sideLabel}`,
      t('verification.common.chooseOption'),
      [
        {
          text: t('verification.governmentId.scanDocument'),
          // Pickers wait for the alert to finish closing or iOS drops them.
          onPress: () => setTimeout(() => scanDocument(side), AFTER_ALERT_MS),
        },
        {
          text: t('verification.common.takePhoto'),
          onPress: () => {
            setTimeout(() => (side === 'front' ? handleUploadFront(true) : handleUploadBack(true)), AFTER_ALERT_MS);
          },
        },
        {
          text: t('verification.common.chooseFromLibrary'),
          onPress: () => {
            setTimeout(() => (side === 'front' ? handleUploadFront(false) : handleUploadBack(false)), AFTER_ALERT_MS);
          },
        },
        { text: t('common.cancel'), style: 'cancel' },
      ]
    );
  };

  const handleContinue = async () => {
    if (!documentType) {
      showAlert(
        t('verification.governmentId.type.missingTitle'),
        t('verification.governmentId.type.missingBody')
      );
      return;
    }
    if (!frontPath || (needsBack && !backPath)) {
      showAlert(t('verification.governmentId.validation.missingTitle'), t('verification.governmentId.validation.missingBody'));
      return;
    }

    if (!userProfile?.id) return;

    try {
      setSaving(true);

      // Mark step as complete
      await updateVerificationStep(userProfile.id, 'governmentId', {
        status: 'complete',
        missingFields: [],
      });

      showAlert(t('common.success'), t('verification.governmentId.alerts.uploadedSuccessfully'), [
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
        <Text style={styles.headerTitle}>{t('verification.governmentId.title')}</Text>
        <View style={{ width: 40 }} />
      </OverlayHeader>

      {/* Scrollable — with both previews loaded the content is taller than the
          viewport, and testers couldn't reach the ID Back section at all. */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={[styles.contentContainer, { paddingTop: headerH }]}
      >
        {/* WHICH DOCUMENT — asked first, because it decides what we ask for next. */}
        <View style={styles.uploadSection}>
          <Text style={styles.uploadLabel}>{t('verification.governmentId.type.label')}</Text>
          <View style={styles.typeRow}>
            {(['passport', 'national_id', 'drivers_license'] as DocumentType[]).map((type) => {
              const active = documentType === type;
              return (
                <TouchableOpacity
                  key={type}
                  style={[styles.typeChip, active && styles.typeChipActive]}
                  onPress={() => setDocumentType(type)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>
                    {t(`verification.governmentId.type.${type}`)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {documentType === 'passport' ? (
            <Text style={styles.typeHint}>{t('verification.governmentId.type.passportHint')}</Text>
          ) : null}
        </View>

        {/*
          One line, not a card. Four tips behind a 32pt icon took a third of the
          screen to say something the scanner now handles itself — it frames,
          straightens and waits for focus. The advice that still depends on the
          organizer is light, so that is what remains.
        */}
        <Text style={styles.tipsInline}>{t('verification.governmentId.tipsInline')}</Text>

        {/* Front Upload */}
        <View style={styles.uploadSection}>
          <Text style={styles.uploadLabel}>
            {documentType === 'passport'
              ? t('verification.governmentId.labels.passportPage')
              : t('verification.governmentId.labels.front')}
          </Text>
          {frontPreview ? (
            <View style={styles.previewContainer}>
              <Image source={{ uri: frontPreview }} style={styles.preview} />
              <TouchableOpacity
                style={styles.changeButton}
                onPress={() => showUploadOptions('front')}
                disabled={uploading}
              >
                <Ionicons name="camera" size={20} color={colors.primary} />
                <Text style={styles.changeButtonText}>{t('verification.common.changePhoto')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.uploadButton}
              onPress={() => showUploadOptions('front')}
              disabled={uploading}
            >
              {uploading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={48} color={colors.primary} />
                  <Text style={styles.uploadButtonText}>{t('verification.governmentId.buttons.uploadFront')}</Text>
                  <Text style={styles.uploadButtonSubtext}>
                    {t('verification.common.uploadHint')}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Back Upload — never for a passport: there is no second page to
            photograph, and asking produced blank submissions a reviewer could
            not distinguish from a missing upload. */}
        {needsBack ? (
        <View style={styles.uploadSection}>
          <Text style={styles.uploadLabel}>{t('verification.governmentId.labels.back')}</Text>
          {backPreview ? (
            <View style={styles.previewContainer}>
              <Image source={{ uri: backPreview }} style={styles.preview} />
              <TouchableOpacity
                style={styles.changeButton}
                onPress={() => showUploadOptions('back')}
                disabled={uploading}
              >
                <Ionicons name="camera" size={20} color={colors.primary} />
                <Text style={styles.changeButtonText}>{t('verification.common.changePhoto')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.uploadButton}
              onPress={() => showUploadOptions('back')}
              disabled={uploading}
            >
              {uploading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={48} color={colors.primary} />
                  <Text style={styles.uploadButtonText}>{t('verification.governmentId.buttons.uploadBack')}</Text>
                  <Text style={styles.uploadButtonSubtext}>
                    {t('verification.common.uploadHint')}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
        ) : null}
      </ScrollView>

      {/* Continue Button */}
      <View style={[styles.footer, { paddingBottom: 16 + insets.bottom }]}>
        <TouchableOpacity
          style={[
            styles.continueButton,
            (!documentType || !frontPath || (needsBack && !backPath) || uploading || saving) &&
              styles.continueButtonDisabled,
          ]}
          onPress={handleContinue}
          disabled={!documentType || !frontPath || (needsBack && !backPath) || uploading || saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.continueButtonText}>{t('verification.common.saveAndContinue')}</Text>
          )}
        </TouchableOpacity>
      </View>
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
    paddingBottom: 24,
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
  // One line, three chips. Wrapping put "Driver's licence" on a row of its own,
  // which read as a separate choice rather than the third of three.
  tipsInline: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
    marginBottom: 18,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  typeChip: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: radius.pill ?? 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  typeChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  typeChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  typeChipTextActive: {
    color: colors.onPrimary,
  },
  typeHint: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
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
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginTop: 12,
  },
  uploadButtonSubtext: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
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
    height: 200,
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
