/**
 * Profile > "Host events on Tikèm": the one compact step that opens organizer
 * mode, the app's twin of the website's "create your organization"
 * (app/organizer/OrganizerUpgradePrompt.tsx). Everything is optional: the
 * organization's name, one line about it, a website, Instagram and Facebook.
 * The server keeps the links as https URLs only (lib/organizer/links.ts) and
 * the rest can be changed later in Edit profile.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import FormSheet, { SheetInput, SheetLabel } from './organizer/FormSheet';
import WhitePillCTA from './WhitePillCTA';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import { backendJson } from '../lib/api/backend';

export default function HostSetupSheet({
  visible,
  initialName,
  onClose,
  onDone,
}: {
  visible: boolean;
  initialName?: string;
  onClose: () => void;
  /** Organizer access is on: refresh the profile and switch mode. */
  onDone: () => void | Promise<void>;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [name, setName] = useState(initialName || '');
  const [line, setLine] = useState('');
  const [website, setWebsite] = useState('');
  const [instagram, setInstagram] = useState('');
  const [facebook, setFacebook] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setError(null);
  }, [visible]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await backendJson('/api/account/become-organizer', {
        method: 'POST',
        body: JSON.stringify({
          organizationName: name.trim(),
          description: line.trim(),
          website: website.trim(),
          instagram: instagram.trim(),
          facebook: facebook.trim(),
        }),
      });
      await onDone();
    } catch (e) {
      console.warn('become-organizer failed', e);
      setError(t('profile.hostEvents.failed'));
    } finally {
      setBusy(false);
    }
  };

  const linkProps = { autoCapitalize: 'none' as const, autoCorrect: false };

  return (
    <FormSheet
      visible={visible}
      title={t('orgPage.setupTitle')}
      onClose={onClose}
      closeLabel={t('common.close')}
      busy={busy}
      footer={
        <>
          {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}
          <WhitePillCTA size="sm" label={t('profile.hostEvents.cta')} onPress={submit} loading={busy} />
        </>
      }
    >
      <SheetLabel>{t('orgPage.nameLabel')}</SheetLabel>
      <SheetInput value={name} onChangeText={setName} placeholder={t('orgPage.namePlaceholder')} maxLength={80} />

      <SheetLabel>{t('orgPage.oneLineLabel')}</SheetLabel>
      <SheetInput value={line} onChangeText={setLine} placeholder={t('orgPage.oneLinePlaceholder')} maxLength={300} />

      <SheetLabel>{t('orgPage.linksLabel')}</SheetLabel>
      <SheetInput
        value={website}
        onChangeText={setWebsite}
        placeholder={t('orgPage.websitePlaceholder')}
        keyboardType="url"
        {...linkProps}
      />
      <SheetInput value={instagram} onChangeText={setInstagram} placeholder="@instagram" style={styles.stacked} {...linkProps} />
      <SheetInput
        value={facebook}
        onChangeText={setFacebook}
        placeholder="facebook.com/yourpage"
        keyboardType="url"
        style={styles.stacked}
        {...linkProps}
      />
      <Text style={[styles.note, { color: colors.textTertiary }]}>{t('orgPage.setupNote')}</Text>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  stacked: { marginTop: 8 },
  note: { marginTop: 12, fontSize: 12, lineHeight: 16 },
  error: { fontSize: 13, textAlign: 'center' },
});
