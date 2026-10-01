import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User, onAuthStateChanged, signInWithEmailAndPassword, signOut as firebaseSignOut, createUserWithEmailAndPassword, GoogleAuthProvider, OAuthProvider, signInWithCredential, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, isDemoMode } from '../config/firebase';
import { syncPublicProfile } from '../lib/publicProfile';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { makeRedirectUri } from 'expo-auth-session';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import type { SocialLinks, PrivacySettings } from '../types/social';

WebBrowser.maybeCompleteAuthSession();

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: 'attendee' | 'organizer' | 'admin';
  phone_number?: string;
  default_city?: string;
  default_country?: string; // Country code: HT, US, CA, FR, DO
  default_subarea?: string; // State/region within country
  is_verified?: boolean;
  photo_url?: string;
  bio?: string;
  // Organizer brand identity — shown wherever the organizer is displayed, in
  // place of the personal full_name (and organization_logo for the avatar).
  organization_name?: string;
  organization_logo?: string;
  social_links?: SocialLinks;
  privacy?: PrivacySettings;
}

type UserProfilePatch = Partial<Pick<UserProfile, 'full_name' | 'phone_number' | 'default_city' | 'default_country' | 'default_subarea' | 'photo_url' | 'organization_name' | 'organization_logo'>>;

interface AuthContextType {
  user: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  appleAuthAvailable: boolean;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Which sign-in method re-authentication will use for the current user. */
  reauthMethod: () => 'password' | 'google' | 'apple' | null;
  /**
   * Prove it is still the account holder (refreshes the token's auth_time) —
   * required before account deletion. Password users pass their password;
   * Google/Apple users re-run the provider sheet. Never switches accounts:
   * Firebase rejects a credential for a different user (auth/user-mismatch).
   */
  reauthenticate: (password?: string) => Promise<void>;
  refreshUserProfile: () => Promise<void>;
  updateUserProfile: (patch: UserProfilePatch) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [appleAuthAvailable, setAppleAuthAvailable] = useState(false);

  // Apple Sign-In is iOS-only and requires the native module (present after a
  // dev/EAS build). Guard so the button only appears where it can work.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (Platform.OS !== 'ios') return;
        const available = await AppleAuthentication.isAvailableAsync();
        if (active) setAppleAuthAvailable(available);
      } catch {
        // Native module not in the current build yet — hide the button.
        if (active) setAppleAuthAvailable(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const refreshUserProfile = async (uid?: string) => {
    const userId = uid || user?.uid;
    if (!userId) return;

    // Demo mode: keep the mock profile in sync.
    if (isDemoMode) {
      setUserProfile((prev) => (prev ? { ...prev } : prev));
      return;
    }

    try {
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) {
        setUserProfile({ id: userId, ...(userDoc.data() as Omit<UserProfile, 'id'>) });
      }
    } catch (error) {
      console.error('[Auth] Error refreshing user profile:', error);
    }
  };

  const updateUserProfile = async (patch: UserProfilePatch) => {
    if (!user?.uid) throw new Error('Not signed in');

    const trimmed: any = {
      ...patch,
      updated_at: new Date().toISOString(),
    };

    if (typeof trimmed.full_name === 'string') trimmed.full_name = trimmed.full_name.trim();
    if (typeof trimmed.default_city === 'string') trimmed.default_city = trimmed.default_city.trim();
    if (typeof trimmed.organization_name === 'string') trimmed.organization_name = trimmed.organization_name.trim();
    if (typeof trimmed.organization_logo === 'string') trimmed.organization_logo = trimmed.organization_logo.trim();
    if (typeof trimmed.phone_number === 'string') {
      const p = trimmed.phone_number.trim();
      trimmed.phone_number = p.length ? p : null;
    }

    if (isDemoMode) {
      setUserProfile((prev) => (prev ? ({ ...prev, ...(trimmed as any) } as any) : prev));
      return;
    }

    await setDoc(doc(db, 'users', user.uid), trimmed, { merge: true });
    // H4: keep the cross-user-readable projection in sync (best-effort).
    await syncPublicProfile(user.uid, trimmed);
    await refreshUserProfile(user.uid);
  };

  // Configure Google Sign-In with proper redirect URI
  // Use reverse client ID format that Google accepts.
  // When no client ID is configured (e.g. local dev / UX review builds), fall
  // back to a harmless placeholder so the auth hook can construct a request
  // instead of throwing and crashing the whole app at render. `googleConfigured`
  // gates the actual sign-in so an unconfigured build fails loudly on tap only.
  const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const googleConfigured = !!googleWebClientId;
  const GOOGLE_PLACEHOLDER_CLIENT_ID = 'unconfigured.apps.googleusercontent.com';
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: googleWebClientId || GOOGLE_PLACEHOLDER_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || googleWebClientId || GOOGLE_PLACEHOLDER_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || googleWebClientId || GOOGLE_PLACEHOLDER_CLIENT_ID,
    // Expo handles the redirect automatically in production builds
  });

  // A Google response produced by a re-authentication belongs to it — the
  // sign-in effect below must never also sign in with it (a different account
  // picked in the sheet would otherwise switch the session). The flag covers the
  // prompt while open; the consumed id_token covers the effect firing after it.
  const googleReauthInFlight = useRef(false);
  const googleReauthIdToken = useRef<string | null>(null);

  // Handle Google Sign-In response
  useEffect(() => {
    if (googleReauthInFlight.current) return;
    if (response?.type === 'success' && (response as any).params?.id_token === googleReauthIdToken.current) return;
    if (response?.type === 'success') {
      const { id_token } = response.params;
      handleGoogleSignInSuccess(id_token);
    }
  }, [response]);

  useEffect(() => {
    // Demo mode: Auto-login without Firebase
    if (isDemoMode) {
      console.log('[Auth] Demo mode enabled - skipping Firebase');
      // Create a mock user
      const demoUser = {
        uid: 'demo-user-123',
        email: 'demo@tikem.co',
        displayName: 'Demo User',
      } as User;
      
      setUser(demoUser);
      setUserProfile({
        id: 'demo-user-123',
        email: 'demo@tikem.co',
        full_name: 'Demo User',
        role: 'attendee',
      });
      setLoading(false);
      return;
    }

    // Belt-and-suspenders against a splash lock: onAuthStateChanged fires within
    // a moment on cold start (the session is restored from AsyncStorage — no
    // network needed), which flips `loading` false. But if the SDK ever stalls
    // on a rare offline-init edge case, this fallback guarantees the app still
    // leaves the branded boot screen instead of locking on it forever. Whichever
    // happens first wins; the other is a no-op.
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      setLoading(false);
    };
    const bootTimeout = setTimeout(settle, 6000);

    // Production mode: Use Firebase
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        // Refresh the profile in the BACKGROUND — do NOT await it here. Offline,
        // a cold-start getDoc can stall on Firestore's connection attempt, and
        // awaiting it would leave `loading` true forever, so the app hangs on
        // the splash and never launches with no internet. refreshUserProfile
        // has its own try/catch and updates state when it resolves (cache or
        // server). The app renders immediately either way.
        refreshUserProfile(firebaseUser.uid);
      } else {
        setUserProfile(null);
      }

      clearTimeout(bootTimeout);
      settle();
    });

    return () => {
      clearTimeout(bootTimeout);
      unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const handleGoogleSignInSuccess = async (idToken: string) => {
    try {
      // Create Firebase credential with Google ID token
      const credential = GoogleAuthProvider.credential(idToken);
      
      // Sign in to Firebase
      const userCredential = await signInWithCredential(auth, credential);
      const user = userCredential.user;

      // Check if user document exists, if not create it
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        const newUserDoc = {
          email: user.email,
          full_name: user.displayName || '',
          role: 'attendee',
          is_verified: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        await setDoc(userDocRef, newUserDoc);
        // H4: seed the cross-user-readable projection (best-effort; PII stripped).
        await syncPublicProfile(user.uid, newUserDoc);
      }
    } catch (error: any) {
      console.error('Google Sign-In error:', error);
      throw error;
    }
  };

  /**
   * Android: native Google Sign-In. Google no longer allows custom-URI-scheme
   * redirects on Android OAuth clients, so the browser flow (expo-auth-session)
   * can't complete there. The native picker verifies package + signing SHA-1
   * against the Android OAuth clients in the event-haiti project and returns an
   * ID token minted for the WEB client, which is what Firebase expects.
   * Resolves null when the user closes the picker.
   */
  const nativeGoogleIdToken = async (): Promise<string | null> => {
    // Required lazily, on Android only: importing it at the top would throw at
    // launch in any binary without the native module — iOS builds made before
    // it was added (which still receive OTA updates for the same app version)
    // and Expo Go.
    const { GoogleSignin, isSuccessResponse } =
      require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
    GoogleSignin.configure({ webClientId: googleWebClientId });
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Always show the account chooser, so re-auth and "switch account" work.
    await GoogleSignin.signOut().catch(() => {});
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res)) return null;
    return res.data.idToken ?? null;
  };

  const signInWithGoogle = async () => {
    if (!googleConfigured) {
      throw new Error('Google Sign-In is not configured (missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID).');
    }
    try {
      if (Platform.OS === 'android') {
        const idToken = await nativeGoogleIdToken();
        if (idToken) await handleGoogleSignInSuccess(idToken);
        return;
      }
      await promptAsync();
    } catch (error: any) {
      console.error('Google Sign-In error:', error);
      throw error;
    }
  };

  const getAppleCredential = async () => {
    // Firebase requires the raw nonce sent to Apple and its SHA-256 hash passed
    // in the authorization request, to prevent replay attacks.
    const rawNonce = Array.from(await Crypto.getRandomBytesAsync(16))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce,
    );

    const appleCredential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    if (!appleCredential.identityToken) {
      throw new Error('Apple Sign-In did not return an identity token.');
    }

    const provider = new OAuthProvider('apple.com');
    const credential = provider.credential({
      idToken: appleCredential.identityToken,
      rawNonce,
    });
    return { credential, appleCredential };
  };

  const signInWithApple = async () => {
    const { credential, appleCredential } = await getAppleCredential();
    const userCredential = await signInWithCredential(auth, credential);

    // Apple only returns the name on the FIRST authorization — capture it into
    // the user profile if we don't have one yet.
    const uid = userCredential.user.uid;
    const fullName = [appleCredential.fullName?.givenName, appleCredential.fullName?.familyName]
      .filter(Boolean)
      .join(' ')
      .trim();
    try {
      const existing = await getDoc(doc(db, 'users', uid));
      if (!existing.exists()) {
        const newUserDoc = {
          email: userCredential.user.email || appleCredential.email || '',
          full_name: fullName || userCredential.user.displayName || '',
          role: 'attendee',
          created_at: new Date().toISOString(),
          is_verified: false,
        };
        await setDoc(doc(db, 'users', uid), newUserDoc);
        // H4: seed the cross-user-readable projection (best-effort; PII stripped).
        await syncPublicProfile(uid, newUserDoc);
      }
    } catch (e) {
      console.warn('Apple sign-in: could not seed user profile', e);
    }
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    
    // Create user profile in Firestore
    const newUserDoc = {
      email,
      full_name: fullName,
      role: 'attendee',
      created_at: new Date().toISOString(),
      is_verified: false,
    };
    await setDoc(doc(db, 'users', userCredential.user.uid), newUserDoc);
    // H4: seed the cross-user-readable projection (best-effort; PII stripped).
    await syncPublicProfile(userCredential.user.uid, newUserDoc);
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    await AsyncStorage.clear();
  };

  const reauthMethod = (): 'password' | 'google' | 'apple' | null => {
    const providers = (auth.currentUser?.providerData || []).map((p) => p?.providerId);
    if (providers.includes('password')) return 'password';
    if (providers.includes('apple.com')) return 'apple';
    if (providers.includes('google.com')) return 'google';
    return null;
  };

  const reauthenticate = async (password?: string) => {
    const current = auth.currentUser;
    if (!current) throw new Error('Not signed in');
    const method = reauthMethod();
    if (method === 'password') {
      if (!current.email || !password) throw Object.assign(new Error('Password required'), { code: 'auth/missing-password' });
      await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, password));
    } else if (method === 'apple') {
      const { credential } = await getAppleCredential();
      await reauthenticateWithCredential(current, credential);
    } else if (method === 'google') {
      if (!googleConfigured) throw new Error('Google Sign-In is not configured.');
      if (Platform.OS === 'android') {
        const idToken = await nativeGoogleIdToken();
        if (!idToken) throw Object.assign(new Error('Re-authentication cancelled'), { code: 'auth/cancelled' });
        await reauthenticateWithCredential(current, GoogleAuthProvider.credential(idToken));
        await current.getIdToken(true);
        return;
      }
      googleReauthInFlight.current = true;
      try {
        const result = await promptAsync();
        if (result?.type !== 'success' || !(result as any).params?.id_token) {
          throw Object.assign(new Error('Re-authentication cancelled'), { code: 'auth/cancelled' });
        }
        googleReauthIdToken.current = (result as any).params.id_token;
        await reauthenticateWithCredential(current, GoogleAuthProvider.credential((result as any).params.id_token));
      } finally {
        googleReauthInFlight.current = false;
      }
    } else {
      throw new Error('This sign-in method cannot be re-verified here.');
    }
    // Mint a token carrying the new auth_time for the next API call.
    await current.getIdToken(true);
  };

  return (
    <AuthContext.Provider value={{ user, userProfile, loading, signIn, signInWithGoogle, signInWithApple, appleAuthAvailable, signUp, signOut, reauthMethod, reauthenticate, refreshUserProfile: async () => refreshUserProfile(), updateUserProfile }}>
      {children}
    </AuthContext.Provider>
  );
};
