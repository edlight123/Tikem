import React, { useState } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { useAppAlert } from './AppAlert';
import { radius } from '../theme/tokens';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { backendFetch } from '../lib/api/backend';

/**
 * Export the attendee list as a file in the share sheet (Save to Files,
 * Print, AirDrop, Mail). Both formats are rendered by the server, so the app
 * and the web hand out the same files (owner, 2026-11-16: Excel + PDF, no CSV):
 *   - PDF: the branded, printable door sheet (poster, event colour, wordmark,
 *     tick boxes);
 *   - Excel: the full list, typed and sortable, refunds included with their state.
 */
type Format = 'pdf' | 'xlsx';

const FORMATS: Record<Format, { path: (id: string) => string; mimeType: string; UTI: string; fallback: string }> = {
  pdf: {
    path: (id) => `/api/organizer/events/${encodeURIComponent(id)}/attendees/pdf`,
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    fallback: 'Attendees.pdf',
  },
  xlsx: {
    path: (id) => `/api/organizer/events/${encodeURIComponent(id)}/export-attendees?format=xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    UTI: 'org.openxmlformats.spreadsheetml.sheet',
    fallback: 'Attendees.xlsx',
  },
};

interface ExportAttendeesButtonProps {
  eventId: string;
  /** Only its length is read: an empty list shows a notice instead of exporting. */
  attendees: ReadonlyArray<unknown>;
  style?: any;
}

/** The filename from a Content-Disposition header (RFC 6266), preferring filename*. */
function fileNameFrom(header: string | null, format: Format): string {
  const h = header || '';
  let name = '';
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(h);
  if (star) {
    try {
      name = decodeURIComponent(star[1].trim());
    } catch {
      name = '';
    }
  }
  if (!name) {
    const plain = /filename\s*=\s*"([^"]+)"/.exec(h) || /filename\s*=\s*([^;]+)/.exec(h);
    name = plain ? plain[1].trim() : '';
  }
  name = name.replace(/[\u0000-\u001f/\\:*?"<>|]+/g, ' ').trim();
  if (!name) return FORMATS[format].fallback;
  return name.toLowerCase().endsWith(`.${format}`) ? name : `${name}.${format}`;
}

export default function ExportAttendeesButton({ eventId, attendees, style }: ExportAttendeesButtonProps) {
  const { colors } = useTheme();
  const showAlert = useAppAlert();
  const styles = getStyles(colors);
  const { t, language } = useI18n();
  const [exporting, setExporting] = useState(false);

  // Fetch the server-rendered file, save it to the cache under the server's
  // readable name ("Event – Attendees – 2026-12-31.xlsx") and hand it to the
  // share sheet. Each export gets its own folder so the name can stay clean
  // without colliding with an earlier export.
  const exportFile = async (format: Format) => {
    const spec = FORMATS[format];
    setExporting(true);
    try {
      const sep = spec.path(eventId).includes('?') ? '&' : '?';
      const res = await backendFetch(`${spec.path(eventId)}${sep}lang=${encodeURIComponent(language)}`);
      if (!res.ok) throw new Error(`${format}_${res.status}`);
      const blob = await res.blob();
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('read_failed'));
        reader.readAsDataURL(blob);
      });
      const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const fileName = fileNameFrom(res.headers.get('content-disposition'), format);
      const dir = `${FileSystem.cacheDirectory}attendee-exports/${Date.now()}/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const fileUri = dir + encodeURIComponent(fileName);
      await FileSystem.writeAsStringAsync(fileUri, b64, { encoding: 'base64' });
      await Sharing.shareAsync(fileUri, { mimeType: spec.mimeType, UTI: spec.UTI });
    } catch (error) {
      console.error(`Error exporting attendee ${format}:`, error);
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
      { text: t('export.pdf'), onPress: () => exportFile('pdf') },
      { text: t('export.excel'), onPress: () => exportFile('xlsx') },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
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
    // owner, 2026-11-16). The download glyph says "export".
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
