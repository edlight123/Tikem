import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from 'react-native';
import { radius, font } from '../../theme/tokens';
import { useAppAlert } from '../../components/AppAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { useTheme } from '../../contexts/ThemeContext';
import { backendJson } from '../../lib/api/backend';
import { useI18n } from '../../contexts/I18nContext';
import InfoNotice from '../../components/organizer/InfoNotice';
import OverlayHeader, { useOverlayHeaderInset } from '../../components/OverlayHeader';

type RouteParams = {
  SendEventUpdate: {
    eventId: string;
    eventTitle: string;
  };
};

export default function SendEventUpdateScreen() {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);
  const route = useRoute<RouteProp<RouteParams, 'SendEventUpdate'>>();
  const navigation = useNavigation();
  const { eventId, eventTitle } = route.params;

  const { t } = useI18n();
  const showAlert = useAppAlert();
  const insets = useSafeAreaInsets();
  const { height: headerH, onHeight } = useOverlayHeaderInset();

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!title.trim()) {
      showAlert(t('common.error'), t('organizerSendUpdate.errors.missingTitle'));
      return;
    }

    if (!message.trim()) {
      showAlert(t('common.error'), t('organizerSendUpdate.errors.missingMessage'));
      return;
    }

    showAlert(
      t('organizerSendUpdate.confirm.title'),
      t('organizerSendUpdate.confirm.body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.send'),
          onPress: async () => {
            setSending(true);
            try {
              // Server-side (Admin SDK): writes the event_update and fans out
              // notifications to attendees. Doing this client-side used to require
              // an open cross-user notification-write rule (audit M4).
              const { notified } = await backendJson<{ success: boolean; notified: number }>(
                '/api/organizer/event-update',
                {
                  method: 'POST',
                  body: JSON.stringify({
                    eventId,
                    title: title.trim(),
                    message: message.trim(),
                  }),
                }
              );

              showAlert(
                t('common.success'),
                notified === 1
                  ? t('organizerSendUpdate.success.bodySingular')
                  : `${t('organizerSendUpdate.success.bodyPluralPrefix')}${notified}${t('organizerSendUpdate.success.bodyPluralSuffix')}`,
                [
                  {
                    text: t('common.ok'),
                    onPress: () => navigation.goBack(),
                  },
                ]
              );
            } catch (error: any) {
              console.error('Error sending update:', error);
              showAlert(t('common.error'), t('organizerSendUpdate.errors.sendFailed'));
            } finally {
              setSending(false);
            }
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={isDark ? colors.surface : colors.white} />

      <OverlayHeader style={styles.header} onHeight={onHeight}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('organizerSendUpdate.headerTitle')}</Text>
        <TouchableOpacity
          onPress={handleSend}
          disabled={sending || !title.trim() || !message.trim()}
          style={[
            styles.sendButton,
            (sending || !title.trim() || !message.trim()) && styles.sendButtonDisabled,
          ]}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Text style={styles.sendButtonText}>{t('common.send')}</Text>
          )}
        </TouchableOpacity>
      </OverlayHeader>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingTop: headerH, paddingBottom: insets.bottom + 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.eventInfoWrap}>
          <InfoNotice icon="calendar-outline" text={eventTitle} />
        </View>

        <View style={styles.infoWrap}>
          <InfoNotice text={t('organizerSendUpdate.infoText')} />
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>{t('organizerSendUpdate.fields.titleLabel')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('organizerSendUpdate.fields.titlePlaceholder')}
            value={title}
            onChangeText={setTitle}
            maxLength={100}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.primary}
          />
          <Text style={styles.charCount}>{title.length}/100</Text>

          <Text style={styles.label}>{t('organizerSendUpdate.fields.messageLabel')}</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder={t('organizerSendUpdate.fields.messagePlaceholder')}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={10}
            textAlignVertical="top"
            maxLength={500}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.primary}
          />
          <Text style={styles.charCount}>{message.length}/500</Text>
        </View>

        <View style={styles.examples}>
          <Text style={styles.examplesTitle}>{t('organizerSendUpdate.examplesTitle')}</Text>
          <TouchableOpacity
            style={styles.exampleCard}
            onPress={() => {
              setTitle(t('organizerSendUpdate.examples.venueChange.title'));
              setMessage(
                t('organizerSendUpdate.examples.venueChange.message')
              );
            }}
          >
            <Text style={styles.exampleTitle}>{t('organizerSendUpdate.examples.venueChange.cardTitle')}</Text>
            <Text style={styles.exampleText} numberOfLines={2}>
              {t('organizerSendUpdate.examples.venueChange.cardPreview')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.exampleCard}
            onPress={() => {
              setTitle(t('organizerSendUpdate.examples.timeUpdate.title'));
              setMessage(t('organizerSendUpdate.examples.timeUpdate.message'));
            }}
          >
            <Text style={styles.exampleTitle}>{t('organizerSendUpdate.examples.timeUpdate.cardTitle')}</Text>
            <Text style={styles.exampleText} numberOfLines={2}>
              {t('organizerSendUpdate.examples.timeUpdate.cardPreview')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.exampleCard}
            onPress={() => {
              setTitle(t('organizerSendUpdate.examples.reminder.title'));
              setMessage(
                t('organizerSendUpdate.examples.reminder.message')
              );
            }}
          >
            <Text style={styles.exampleTitle}>{t('organizerSendUpdate.examples.reminder.cardTitle')}</Text>
            <Text style={styles.exampleText} numberOfLines={2}>
              {t('organizerSendUpdate.examples.reminder.cardPreview')}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // Overlay chrome: OverlayHeader supplies the absolute positioning, the
  // safe-area top padding and the ChromeBlur backdrop, so this style carries
  // only the row's own geometry — no fill and no hairline.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 22,
    fontFamily: font.serif,
    letterSpacing: 0,
    color: colors.text,
    // No marginLeft: OverlayHeader's row already puts a 12pt gap between the
    // close button and the title.
  },
  sendButton: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    minWidth: 70,
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.border,
    borderColor: colors.border,
  },
  sendButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  eventInfoWrap: {
    marginHorizontal: 16,
    marginTop: 16,
  },
  infoWrap: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 24,
  },
  form: {
    paddingHorizontal: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: 12,
    fontSize: 16,
    color: colors.text,
  },
  textArea: {
    height: 120,
    paddingTop: 12,
  },
  charCount: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 20,
  },
  examples: {
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  examplesTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  exampleCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  exampleTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  exampleText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
});
