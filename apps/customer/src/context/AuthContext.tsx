import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPhoneNumber,
  signOut as firebaseSignOut,
} from '@react-native-firebase/auth';
import { verify, type AuthUser } from '@easzygoo/api-client';

import { auth } from '../lib/firebase';
import { api } from '../lib/api';
import {
  registerDeviceToken,
  requestNotificationPermission,
  watchTokenRefresh,
} from '../lib/notifications';

/**
 * v26 does not re-export ConfirmationResult from the package root, so derive it
 * from the function that produces it. Survives library type reshuffles.
 */
export type ConfirmationResult = Awaited<ReturnType<typeof signInWithPhoneNumber>>;

interface AuthContextValue {
  /** Our backend's User record, not the raw Firebase user. Null when signed out. */
  user: AuthUser | null;
  /**
   * The verified phone number, straight from Firebase. The backend's /auth/verify
   * projection is { id, role, name } and deliberately does not include it, so
   * this comes from the credential that proved it rather than a second source.
   */
  phoneNumber: string | null;
  /** True until the initial auth-state check has settled. */
  isLoading: boolean;
  /**
   * The in-flight OTP confirmation, set by PhoneEntryScreen and read by
   * OtpVerifyScreen. It lives here rather than in navigation params because a
   * live Firebase object is not serialisable, and React Navigation warns about
   * (and cannot persist/restore) non-serialisable route params.
   */
  pendingConfirmation: ConfirmationResult | null;
  setPendingConfirmation: (confirmation: ConfirmationResult | null) => void;
  /** Starts phone verification; hand the result to confirmOtp. */
  sendOtp: (phoneNumber: string) => Promise<ConfirmationResult>;
  /** Confirms the SMS code and resolves the backend User record. */
  confirmOtp: (confirmation: ConfirmationResult, code: string) => Promise<void>;
  /**
   * The current Firebase ID token, or null when signed out. Needed by anything
   * that authenticates outside the api-client's own header handling — the
   * Socket.io handshake, for one.
   */
  getIdToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Asks for notification permission and registers this device, without ever
 * standing between the customer and a working app.
 *
 * Deliberately not awaited by callers: a permission prompt the customer ignores
 * would otherwise hold the whole sign-in open, and a refusal must never fail a
 * login. Everything in here is best-effort and swallows its own failures.
 */
function registerForPush(): void {
  void (async () => {
    try {
      const granted = await requestNotificationPermission();
      if (!granted) {
        console.warn('[push] notification permission denied; no token registered');
        return;
      }
      await registerDeviceToken(api);
      watchTokenRefresh(api);
    } catch (err) {
      console.error('[push] registration failed:', err);
    }
  })();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingConfirmation, setPendingConfirmation] = useState<ConfirmationResult | null>(null);

  /**
   * Set while confirmOtp is resolving a sign-in. Firebase fires
   * onAuthStateChanged as soon as confirm() succeeds, so without this the
   * listener would race confirmOtp to call verify() — and for a brand-new
   * customer the listener's call (which deliberately sends no role) would find
   * no backend row and sign them straight back out mid-signup. The flag only
   * defers to the call that knows the role; it never creates a user the
   * listener would have refused, so the stale-UID rule below is untouched.
   */
  const confirmingRef = useRef(false);

  useEffect(() => {
    // Fires immediately with the restored session (or null) on cold start, and
    // again on every sign-in / sign-out.
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setPhoneNumber(null);
        setIsLoading(false);
        return;
      }

      setPhoneNumber(firebaseUser.phoneNumber ?? null);

      // A sign-in that confirmOtp is already handling; it resolves the user
      // itself, with the role a first-time customer needs.
      if (confirmingRef.current) return;

      try {
        const idToken = await firebaseUser.getIdToken();
        // No role: this path only ever sees accounts that already exist.
        setUser(await verify(api, idToken));
        // Fire-and-forget; see registerForPush.
        registerForPush();
      } catch (err) {
        // A valid Firebase session with no backend row lands here. Treat it as
        // signed out rather than wedging the app on a broken session.
        console.error('[auth] could not resolve backend user:', err);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      phoneNumber,
      isLoading,
      pendingConfirmation,
      setPendingConfirmation,

      sendOtp: (phoneNumber: string) => signInWithPhoneNumber(auth, phoneNumber),

      confirmOtp: async (confirmation: ConfirmationResult, code: string) => {
        confirmingRef.current = true;
        try {
          const credential = await confirmation.confirm(code);
          if (!credential?.user) {
            throw new Error('Verification failed, please try again');
          }

          setPhoneNumber(credential.user.phoneNumber ?? null);
          const idToken = await credential.user.getIdToken();
          // A brand-new Firebase user has no backend row yet, so the role has
          // to be supplied for verify() to create one. Returning users send no
          // role and keep whatever the backend already stored.
          const isNewUser = credential.additionalUserInfo?.isNewUser === true;
          setUser(await verify(api, idToken, isNewUser ? 'CUSTOMER' : undefined));
          setPendingConfirmation(null);
          registerForPush();
        } finally {
          confirmingRef.current = false;
          setIsLoading(false);
        }
      },

      getIdToken: async () => {
        const current = auth.currentUser;
        if (!current) return null;
        // Firebase refreshes this itself when the cached one is close to expiry.
        return current.getIdToken();
      },

      signOut: async () => {
        await firebaseSignOut(auth);
        setUser(null);
        setPhoneNumber(null);
        setPendingConfirmation(null);
      },
    }),
    [user, phoneNumber, isLoading, pendingConfirmation],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
