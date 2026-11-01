import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useTheme } from '../contexts/ThemeContext';
import { safeFormatForLanguage } from '../lib/dates';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { RADIUS } from '../config/brand';
import { radius, font } from '../theme/tokens';
import { backendFetch } from '../lib/api/backend';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import { ReviewSkeleton } from '../components/Skeleton';
import { useAppAlert } from '../components/AppAlert';

export default function ReviewScreen({ route, navigation }: any) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { ticketId, eventId, eventTitle } = route.params;
  const { user } = useAuth();
  const { t, language } = useI18n();
  const insets = useSafeAreaInsets();
  // The title bar is a blurred overlay now, so the form beneath reserves its
  // measured height (see OverlayHeader).
  const { height: headerH, onHeight: onHeaderHeight } = useOverlayHeaderInset();
  const showAlert = useAppAlert();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [ticket, setTicket] = useState<any>(null);
  const [rating, setRating] = useState(0);
  const [organizerRating, setOrganizerRating] = useState(0);
  const [comment, setComment] = useState('');
  const [wouldRecommend, setWouldRecommend] = useState<boolean | null>(null);
  const [existingReview, setExistingReview] = useState<any>(null);

  useEffect(() => {
    fetchData();
  }, [ticketId, eventId]);

  const fetchData = async () => {
    try {
      // Fetch ticket details
      if (ticketId) {
        const ticketDoc = await getDoc(doc(db, 'tickets', ticketId));
        if (ticketDoc.exists()) {
          setTicket({ id: ticketDoc.id, ...ticketDoc.data() });
        }
      }

      // Check for existing review
      const response = await backendFetch(`/api/reviews?eventId=${eventId}`);
      const data = await response.json();
      
      if (data.reviews && user) {
        const myReview = data.reviews.find((r: any) => r.user_id === user.uid);
        if (myReview) {
          setExistingReview(myReview);
          setRating(myReview.rating);
          setOrganizerRating(myReview.organizer_rating || 0);
          setComment(myReview.comment || '');
          setWouldRecommend(myReview.would_recommend);
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitReview = async () => {
    if (rating === 0) {
      showAlert(t('common.error'), t('review.selectRating') || 'Please select a rating');
      return;
    }

    setSubmitting(true);
    try {
      const response = await backendFetch('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({
          eventId,
          ticketId,
          rating,
          comment: comment.trim() || null,
          organizerRating: organizerRating > 0 ? organizerRating : null,
          wouldRecommend,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit review');
      }

      showAlert(
        t('common.success'),
        existingReview 
          ? (t('review.updated') || 'Review updated successfully!')
          : (t('review.submitted') || 'Thank you for your review!'),
        [{ text: t('common.ok'), onPress: () => navigation.goBack() }]
      );
    } catch (error: any) {
      console.error('Error submitting review:', error);
      showAlert(t('common.error'), error.message || t('review.submitError') || 'Failed to submit review');
    } finally {
      setSubmitting(false);
    }
  };

  const renderStars = (currentRating: number, setRatingFn: (r: number) => void, label: string) => (
    <View style={styles.ratingSection}>
      <Text style={styles.ratingLabel}>{label}</Text>
      <View style={styles.starsContainer}>
        {[1, 2, 3, 4, 5].map((star) => (
          <TouchableOpacity
            key={star}
            onPress={() => setRatingFn(star)}
            style={styles.starButton}
          >
            <Ionicons
              name={star <= currentRating ? 'star' : 'star-outline'}
              size={36}
              color={star <= currentRating ? '#FFB800' : colors.border}
            />
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.ratingText}>
        {currentRating > 0 
          ? ['', t('review.ratings.poor') || 'Poor', t('review.ratings.fair') || 'Fair', t('review.ratings.good') || 'Good', t('review.ratings.veryGood') || 'Very Good', t('review.ratings.excellent') || 'Excellent'][currentRating]
          : (t('review.tapToRate') || 'Tap to rate')
        }
      </Text>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ReviewSkeleton />
      </SafeAreaView>
    );
  }

  return (
    // edges WITHOUT 'top': OverlayHeader pays the notch inset itself, so the
    // chrome runs edge-to-edge behind the status bar rather than starting
    // below a black strip.
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header — a blurred overlay the form scrolls under. */}
      <OverlayHeader onHeight={onHeaderHeight} style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {existingReview ? (t('review.editTitle') || 'Edit Review') : (t('review.title') || 'Leave a Review')}
        </Text>
        <View style={{ width: 40 }} />
      </OverlayHeader>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingTop: headerH, paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Event Info */}
        <View style={styles.eventCard}>
          <Text style={styles.eventTitle}>{eventTitle || ticket?.event_title}</Text>
          {ticket?.event_date && (
            <Text style={styles.eventDate}>
              {safeFormatForLanguage(ticket.event_date, 'MMMM dd, yyyy', language)}
            </Text>
          )}
        </View>

        {/* Event Rating */}
        {renderStars(rating, setRating, t('review.eventRatingLabel') || 'How was the event?')}

        {/* Organizer Rating */}
        {renderStars(organizerRating, setOrganizerRating, t('review.organizerRatingLabel') || 'How was the organizer? (optional)')}

        {/* Would Recommend */}
        <View style={styles.recommendSection}>
          <Text style={styles.ratingLabel}>{t('review.wouldRecommend') || 'Would you recommend this event?'}</Text>
          <View style={styles.recommendButtons}>
            <TouchableOpacity
              style={[
                styles.recommendButton,
                wouldRecommend === true && styles.recommendButtonSelected,
              ]}
              onPress={() => setWouldRecommend(true)}
            >
              <Ionicons
                name="thumbs-up"
                size={24}
                color={wouldRecommend === true ? colors.white : colors.success}
              />
              <Text style={[
                styles.recommendButtonText,
                wouldRecommend === true && styles.recommendButtonTextSelected,
              ]}>
                {t('common.yes') || 'Yes'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.recommendButton,
                wouldRecommend === false && styles.recommendButtonSelectedNo,
              ]}
              onPress={() => setWouldRecommend(false)}
            >
              <Ionicons
                name="thumbs-down"
                size={24}
                color={wouldRecommend === false ? colors.white : colors.error}
              />
              <Text style={[
                styles.recommendButtonText,
                wouldRecommend === false && styles.recommendButtonTextSelected,
              ]}>
                {t('common.no') || 'No'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Comment */}
        <View style={styles.commentSection}>
          <Text style={styles.ratingLabel}>{t('review.commentLabel') || 'Share your experience (optional)'}</Text>
          <TextInput
            style={styles.commentInput}
            placeholder={t('review.commentPlaceholder') || 'What did you enjoy? Any suggestions?'}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.primary}
            value={comment}
            onChangeText={setComment}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            maxLength={500}
          />
          <Text style={styles.charCount}>{comment.length}/500</Text>
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={handleSubmitReview}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <>
              <Ionicons name="send" size={20} color={colors.white} />
              <Text style={styles.submitButtonText}>
                {existingReview ? (t('review.update') || 'Update Review') : (t('review.submit') || 'Submit Review')}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  // Overlay chrome (OverlayHeader owns the row layout, the safe-area top
  // padding, the blur backdrop and the absolute placement) — only the row's own
  // geometry is ours. No paddingTop here: the SafeAreaView above runs
  // edges={['bottom']} precisely so OverlayHeader can pay the notch itself. No
  // fill and no hairline either: they would paint over the blur.
  header: {
    justifyContent: 'space-between',
    paddingBottom: 12,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontFamily: font.serif,
    fontSize: 20,
    letterSpacing: 0,
    color: colors.text,
  },
  eventCard: {
    margin: 16,
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eventTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  eventDate: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
  },
  ratingSection: {
    margin: 16,
    marginTop: 8,
    padding: 20,
    backgroundColor: colors.surface,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  ratingLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  starsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 8,
  },
  starButton: {
    padding: 4,
  },
  ratingText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 8,
  },
  recommendSection: {
    margin: 16,
    marginTop: 8,
    padding: 20,
    backgroundColor: colors.surface,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  recommendButtons: {
    flexDirection: 'row',
    gap: 16,
  },
  recommendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    gap: 8,
  },
  recommendButtonSelected: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  recommendButtonSelectedNo: {
    backgroundColor: colors.error,
    borderColor: colors.error,
  },
  recommendButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  recommendButtonTextSelected: {
    color: colors.white,
  },
  commentSection: {
    margin: 16,
    marginTop: 8,
  },
  commentInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 16,
    fontSize: 15,
    color: colors.text,
    minHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
  },
  charCount: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'right',
    marginTop: 4,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    margin: 16,
    marginTop: 8,
    padding: 16,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
    marginLeft: 8,
  },
});
