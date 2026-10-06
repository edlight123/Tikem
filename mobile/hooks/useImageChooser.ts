import { useCallback } from 'react';
import type { ImagePickerAsset } from 'expo-image-picker';
import { useAppAlert } from '../components/AppAlert';
import { useI18n } from '../contexts/I18nContext';
import { AFTER_ALERT_MS } from '../lib/moderationActions';
import { pickProfileImage, ProfileImageError, type ImageSource } from '../lib/profileImages';

/**
 * The "change photo / logo" action sheet: Take photo, Choose from library,
 * Remove (only when there is something to remove), Cancel. The picker opens
 * after the sheet has finished closing: presenting it while the alert modal
 * is still animating out is dropped on iOS.
 */
export function useImageChooser() {
  const showAlert = useAppAlert();
  const { t } = useI18n();

  return useCallback(
    (opts: {
      title: string;
      removeLabel?: string;
      /** Show the Remove action. */
      hasExisting: boolean;
      onPicked: (asset: ImagePickerAsset) => void | Promise<void>;
      onRemove?: () => void | Promise<void>;
    }) => {
      const pick = (source: ImageSource) =>
        setTimeout(async () => {
          try {
            const asset = await pickProfileImage(source);
            if (asset) await opts.onPicked(asset);
          } catch (e: any) {
            const key = e instanceof ProfileImageError ? e.key : null;
            showAlert(t('common.error'), key ? t(key) : e?.message || t('profile.uploads.photoUploadFailed'));
          }
        }, AFTER_ALERT_MS);

      showAlert(opts.title, undefined, [
        { text: t('profile.photo.take'), onPress: () => { pick('camera'); } },
        { text: t('profile.photo.choose'), onPress: () => { pick('library'); } },
        ...(opts.hasExisting && opts.onRemove
          ? [
              {
                text: opts.removeLabel || t('profile.photo.remove'),
                style: 'destructive' as const,
                onPress: () => { void opts.onRemove?.(); },
              },
            ]
          : []),
        { text: t('common.cancel'), style: 'cancel' as const },
      ]);
    },
    [showAlert, t],
  );
}
