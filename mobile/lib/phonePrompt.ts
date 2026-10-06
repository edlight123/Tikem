/**
 * The "add your number" prompt: a tiny request bus between the screens that
 * may want it (a ticket just landed, "find friends from contacts") and the one
 * PhonePromptHost mounted at the app root, which owns the sheet and the
 * re-ask policy (lib/phonePromptPolicy.ts). The host lives at the root so the
 * sheet survives the navigation that follows a purchase.
 *
 * Gated by BOTH config/auth.phone_link_prompt (lib/socialFlags.ts) and the
 * phone-auth switch (lib/phoneAuth.ts: config/auth.phone_whatsapp AND the
 * server answering that the WhatsApp routes are live). With either off, or
 * Twilio not configured server-side, nothing is ever shown.
 */

import { useAuth } from '../contexts/AuthContext';
import { usePhoneAuthEnabled } from './phoneAuth';
import { useSocialFlags } from './socialFlags';
import type { PhonePromptTrigger } from './phonePromptPolicy';

export interface PhonePromptRequest {
  trigger: PhonePromptTrigger;
  /** Called once the number is verified and linked. */
  onLinked?: () => void;
}

type Handler = (req: PhonePromptRequest) => void;
let handler: Handler | null = null;

/** Host registration (PhonePromptHost). One host at a time. */
export function setPhonePromptHandler(next: Handler | null): void {
  handler = next;
}

/** Ask the host to show the sheet. The host applies the policy; may do nothing. */
export function requestPhonePrompt(req: PhonePromptRequest): void {
  try {
    handler?.(req);
  } catch {
    // Never let a prompt break the flow that asked for it.
  }
}

/**
 * Can the sheet be offered at all right now (switches on, signed in, no
 * verified phone yet)? Callers that NEED a phone ("find friends from
 * contacts") route through the sheet only when this is true and otherwise
 * carry on as before.
 */
export function usePhonePromptAvailable(): boolean {
  const { user } = useAuth();
  const flags = useSocialFlags();
  const phoneAuthOn = usePhoneAuthEnabled();
  return flags.phoneLinkPrompt && phoneAuthOn && !!user && !user.phoneNumber;
}
