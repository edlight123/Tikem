import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { backendJson } from '../lib/api/backend';
import { radius, spacing } from '../theme/tokens';

/** Mirrors the server's TOPICS union — anything else is rejected by the route. */
const TOPICS = ['event', 'ticket', 'other'] as const;
type Topic = (typeof TOPICS)[number];

const MAX_MESSAGE_LENGTH = 1000;

interface ContactOrganizerModalProps {
  visible: boolean;
  onClose: () => void;
  eventId: string;
  eventTitle?: string;
}

/**
 * "Contact the organizer about ___" — a topic picker plus a free-text message.
 * The message goes to the organizer's in-app inbox; neither side's email
 * address is revealed to the other, which is why this posts to our own route
 * rather than opening a mailto: link.
 */
export default function ContactOrganizerModal({
  visible,
  onClose,
  eventId,
  eventTitle,
}: ContactOrganizerModalProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();

  const [topic, setTopic] = useState<Topic>('event');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  // Reopening after a send should present a blank form, not the old success
  // state or a stale error from last time.
  useEffect(() => {
    if (visible) {
      setTopic('event');
      setMessage('');
      setError('');
      setSent(false);
      setLoading(false);
    }
  }, [visible]);

  const canSend = message.trim().length > 0 && !loading;

  const handleSend = async () => {
    if (!canSend) return;
    setLoading(true);
    setError('');
    try {
      await backendJson('/api/events/contact-organizer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, topic, message: message.trim() }),
      });
      setSent(true);
    } catch (e: any) {
      setError(e?.message || t('contactOrganizer.errorGeneric'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
        >
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
            {/* Paints below the sheet's edge. On device the sheet stopped short
                of the screen bottom and the page's "Event Ended" bar showed
                through the gap; whatever opens that gap, the fill covers it. */}
            <View pointerEvents="none" style={styles.bottomFill} />
            <View style={styles.grabber} />

            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={2}>
                  {(sent ? t('contactOrganizer.sentTitle') : t('contactOrganizer.title')).toLowerCase()}
                </Text>
                {!sent && !!eventTitle && (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {t('contactOrganizer.aboutEvent').replace('{event}', eventTitle)}
                  </Text>
                )}
              </View>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={styles.close}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <X size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            {sent ? (
              <View style={styles.sentBody}>
                <Text style={styles.sentText}>
                  {eventTitle
                    ? t('contactOrganizer.sentBodyNamed').replace('{event}', eventTitle)
                    : t('contactOrganizer.sentBody')}
                </Text>
                <TouchableOpacity style={styles.submit} onPress={onClose}>
                  <Text style={styles.submitText}>{t('common.done')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              // A plain View, not a ScrollView: the form is short, and inside this
              // auto-height sheet the ScrollView collapsed. Its content drew past
              // its bounds, so the topic chips ignored taps and the Send button
              // was clipped off entirely (seen in the simulator).
              <View>
                <Text style={styles.fieldLabel}>{t('contactOrganizer.topicLabel')}</Text>
                <View style={styles.segment} accessibilityRole="radiogroup">
                  {TOPICS.map((key) => {
                    const selected = topic === key;
                    return (
                      <TouchableOpacity
                        key={key}
                        style={[styles.segmentItem, selected && styles.segmentItemOn]}
                        onPress={() => setTopic(key)}
                        activeOpacity={0.8}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                      >
                        <Text
                          style={[styles.segmentText, selected && styles.segmentTextOn]}
                          numberOfLines={1}
                        >
                          {t(`contactOrganizer.topics.${key}`)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TextInput
                  style={styles.input}
                  value={message}
                  onChangeText={(v) => setMessage(v.slice(0, MAX_MESSAGE_LENGTH))}
                  placeholder={t('contactOrganizer.messagePlaceholder')}
                  placeholderTextColor={colors.textTertiary || colors.textSecondary}
                  selectionColor={colors.primary}
                  multiline
                  textAlignVertical="top"
                  maxLength={MAX_MESSAGE_LENGTH}
                  editable={!loading}
                />
                <Text style={styles.counter}>
                  {message.length}/{MAX_MESSAGE_LENGTH}
                </Text>

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <TouchableOpacity
                  style={[styles.submit, !canSend && styles.submitDisabled]}
                  onPress={handleSend}
                  disabled={!canSend}
                  accessibilityRole="button"
                >
                  {loading ? (
                    <ActivityIndicator color="#000000" />
                  ) : (
                    <Text style={[styles.submitText, !canSend && styles.submitTextDisabled]}>
                      {t('contactOrganizer.send')}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'flex-end',
    },
    sheetWrap: {
      width: '100%',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 20,
      maxHeight: '88%',
    },
    bottomFill: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: '100%',
      height: 400,
      backgroundColor: colors.surface,
    },
    grabber: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.surfaceRaised,
      marginTop: 10,
      marginBottom: 14,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: spacing.lg,
      marginBottom: 22,
    },
    // Editorial sheet title, lowercased at the call site (house voice).
    title: {
      fontFamily: 'InstrumentSerif_400Regular',
      fontSize: 30,
      lineHeight: 34,
      color: colors.text,
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSecondary,
      marginTop: 4,
    },
    close: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: 10,
    },
    // Three filled chips; the chosen one inverts to white (same language as
    // the white primary pill), no radio circles, no outlines.
    segment: {
      flexDirection: 'row',
      gap: 8,
    },
    segmentItem: {
      flex: 1,
      height: 40,
      borderRadius: radius.chip,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
    },
    segmentItemOn: {
      backgroundColor: colors.white,
    },
    segmentText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
    segmentTextOn: {
      color: '#000000',
    },
    input: {
      marginTop: 18,
      minHeight: 132,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
      padding: spacing.lg,
      paddingTop: spacing.lg,
      fontSize: 16,
      lineHeight: 22,
      color: colors.text,
    },
    counter: {
      alignSelf: 'flex-end',
      marginTop: 6,
      fontSize: 12,
      color: colors.textTertiary || colors.textSecondary,
    },
    error: {
      marginTop: spacing.md,
      fontSize: 14,
      color: colors.error,
    },
    submit: {
      marginTop: 20,
      height: 54,
      borderRadius: radius.button,
      backgroundColor: colors.white,
      alignItems: 'center',
      justifyContent: 'center',
    },
    submitDisabled: {
      backgroundColor: colors.surfaceRaised,
    },
    submitText: {
      fontSize: 16,
      fontWeight: '700',
      color: '#000000',
    },
    submitTextDisabled: {
      color: colors.textTertiary || colors.textSecondary,
    },
    sentBody: {
      paddingBottom: spacing.md,
    },
    sentText: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
    },
  });
