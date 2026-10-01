import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import {
  getVerificationRequest,
  initializeVerificationRequest,
  submitVerificationForReview,
  type VerificationRequest,
} from '../../lib/verification';
import { useAppAlert } from '../../components/AppAlert';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import SectionHeader from '../../components/SectionHeader';
import WhitePillCTA from '../../components/WhitePillCTA';
import StatusChip from '../../components/StatusChip';
import { radius } from '../../theme/tokens';

const SUBMITTED_STATUSES = ['pending', 'pending_review', 'in_review', 'approved'] as const;
const LOCKED_STATUSES = ['pending', 'pending_review', 'in_review'] as const;

export default function OrganizerVerificationScreen() {
  const { colors, isDark } = useTheme();
  const showAlert = useAppAlert();
  const styles = getStyles(colors);
  const navigation = useNavigation();
  const { userProfile } = useAuth();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  // The header floats over the scroll view, so the content has to reserve its
  // measured height or the progress card starts life hidden behind it.
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState<VerificationRequest | null>(null);

  useEffect(() => {
    loadVerificationRequest();
  }, [userProfile?.id]);

  // Coming back from a step screen: refresh, so a finished step shows its
  // check without relying on the step calling onComplete.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      loadVerificationRequest();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userProfile?.id])
  );

  const loadVerificationRequest = async () => {
    if (!userProfile?.id) return;

    try {
      let verificationRequest = await getVerificationRequest(userProfile.id);

      // Initialize if doesn't exist
      if (!verificationRequest) {
        verificationRequest = await initializeVerificationRequest(userProfile.id);
      }

      setRequest(verificationRequest);

      // Redirect if already approved
      if (verificationRequest.status === 'approved') {
        showAlert(
          t('verification.organizerVerification.alerts.alreadyVerifiedTitle'),
          t('verification.organizerVerification.alerts.alreadyVerifiedBody'),
          [{ text: t('common.ok'), onPress: () => navigation.goBack() }]
        );
        return;
      }
    } catch (error) {
      console.error('Error loading verification:', error);
      showAlert(t('common.error'), t('verification.organizerVerification.alerts.failedToLoad'));
    } finally {
      setLoading(false);
    }
  };

  const getStepStatus = (stepId: keyof VerificationRequest['steps']) => {
    if (!request) return 'incomplete';
    return request.steps[stepId].status;
  };

  const isStepComplete = (stepId: keyof VerificationRequest['steps']) => {
    return getStepStatus(stepId) === 'complete';
  };

  const canSubmit = () => {
    if (!request) return false;
    if ((LOCKED_STATUSES as readonly string[]).includes(request.status)) return false;
    const requiredSteps = Object.values(request.steps).filter((s: any) => s.required);
    return requiredSteps.every((s: any) => s.status === 'complete');
  };

  const isLocked = request ? (LOCKED_STATUSES as readonly string[]).includes(request.status) : false;
  const isRejected = request?.status === 'rejected' || request?.status === 'changes_requested';

  const renderStepIcon = (stepId: keyof VerificationRequest['steps']) => {
    const status = getStepStatus(stepId);
    if (status === 'complete') {
      return <Ionicons name="checkmark-circle" size={24} color={colors.success} />;
    } else if (status === 'needs_attention') {
      return <Ionicons name="alert-circle" size={24} color={colors.warning} />;
    }
    return <Ionicons name="ellipse-outline" size={24} color={colors.textSecondary} />;
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>{t('verification.organizerVerification.loading')}</Text>
      </View>
    );
  }

  if (!request) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={64} color={colors.error} />
        <Text style={styles.errorText}>{t('verification.organizerVerification.alerts.failedToLoad')}</Text>
        <WhitePillCTA label={t('common.retry')} onPress={loadVerificationRequest} style={{ marginTop: 20 }} />
      </View>
    );
  }

  const requiredSteps = Object.values(request.steps).filter((s: any) => s.required);
  const doneCount = requiredSteps.filter((s: any) => s.status === 'complete').length;
  const totalCount = requiredSteps.length;

  const stepRows: Array<{ id: keyof VerificationRequest['steps']; route: string }> = [
    { id: 'organizerInfo', route: 'OrganizerInfoForm' },
    { id: 'governmentId', route: 'GovernmentIDUpload' },
    { id: 'selfie', route: 'SelfieUpload' },
  ];

  const statusChip = isLocked ? (
    <StatusChip status="pending" label={t('verification.organizerVerification.status.underReview')} />
  ) : request.status === 'approved' ? (
    <StatusChip status="success" label={t('verification.organizerVerification.status.approved')} />
  ) : isRejected ? (
    <StatusChip
      status="declined"
      label={
        request.status === 'changes_requested'
          ? t('verification.organizerVerification.status.changesRequested')
          : t('verification.organizerVerification.status.rejected')
      }
    />
  ) : null;

  const submit = () => {
    showAlert(
      t('verification.organizerVerification.submit.confirmTitle'),
      t('verification.organizerVerification.submit.confirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('verification.organizerVerification.submit.confirmButton'),
          onPress: async () => {
            try {
              if (!userProfile?.id) return;
              await submitVerificationForReview(userProfile.id);
              showAlert(
                t('common.success'),
                t('verification.organizerVerification.submit.successBody'),
                [{ text: t('common.ok'), onPress: () => navigation.goBack() }]
              );
            } catch (error: any) {
              console.error('Error submitting:', error);
              showAlert(t('common.error'), error?.message || t('verification.organizerVerification.submit.failed'));
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

      {/* The organizer-surface header: left serif title, like every other
          organizer screen (it used to be a centered sans). */}
      <OrganizerScreenHeader
        title={t('verification.organizerVerification.title')}
        onBack={() => navigation.goBack()}
        overlay
        onHeight={onHeight}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: headerH + 8, paddingBottom: 24 + insets.bottom }]}
      >
        <SectionHeader
          title={t('verification.organizerVerification.stepsTitle')}
          subtitle={t('verification.organizerVerification.startMeta')}
          subtitleLines={2}
        />

        {/* Progress: one quiet line and a hairline-thin bar, no boxed card. */}
        <View style={styles.progressRow}>
          <Text style={styles.progressText}>
            {t('verification.organizerVerification.progressLine')
              .replace('{done}', String(doneCount))
              .replace('{total}', String(totalCount))}
          </Text>
          {statusChip}
        </View>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${totalCount ? Math.round((doneCount / totalCount) * 100) : 0}%` },
            ]}
          />
        </View>

        {/* The three steps as filled rows: state, title, one grey line, chevron. */}
        {stepRows.map(({ id, route }) => (
          <TouchableOpacity
            key={id}
            style={styles.stepRow}
            activeOpacity={0.75}
            accessibilityRole="button"
            onPress={() => (navigation as any).navigate(route, { onComplete: loadVerificationRequest })}
          >
            <View style={styles.stepIcon}>{renderStepIcon(id)}</View>
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle} numberOfLines={1}>
                {t(`verification.organizerVerification.steps.${id}.title`)}
              </Text>
              <Text style={styles.stepDescription} numberOfLines={1}>
                {t(`verification.organizerVerification.steps.${id}.description`)}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        ))}

        {isRejected && request.reviewNotes ? (
          <View style={styles.notice}>
            <Ionicons name="alert-circle-outline" size={20} color={colors.error} />
            <View style={{ flex: 1 }}>
              <Text style={styles.noticeTitle}>{t('verification.organizerVerification.status.reviewNotes')}</Text>
              <Text style={styles.noticeText}>{request.reviewNotes}</Text>
            </View>
          </View>
        ) : null}

        {canSubmit() && !isLocked && (
          <View style={styles.submitSection}>
            {/* The one white pill on this screen. */}
            <WhitePillCTA label={t('verification.organizerVerification.submit.button')} onPress={submit} />
            <Text style={styles.reviewTimeNote}>{t('verification.organizerVerification.submit.reviewTimeNote')}</Text>
          </View>
        )}

        {isLocked && (
          <View style={styles.notice}>
            <Ionicons name="time-outline" size={20} color={colors.warning} />
            <Text style={[styles.noticeText, { flex: 1 }]}>{t('verification.organizerVerification.pendingNotice')}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: colors.textSecondary,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: 20,
  },
  errorText: {
    marginTop: 16,
    fontSize: 18,
    color: colors.error,
    fontWeight: '600',
    textAlign: 'center',
  },
  content: {
    paddingHorizontal: 16,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 4,
  },
  progressText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  // A thin, quiet line: progress is information, not a feature.
  progressTrack: {
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
    marginTop: 10,
    marginBottom: 20,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.text,
  },
  // Filled rows on the canvas: a fill, never an outlined card.
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginBottom: 8,
  },
  stepIcon: {
    width: 24,
    alignItems: 'center',
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  stepDescription: {
    marginTop: 2,
    fontSize: 13,
    color: colors.textSecondary,
  },
  submitSection: {
    marginTop: 20,
  },
  reviewTimeNote: {
    marginTop: 12,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 16,
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  noticeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  noticeText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
});
