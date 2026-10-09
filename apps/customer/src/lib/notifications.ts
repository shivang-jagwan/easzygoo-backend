import { Platform } from 'react-native';
import messaging, {
  type FirebaseMessagingTypes,
} from '@react-native-firebase/messaging';
import { registerPushToken, type ApiClient } from '@easzygoo/api-client';

/*
 * Push notifications, on raw FCM.
 *
 * NOT expo-notifications: the backend worker sends through firebase-admin's
 * messaging().sendEachForMulticast(), which takes native FCM registration
 * tokens. Expo's push service wraps tokens in its own ExponentPushToken[...]
 * format, which firebase-admin rejects.
 *
 * @react-native-firebase/messaging is a NATIVE module, so picking this up needs
 * a fresh EAS dev build. Reloading Metro against the existing build will fail
 * at `messaging()` with "Native module not found" — rebuild, don't reload.
 */

/** What the foreground banner needs out of a message. */
export interface ForegroundNotification {
  title: string;
  body?: string;
}

type ForegroundListener = (notification: ForegroundNotification) => void;

const foregroundListeners = new Set<ForegroundListener>();

/**
 * Subscribes to notifications that arrive while the app is open. Kept as a
 * plain listener set rather than a context so lib code can publish without
 * reaching into React.
 */
export function onForegroundNotification(listener: ForegroundListener): () => void {
  foregroundListeners.add(listener);
  return () => {
    foregroundListeners.delete(listener);
  };
}

/**
 * Asks for notification permission. On Android 13+ this is the POST_NOTIFICATIONS
 * runtime prompt; below that it resolves granted without prompting. On iOS it is
 * the usual alert/badge/sound request.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const status = await messaging().requestPermission();
  // PROVISIONAL is iOS quiet delivery — still deliverable, so still granted.
  return (
    status === messaging.AuthorizationStatus.AUTHORIZED ||
    status === messaging.AuthorizationStatus.PROVISIONAL
  );
}

/**
 * Sends this device's FCM token to the backend so the worker can target it.
 * The endpoint upserts on the token, so calling it repeatedly is harmless and
 * re-points the row when a device changes accounts.
 */
export async function registerDeviceToken(client: ApiClient): Promise<string> {
  const token = await messaging().getToken();
  await registerPushToken(client, token, Platform.OS);
  return token;
}

/**
 * Re-registers whenever FCM rotates the token, which it does on reinstall,
 * restore-to-new-device, and occasionally on its own. Without this the backend
 * keeps pushing to a token nothing is listening on.
 */
export function watchTokenRefresh(client: ApiClient): () => void {
  return messaging().onTokenRefresh(async (token) => {
    try {
      await registerPushToken(client, token, Platform.OS);
    } catch (err) {
      console.error('[push] token refresh registration failed:', err);
    }
  });
}

/** The minimum a navigation ref has to do for us; keeps this file testable. */
interface NavigationRefLike {
  isReady: () => boolean;
  navigate: (name: 'OrderTracking', params: { orderId: string }) => void;
}

/**
 * The orderId a notification wants opened, or null if it is not about an order.
 * FCM data payloads are always string-valued, so nothing here is coerced.
 */
export function orderIdFromMessage(
  message: FirebaseMessagingTypes.RemoteMessage | null | undefined,
): string | null {
  const orderId = message?.data?.orderId;
  return typeof orderId === 'string' && orderId ? orderId : null;
}

/** How long to keep waiting for the navigator on a cold start before giving up. */
const NAV_READY_TIMEOUT_MS = 5000;
const NAV_READY_POLL_MS = 100;

/**
 * Opens the order a notification points at. On a cold start the container may
 * not have mounted yet — getInitialNotification resolves early — so this waits
 * briefly rather than dropping the tap on the floor.
 */
function openOrder(navigationRef: NavigationRefLike, orderId: string): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate('OrderTracking', { orderId });
    return;
  }

  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (navigationRef.isReady()) {
      clearInterval(timer);
      navigationRef.navigate('OrderTracking', { orderId });
    } else if (Date.now() - startedAt > NAV_READY_TIMEOUT_MS) {
      clearInterval(timer);
      console.warn('[push] navigator never became ready; dropped notification tap');
    }
  }, NAV_READY_POLL_MS);
}

/**
 * Wires the three ways a notification reaches the app. Call once, from App.tsx.
 * Returns a teardown for the two live subscriptions.
 */
export function setupNotificationHandlers(navigationRef: NavigationRefLike): () => void {
  // 1. Foreground: FCM does not draw anything itself, so we show our own banner.
  //    No navigation — the customer is already looking at something.
  const unsubscribeMessage = messaging().onMessage((message) => {
    const title = message.notification?.title;
    if (!title) return;
    for (const listener of foregroundListeners) {
      listener({ title, body: message.notification?.body });
    }
  });

  // 2. Backgrounded, then tapped.
  const unsubscribeOpened = messaging().onNotificationOpenedApp((message) => {
    const orderId = orderIdFromMessage(message);
    if (orderId) openOrder(navigationRef, orderId);
  });

  // 3. Killed, then tapped — the notification that launched the app.
  void messaging()
    .getInitialNotification()
    .then((message) => {
      const orderId = orderIdFromMessage(message);
      if (orderId) openOrder(navigationRef, orderId);
    })
    .catch((err) => console.error('[push] initial notification check failed:', err));

  return () => {
    unsubscribeMessage();
    unsubscribeOpened();
  };
}
