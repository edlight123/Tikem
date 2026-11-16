import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
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

import { Touchable } from '../../components/ui/Touchable';
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
        <Touchable
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close" size={28} color={colors.text} />
        </Touchable>
        <Text style={styles.headerTitle}>{t('organizerSendUpdate.headerTitle')}</Text>
        <Touchable
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
        </Touchable>
      </OverlayHeader>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingTop: headerH, paddingBottom: insets.bottom + 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eventLine} numberOfLines={1}>{eventTitle}</Text>

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
          {title.length > 80 ? <Text style={styles.charCount}>{title.length}/100</Text> : <View style={styles.fieldGap} />}

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
          {message.length > 400 ? <Text style={styles.charCount}>{message.length}/500</Text> : <View style={styles.fieldGap} />}
        </View>

        {/* Quick starts as chips (were three bordered cards under an
            "EXAMPLE UPDATES:" eyebrow). One tap fills the title and message. */}
        <View style={styles.examples}>
          {(['venueChange', 'timeUpdate', 'reminder'] as const).map((k) => (
            <Touchable
              key={k}
              style={styles.chip}
              onPress={() => {
                setTitle(t(`organizerSendUpdate.examples.${k}.title`));
                setMessage(t(`organizerSendUpdate.examples.${k}.message`));
              }}
              accessibilityRole="button"
            >
              <Text style={styles.chipText}>{t(`organizerSendUpdate.examples.${k}.cardTitle`)}</Text>
            </Touchable>
          ))}
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
  // The one white primary; a quiet fill until there is something to send.
  sendButton: {
    backgroundColor: colors.white,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    minWidth: 70,
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.surfaceRaised,
  },
  sendButtonText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '700',
  },
  content: {
    flex: 1,
  },
  eventLine: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 22,
    fontSize: 14,
    color: colors.textSecondary,
  },
  fieldGap: { height: 18 },
  form: {
    paddingHorizontal: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  // Fills, not bordered boxes.
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 13,
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 24,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  examplesTitle: {
    fontSize: 13,
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
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  exampleText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
});
