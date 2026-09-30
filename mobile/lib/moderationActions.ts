import type { AppAlertButton } from '../components/AppAlert';
import { setOrganizerBlocked } from './blockedOrganizers';

type ShowAlert = (title: string, message?: string, buttons?: AppAlertButton[]) => void;
type T = (key: string) => string;

/**
 * Confirm, then block or unblock an organizer (App Store guideline 1.2).
 * The block is optimistic (lib/blockedOrganizers), so the organizer's events
 * leave every feed the moment the user confirms.
 */
export function promptBlockToggle(params: {
  showAlert: ShowAlert;
  t: T;
  organizerId: string;
  organizerName: string;
  currentlyBlocked: boolean;
  onChanged?: (blocked: boolean) => void;
}) {
  const { showAlert, t, organizerId, organizerName, currentlyBlocked, onChanged } = params;
  const name = organizerName || t('moderation.thisOrganizer');
  const block = !currentlyBlocked;
  showAlert(
    (block ? t('moderation.blockConfirmTitle') : t('moderation.unblockConfirmTitle')).replace('{name}', name),
    block ? t('moderation.blockConfirmBody') : t('moderation.unblockConfirmBody'),
    [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: block ? t('moderation.block') : t('moderation.unblock'),
        style: block ? 'destructive' : 'default',
        onPress: async () => {
          try {
            await setOrganizerBlocked(organizerId, block);
            onChanged?.(block);
            showAlert(
              block ? t('moderation.blockedToast') : t('moderation.unblockedToast'),
              block ? t('moderation.blockedToastBody') : undefined
            );
          } catch {
            showAlert(t('common.error'), t('moderation.errors.generic'));
          }
        },
      },
    ]
  );
}

/** Opening a sheet right as the alert modal fades out can drop it on iOS. */
export const AFTER_ALERT_MS = 350;
