import React, { useState } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Share,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { useAppAlert } from './AppAlert';
import { radius } from '../theme/tokens';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { backendFetch } from '../lib/api/backend';

interface Attendee {
  id: string;
  attendee_name: string;
  attendee_email: string;
  tier_name?: string;
  price_paid?: number;
  purchased_at?: any;
  checked_in_at?: any;
  checked_in?: boolean;
  status?: string;
}

interface ExportAttendeesButtonProps {
  eventId: string;
  attendees: Attendee[];
  style?: any;
}

export default function ExportAttendeesButton({ eventId, attendees, style }: ExportAttendeesButtonProps) {
  const { colors } = useTheme();
  const showAlert = useAppAlert();
  const styles = getStyles(colors);
  const { t, language } = useI18n();
  const [exporting, setExporting] = useState(false);

  const generateCSV = () => {
    // CSV header
    const headers = ['Name', 'Email', 'Ticket Type', 'Price', 'Purchase Date', 'Check-in Status', 'Check-in Time'];
    
    // CSV rows
    const rows = attendees.map(attendee => {
      const purchaseDate = attendee.purchased_at?.toDate 
        ? attendee.purchased_at.toDate().toISOString() 
        : attendee.purchased_at || '';
      
      const isCheckedIn = !!attendee.checked_in_at || attendee.checked_in === true || 
        String(attendee.status || '').toLowerCase() === 'checked_in';
      
      const checkInTime = attendee.checked_in_at?.toDate 
        ? attendee.checked_in_at.toDate().toISOString() 
        : attendee.checked_in_at || '';

      return [
        attendee.attendee_name || '',
        attendee.attendee_email || '',
        attendee.tier_name || 'General',
        attendee.price_paid?.toFixed(2) || '0.00',
        purchaseDate,
        isCheckedIn ? 'Checked In' : 'Not Checked In',
        checkInTime,
      ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  };

  // The branded, printable list (server-rendered: poster, event colour,
  // wordmark, tick boxes). Saved to the cache and handed to the share sheet,
  // where Save to Files / Print / AirDrop / Mail all work.
  const exportPdf = async () => {
    setExporting(true);
    try {
      const res = await backendFetch(
        `/api/organizer/events/${encodeURIComponent(eventId)}/attendees/pdf?lang=${encodeURIComponent(language)}`
      );
      if (!res.ok) throw new Error(`pdf_${res.status}`);
      const blob = await res.blob();
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('read_failed'));
        reader.readAsDataURL(blob);
      });
      const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const fileUri = `${FileSystem.cacheDirectory}attendees-${eventId}.pdf`;
      await FileSystem.writeAsStringAsync(fileUri, b64, { encoding: 'base64' });
      await Sharing.shareAsync(fileUri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
    } catch (error) {
      console.error('Error exporting attendee PDF:', error);
      showAlert(t('common.error'), t('export.error') || 'Failed to export attendees');
    } finally {
      setExporting(false);
    }
  };

  const chooseFormat = () => {
    if (attendees.length === 0) {
      showAlert(t('common.info') || 'Info', t('export.noAttendees') || 'No attendees to export');
      return;
    }
    showAlert(t('export.title'), '', [
      { text: t('export.pdf'), onPress: exportPdf },
      { text: t('export.csv'), onPress: handleExport },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const handleExport = async () => {
    if (attendees.length === 0) {
      showAlert(
        t('common.info') || 'Info',
        t('export.noAttendees') || 'No attendees to export'
      );
      return;
    }

    setExporting(true);
    try {
      const csvData = generateCSV();
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `attendees_${timestamp}.csv`;

      if (Platform.OS === 'web') {
        // Web: Download directly
        const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showAlert(t('common.success'), t('export.downloadStarted') || 'Download started');
      } else {
        // Mobile: Share the CSV content via Share API
        await Share.share({
          message: csvData,
          title: filename,
        });
      }
    } catch (error: any) {
      console.error('Error exporting attendees:', error);
      showAlert(
        t('common.error'),
        error.message || t('export.error') || 'Failed to export attendees'
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.button, style]}
      onPress={chooseFormat}
      disabled={exporting}
      accessibilityRole="button"
      accessibilityLabel={t('export.title')}
    >
      {exporting ? (
        <ActivityIndicator size="small" color={colors.text} />
      ) : (
        <>
          <Ionicons name="download-outline" size={16} color={colors.text} />
          <Text style={styles.buttonText}>{t('export.short')}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // Quiet raised fill, not a teal outlined box (fill-not-hairline rule;
    // owner, 2026-11-16). "CSV" alone — the download glyph says "export".
    height: 36,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    gap: 6,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
});
