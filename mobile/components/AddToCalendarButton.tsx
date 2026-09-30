import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
    Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { safeFormatForLanguage } from '../lib/dates';
import { useI18n } from '../contexts/I18nContext';
import { radius } from '../theme/tokens';

interface AddToCalendarButtonProps {
  event: {
    id: string;
    title: string;
    description?: string;
    start_datetime: Date | string;
    end_datetime?: Date | string;
    venue_name?: string;
    address?: string;
    city?: string;
  };
  style?: any;
}

export default function AddToCalendarButton({ event, style }: AddToCalendarButtonProps) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { t, language } = useI18n();
  const [showModal, setShowModal] = React.useState(false);

  const startDate = new Date(event.start_datetime);
  const endDate = event.end_datetime ? new Date(event.end_datetime) : new Date(startDate.getTime() + 2 * 60 * 60 * 1000); // Default 2 hours

  const formatDateForCalendar = (date: Date) => {
    return date.toISOString().replace(/-|:|\.\d{3}/g, '');
  };

  const location = [event.venue_name, event.address, event.city].filter(Boolean).join(', ');

  const addToGoogleCalendar = () => {
    const baseUrl = 'https://calendar.google.com/calendar/render';
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: event.title,
      dates: `${formatDateForCalendar(startDate)}/${formatDateForCalendar(endDate)}`,
      details: event.description || '',
      location: location,
      sf: 'true',
    });

    Linking.openURL(`${baseUrl}?${params.toString()}`);
    setShowModal(false);
  };

  const addToOutlookCalendar = () => {
    const baseUrl = 'https://outlook.live.com/calendar/0/deeplink/compose';
    const params = new URLSearchParams({
      subject: event.title,
      startdt: startDate.toISOString(),
      enddt: endDate.toISOString(),
      body: event.description || '',
      location: location,
      path: '/calendar/action/compose',
      rru: 'addevent',
    });

    Linking.openURL(`${baseUrl}?${params.toString()}`);
    setShowModal(false);
  };

  const addToAppleCalendar = () => {
    // Generate ICS file URL from backend
    const baseUrl = process.env.EXPO_PUBLIC_API_URL || process.env.EXPO_PUBLIC_WEB_URL || 'https://www.tikem.co';
    const icsUrl = `${baseUrl}/api/events/${event.id}/calendar`;
    
    Linking.openURL(icsUrl);
    setShowModal(false);
  };

  const calendarOptions = [
    {
      key: 'google',
      label: t('calendar.google') || 'Google Calendar',
      icon: 'logo-google',
      color: '#4285F4',
      onPress: addToGoogleCalendar,
    },
    {
      key: 'outlook',
      label: t('calendar.outlook') || 'Outlook Calendar',
      icon: 'mail',
      color: '#0078D4',
      onPress: addToOutlookCalendar,
    },
    {
      key: 'apple',
      label: t('calendar.apple') || 'Apple Calendar',
      icon: 'logo-apple',
      color: '#000000',
      onPress: addToAppleCalendar,
    },
  ];

  return (
    <>
      <TouchableOpacity 
        style={[styles.button, style]} 
        onPress={() => setShowModal(true)}
      >
        <Text style={styles.buttonText}>{t('calendar.addToCalendar') || 'Add to Calendar'}</Text>
      </TouchableOpacity>

      <Modal
        visible={showModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowModal(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay} 
          activeOpacity={1}
          onPress={() => setShowModal(false)}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('calendar.addToCalendar') || 'Add to Calendar'}</Text>
              <TouchableOpacity onPress={() => setShowModal(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.eventPreview}>{event.title}</Text>
            <Text style={styles.datePreview}>
              {safeFormatForLanguage(startDate, 'EEEE, MMMM dd, yyyy', language)} • {safeFormatForLanguage(startDate, 'h:mm a', language)}
            </Text>

            <View style={styles.optionsContainer}>
              {calendarOptions.map((option) => (
                <TouchableOpacity
                  key={option.key}
                  style={styles.optionButton}
                  onPress={option.onPress}
                >
                  <View style={[styles.optionIcon, { backgroundColor: option.color + '15' }]}>
                    <Ionicons name={option.icon as any} size={24} color={option.color} />
                  </View>
                  <Text style={styles.optionLabel}>{option.label}</Text>
                  <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  // POSH: a quiet secondary — raised surface, hairline border, neutral text.
  // No teal fill/border (teal stays a sparing accent, not a button style).
  // Label-only (no calendar glyph) and squared off to `radius.md`, the radius the
  // other quiet/secondary buttons on the event page use — the softer
  // `radius.button` is reserved for the primary white CTA.
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    paddingHorizontal: 16,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    paddingTop: 20,
    paddingBottom: 40,
    paddingHorizontal: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  eventPreview: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  datePreview: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 20,
  },
  optionsContainer: {
    gap: 8,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
  },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  optionLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
});
