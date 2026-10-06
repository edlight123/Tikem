import React, { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth } from '../config/firebase';
import { useI18n } from '../contexts/I18nContext';
import PhoneLinkSheet from './auth/PhoneLinkSheet';
import { setPhonePromptHandler, usePhonePromptAvailable, type PhonePromptRequest } from '../lib/phonePrompt';
import {
  parsePhonePromptState,
  phonePromptStorageKey,
  recordPhonePromptShown,
  shouldShowPhonePrompt,
} from '../lib/phonePromptPolicy';

/**
 * The one "add your number" sheet, mounted at the app root (App.tsx). Screens
 * call requestPhonePrompt(); this applies the re-ask policy against the
 * per-account counter in AsyncStorage and shows PhoneLinkSheet with the
 * prompt's copy and a "Not now".
 */
export default function PhonePromptHost() {
  const { t } = useI18n();
  const available = usePhonePromptAvailable();
  const availableRef = useRef(available);
  availableRef.current = available;
  const [request, setRequest] = useState<PhonePromptRequest | null>(null);

  useEffect(() => {
    setPhonePromptHandler(async (req) => {
      const current = auth.currentUser;
      const uid = current?.uid;
      if (!uid) return;
      const key = phonePromptStorageKey(uid);
      let raw: string | null = null;
      try {
        raw = await AsyncStorage.getItem(key);
      } catch {
        // Unreadable storage: treat as a fresh state; the cap still applies from here on.
      }
      const state = parsePhonePromptState(raw);
      const now = Date.now();
      const show = shouldShowPhonePrompt({
        flagOn: availableRef.current,
        signedIn: true,
        hasVerifiedPhone: !!current?.phoneNumber,
        trigger: req.trigger,
        state,
        now,
      });
      if (!show) return;
      // A purchase confirmation sheet is closing as this fires; iOS will not
      // present a second modal mid-dismissal, so give it a beat.
      if (req.trigger === 'post_purchase') await new Promise((r) => setTimeout(r, 600));
      // Count it when shown, not when dismissed: closing the app mid-sheet
      // must not earn another ask.
      AsyncStorage.setItem(key, JSON.stringify(recordPhonePromptShown(state, req.trigger, now))).catch(() => {});
      setRequest(req);
    });
    return () => setPhonePromptHandler(null);
  }, []);

  if (!request) return null;

  return (
    <PhoneLinkSheet
      visible
      title={t('phonePrompt.title')}
      subtitle={t('phonePrompt.valueProp')}
      skipLabel={t('phonePrompt.skip')}
      onClose={() => setRequest(null)}
      onLinked={() => {
        const done = request.onLinked;
        // Let the sheet show its success line, then hand back to the caller.
        setTimeout(() => {
          setRequest(null);
          done?.();
        }, 1200);
      }}
    />
  );
}
