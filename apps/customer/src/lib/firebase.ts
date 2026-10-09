import { getAuth } from '@react-native-firebase/auth';

/**
 * Firebase Auth instance.
 *
 * No JS-side config: the native module reads google-services.json (Android)
 * at build time, which app.json points at via android.googleServicesFile.
 *
 * Note: @react-native-firebase/auth v26 dropped the namespaced `auth()`
 * default export — everything is modular now, so callers pass this instance
 * into the top-level functions, e.g. signInWithPhoneNumber(auth, number).
 */
export const auth = getAuth();
