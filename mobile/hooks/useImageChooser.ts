import { useCallback } from 'react';
import type { ImagePickerAsset } from 'expo-image-picker';
import { useAppAlert } from '../components/AppAlert';
import { useI18n } from '../contexts/I18nContext';
import { AFTER_ALERT_MS } from '../lib/moderationActions';
import { pickProfileImage, ProfileImageError, type ImageSource } from '../lib/profileImages';
import { useImageCrop } from '../components/ImageCropModal';
import { SQUARE_ASPECT } from '../lib/imageCrop';

/**
 * The "change photo / logo" action sheet: Take photo, Choose from library,
 * Remove (only when there is something to remove), Cancel. The picker opens
 * after the sheet has finished closing: presenting it while the alert modal
 * is still animating out is dropped on iOS.
 *
 * Every pick here is a profile photo or a logo, so it is framed 1:1 after the
 * pick (pinch to zoom, drag to move; components/ImageCropModal) instead of in
 * the OS square editor. Cancelling the framing cancels the change.
 */
export function useImageChooser() {
  const showAlert = useAppAlert();
  const { t } = useI18n();
  const crop = useImageCrop();

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
            let asset = await pickProfileImage(source, { osEditor: false });
            if (!asset) return;
            const framed = await crop(asset, SQUARE_ASPECT);
            if (!framed) return;
            if (framed.cropped) {
              asset = {
                ...asset,
                uri: framed.uri,
                mimeType: 'image/jpeg',
                width: framed.width ?? asset.width,
                height: framed.height ?? asset.height,
                fileSize: undefined,
                fileName: null,
              };
            }
            await opts.onPicked(asset);
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
    [showAlert, t, crop],
  );
}
