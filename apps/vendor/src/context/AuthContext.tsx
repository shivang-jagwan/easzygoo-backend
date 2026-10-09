import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  onAuthStateChanged,
  signInWithPhoneNumber,
  signOut as firebaseSignOut,
} from '@react-native-firebase/auth';
import {
  getMyVendor,
  verify,
  type AuthUser,
  type MyVendorResponse,
  type VendorStatus,
} from '@easzygoo/api-client';

import { auth } from '../lib/firebase';
import { api } from '../lib/api';

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
   * GET /v1/vendors/me. Null while it is in flight or while signed out.
   * A discriminated union: check `onboarded` before reaching for `vendor`.
   */
  vendorProfile: MyVendorResponse | null;
  /**
   * The approval status, pulled out for the screens that only care about it —
   * PendingApprovalScreen picks its wording from this. Null when there is no
   * profile yet, which is not the same as PENDING.
   */
  vendorStatus: VendorStatus | null;
  /** Set when the profile fetch failed, so callers can tell "no store" from "no answer". */
  vendorError: string | null;
  /** Re-runs the profile fetch. Called on foreground, and after onboarding submits. */
  refreshVendor: () => Promise<void>;
  /**
   * The current Firebase ID token, or null when signed out. Needed by anything
   * that authenticates outside the api-client's own header handling.
   */
  getIdToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingConfirmation, setPendingConfirmation] = useState<ConfirmationResult | null>(null);
  const [vendorProfile, setVendorProfile] = useState<MyVendorResponse | null>(null);
  const [vendorError, setVendorError] = useState<string | null>(null);

  /**
   * Set while confirmOtp is resolving a sign-in. Firebase fires
   * onAuthStateChanged as soon as confirm() succeeds, so without this the
   * listener would race confirmOtp to call verify() — and for a brand-new
   * vendor the listener's call (which deliberately sends no role) would find no
   * backend row and sign them straight back out mid-signup. The flag only
   * defers to the call that knows the role; it never creates a user the
   * listener would have refused.
   */
  const confirmingRef = useRef(false);

  /**
   * Only the newest profile fetch may write state. Foreground refreshes can
   * overlap a first load, and a slow earlier response must not overwrite a
   * newer one (or land after a sign-out).
   */
  const fetchSeq = useRef(0);

  const userId = user?.id ?? null;

  const loadVendor = useCallback(async () => {
    const seq = ++fetchSeq.current;
    try {
      const profile = await getMyVendor(api);
      if (seq !== fetchSeq.current) return;
      setVendorProfile(profile);
      setVendorError(null);
    } catch (err) {
      if (seq !== fetchSeq.current) return;
      console.error('[vendor] could not load profile:', err);
      // Deliberately does NOT fall back to a null profile: see
      // resolveVendorAppState — "no answer" must not read as "no store yet".
      setVendorError(err instanceof Error ? err.message : 'Could not load your store');
    }
  }, []);

  useEffect(() => {
    // Fires immediately with the restored session (or null) on cold start, and
    // again on every sign-in / sign-out.
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setPhoneNumber(null);
        // Invalidate any in-flight fetch so it cannot repopulate after sign-out.
        fetchSeq.current += 1;
        setVendorProfile(null);
        setVendorError(null);
        setIsLoading(false);
        return;
      }

      setPhoneNumber(firebaseUser.phoneNumber ?? null);

      // A sign-in that confirmOtp is already handling; it resolves the user
      // itself, with the role this app needs for a first-time vendor.
      if (confirmingRef.current) return;

      try {
        const idToken = await firebaseUser.getIdToken();
        // No role: this path only ever sees accounts that already exist.
        setUser(await verify(api, idToken));
      } catch (err) {
        // A valid Firebase session with no backend row lands here. Treat it as
        // signed out rather than wedging the app on a broken session, and do
        // not quietly re-create the row: an account an admin deleted or banned
        // must not come back to life as a fresh one on the next app open.
        console.error('[auth] could not resolve backend user:', err);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  // Load the vendor's profile once the backend user is known, and again if the
  // account changes underneath us.
  useEffect(() => {
    if (userId === null) return;
    void loadVendor();
  }, [userId, loadVendor]);

  /**
   * Re-check on foreground. A vendor approved while the app was closed should
   * see the dashboard on their next open rather than sitting on the waiting
   * screen until they think to reinstall.
   */
  useEffect(() => {
    if (userId === null) return;

    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const returned = previous !== 'active' && next === 'active';
      previous = next;
      if (returned) void loadVendor();
    });

    return () => subscription.remove();
  }, [userId, loadVendor]);

  const vendorStatus: VendorStatus | null =
    vendorProfile?.onboarded === true ? vendorProfile.vendor.status : null;

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      phoneNumber,
      isLoading,
      pendingConfirmation,
      setPendingConfirmation,
      vendorProfile,
      vendorStatus,
      vendorError,
      refreshVendor: loadVendor,

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
          // role and keep whatever the backend already stored — which is what
          // stops this screen from re-badging an existing customer as a vendor.
          const isNewUser = credential.additionalUserInfo?.isNewUser === true;
          setUser(await verify(api, idToken, isNewUser ? 'VENDOR' : undefined));
          setPendingConfirmation(null);
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
        fetchSeq.current += 1;
        setVendorProfile(null);
        setVendorError(null);
      },
    }),
    [
      user,
      phoneNumber,
      isLoading,
      pendingConfirmation,
      vendorProfile,
      vendorStatus,
      vendorError,
      loadVendor,
    ],
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
