import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Socket } from 'socket.io-client';
import { cancelOrder, getOrder, type OrderDetail, type OrderStatus } from '@easzygoo/api-client';

import ConfirmDialog from '../components/ConfirmDialog';
import ScreenHeader from '../components/ScreenHeader';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { toUserMessage } from '../lib/errors';
import { formatPrice } from '../lib/format';
import { STATUS_LABEL } from '../lib/orderStatus';
import { connectOrderSocket } from '../lib/socket';
import { useTheme } from '../theme/ThemeContext';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'OrderTracking'>;

type Status = 'loading' | 'ready' | 'error';

/** The happy path, in order. CANCELLED is not a step — it replaces the timeline. */
const TIMELINE: OrderStatus[] = [
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

interface RiderLocation {
  lat: number;
  lng: number;
  updatedAt: string;
}

/**
 * How long to wait for the server's own order:status after a cancellation
 * before going and asking. Long enough that a healthy socket always wins.
 */
const CANCEL_FALLBACK_MS = 8000;

export default function OrderTrackingScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { orderId } = route.params;
  const { getIdToken } = useAuth();

  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderDetail | null>(null);

  /**
   * Kept apart from `order` because the socket updates this and only this. The
   * fetched order seeds it; every later change arrives over the wire.
   */
  const [orderStatus, setOrderStatus] = useState<OrderStatus | null>(null);
  const [riderLocation, setRiderLocation] = useState<RiderLocation | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /** Pending fallback check after a cancellation. Null when none is armed. */
  const cancelFallback = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCancelFallback = useCallback(() => {
    if (cancelFallback.current === null) return;
    clearTimeout(cancelFallback.current);
    cancelFallback.current = null;
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    try {
      const fetched = await getOrder(api, orderId);
      setOrder(fetched);
      setOrderStatus(fetched.status);
      setStatus('ready');
    } catch (err) {
      console.error('[tracking] load failed:', err);
      setErrorMessage(toUserMessage(err));
      setStatus('error');
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---------- live updates ----------

  useEffect(() => {
    let socket: Socket | null = null;
    let disposed = false;

    void (async () => {
      const token = await getIdToken();
      if (!token) {
        console.warn('[tracking] no ID token; live updates are off');
        return;
      }
      // The screen may have unmounted while the token was being fetched, in
      // which case the cleanup below has already run and cannot see this socket.
      if (disposed) return;

      socket = connectOrderSocket(orderId, token);

      socket.on('order:status', (payload: { orderId?: string; status?: OrderStatus }) => {
        // The room is per-order, but check anyway rather than trusting the wire.
        if (payload?.orderId && payload.orderId !== orderId) return;
        if (!payload?.status) return;

        // Any status for this order proves the socket is delivering, which is
        // the only thing the cancel fallback exists to compensate for — so it
        // stands down here, not just on CANCELLED.
        clearCancelFallback();
        setOrderStatus(payload.status);
        setCancelRequested(false);
      });

      socket.on('rider:location', (payload: Partial<RiderLocation>) => {
        if (typeof payload?.lat !== 'number' || typeof payload?.lng !== 'number') return;
        setRiderLocation({
          lat: payload.lat,
          lng: payload.lng,
          updatedAt: payload.updatedAt ?? new Date().toISOString(),
        });
      });

      // The backend refuses a join it does not like rather than throwing.
      socket.on('error', (payload: { event?: string; message?: string }) => {
        console.error('[tracking] socket refused:', payload?.event, payload?.message);
      });

      socket.on('connect_error', (err: Error) => {
        console.error('[tracking] socket connect failed:', err.message);
      });

      if (disposed) socket.disconnect();
    })();

    return () => {
      disposed = true;
      socket?.disconnect();
    };
  }, [orderId, getIdToken]);

  // Only ticks once there is a timestamp to age, so an order with no rider
  // assigned never re-renders on a timer.
  useEffect(() => {
    if (!riderLocation) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [riderLocation]);

  /**
   * Runs when a cancellation was accepted but no order:status followed.
   *
   * This is the one place that sets the status from something other than the
   * socket, and that is the whole point of it: the rule exists so the screen
   * never shows a state the server has not reached, but a socket that silently
   * failed to deliver leaves the screen stuck claiming "waiting" forever. A
   * single authoritative re-read is a truer source than a socket that isn't
   * talking, so whatever it returns is what gets shown — CANCELLED or not.
   */
  const runCancelFallback = useCallback(async () => {
    cancelFallback.current = null;
    try {
      const fresh = await getOrder(api, orderId);
      setOrder(fresh);
      setOrderStatus(fresh.status);
      // The vendor may have moved it on before the cancel landed. Either way we
      // now know the real status, so stop claiming to be waiting for one.
      setCancelRequested(false);
    } catch (err) {
      // Still in the dark, so the waiting line stays up rather than inventing
      // an outcome.
      console.error('[tracking] cancel fallback check failed:', err);
      setActionError(toUserMessage(err));
    }
  }, [orderId]);

  const handleCancel = useCallback(async () => {
    setConfirmingCancel(false);
    setIsCancelling(true);
    setActionError(null);
    try {
      await cancelOrder(api, orderId);
      // Deliberately does NOT set orderStatus. The server emits order:status
      // for this cancellation, and letting that drive the UI means the screen
      // never shows a state the server has not actually reached.
      setCancelRequested(true);

      // ...unless nothing arrives. Whichever lands first disarms the other:
      // the socket handler clears this timer, and this timer nulls itself out
      // when it runs, so exactly one of the two ever takes effect.
      clearCancelFallback();
      cancelFallback.current = setTimeout(() => {
        void runCancelFallback();
      }, CANCEL_FALLBACK_MS);
    } catch (err) {
      console.error('[tracking] cancel failed:', err);
      setActionError(toUserMessage(err));
    } finally {
      setIsCancelling(false);
    }
  }, [orderId, clearCancelFallback, runCancelFallback]);

  // A screen left before the fallback fires must not come back to set state.
  useEffect(() => clearCancelFallback, [clearCancelFallback]);

  const backToHome = useCallback(() => {
    // This screen sits above the tabs now, so going home means popping back to
    // Main and asking it for the Home tab — not resetting a stack we are not in.
    navigation.navigate('Main', { screen: 'Home' });
  }, [navigation]);

  const shell = (body: React.ReactNode) => (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader />
      <Text style={[styles.title, { color: colors.text }]}>Your order</Text>
      {body}
    </View>
  );

  if (status === 'loading') {
    return shell(
      <View style={styles.centre}>
        <ActivityIndicator color={colors.primaryGreen} />
      </View>,
    );
  }

  if (status === 'error' || !order || !orderStatus) {
    return shell(
      <View style={styles.centre}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Could not load this order</Text>
        <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>{errorMessage}</Text>
        <Button testID="retry" label="Retry" onPress={() => void load()} />
        <Button testID="back-home" label="Back to Home" onPress={backToHome} />
      </View>,
    );
  }

  const currentIndex = TIMELINE.indexOf(orderStatus);

  return shell(
    <>
      <ScrollView contentContainerStyle={styles.content}>
        {/* ---------- status ---------- */}

        {orderStatus === 'CANCELLED' ? (
          <View
            testID="cancelled-banner"
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.cardTitle, { color: colors.text }]}>This order was cancelled</Text>
            <Text style={[styles.cardLine, { color: colors.textSecondary }]}>
              Anything you paid is refunded to the original method.
            </Text>
          </View>
        ) : (
          <View testID="timeline" style={styles.timeline}>
            {TIMELINE.map((step, index) => {
              const done = index < currentIndex;
              const current = index === currentIndex;
              return (
                <View key={step} style={styles.step}>
                  <Text
                    style={[
                      styles.stepMark,
                      {
                        color: done
                          ? colors.success
                          : current
                            ? colors.primaryGreen
                            : colors.textSecondary,
                      },
                    ]}
                  >
                    {done ? '✓' : current ? '●' : '○'}
                  </Text>
                  <Text
                    testID={`step-${step}`}
                    style={[
                      styles.stepLabel,
                      {
                        color: current ? colors.text : done ? colors.textSecondary : colors.border,
                        fontWeight: current ? '700' : '500',
                      },
                    ]}
                  >
                    {STATUS_LABEL[step]}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* ---------- rider ---------- */}

        {riderLocation ? (
          // No map: there is no Maps API key configured yet, so a freshness
          // line is the honest amount of information we actually have.
          <Text testID="rider-location" style={[styles.riderLine, { color: colors.textSecondary }]}>
            {`Rider location updated ${secondsAgo(riderLocation.updatedAt, now)}s ago`}
          </Text>
        ) : null}

        {/* ---------- summary ---------- */}

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Order summary</Text>

          {order.items.map((item) => (
            <View key={item.id} style={styles.summaryRow}>
              <Text style={[styles.summaryName, { color: colors.textSecondary }]}>
                {`${item.product.name} × ${item.quantity}`}
              </Text>
              <Text style={[styles.summaryAmount, { color: colors.text }]}>
                {formatPrice(Number(item.lineTotal))}
              </Text>
            </View>
          ))}

          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, { color: colors.text }]}>Total</Text>
            {/* The backend's figure, including delivery fee and discount —
                never recomputed here. */}
            <Text testID="order-total" style={[styles.totalAmount, { color: colors.text }]}>
              {formatPrice(Number(order.total))}
            </Text>
          </View>

          <Text testID="order-id" style={[styles.orderId, { color: colors.textSecondary }]}>
            {`Order ${order.id}`}
          </Text>
        </View>

        {actionError ? (
          <View
            testID="action-error"
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.cardLine, { color: colors.text }]}>{actionError}</Text>
          </View>
        ) : null}

        {cancelRequested && orderStatus !== 'CANCELLED' ? (
          <Text testID="cancel-pending" style={[styles.riderLine, { color: colors.textSecondary }]}>
            Cancellation requested — waiting for the store to confirm.
          </Text>
        ) : null}

        {/* Only PLACED can be cancelled; the backend rejects anything later. */}
        {orderStatus === 'PLACED' && !cancelRequested ? (
          <Button
            testID="cancel-order"
            label={isCancelling ? 'Cancelling…' : 'Cancel order'}
            disabled={isCancelling}
            onPress={() => setConfirmingCancel(true)}
          />
        ) : null}

        <Button testID="back-home" label="Back to Home" onPress={backToHome} />
      </ScrollView>

      {confirmingCancel ? (
        <ConfirmDialog
          title="Cancel this order?"
          message="The store will be told to stop preparing it. This cannot be undone."
          confirmLabel="Cancel order"
          cancelLabel="Keep it"
          onConfirm={() => void handleCancel()}
          onCancel={() => setConfirmingCancel(false)}
          confirmTestID="cancel-confirm"
          cancelTestID="cancel-dismiss"
        />
      ) : null}
    </>,
  );
}

/** Whole seconds between an ISO timestamp and now, never negative. */
function secondsAgo(iso: string, now: number): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now - then) / 1000));
}

function Button({
  testID,
  label,
  onPress,
  disabled,
}: {
  testID: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.button, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={[styles.buttonText, { color: colors.buttonText }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: { fontSize: 20, fontWeight: '700', paddingHorizontal: 16, paddingTop: 14 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  timeline: { gap: 10, paddingVertical: 4 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepMark: { fontSize: 15, width: 18, textAlign: 'center' },
  stepLabel: { fontSize: 15 },
  riderLine: { fontSize: 13 },
  card: { padding: 14, borderRadius: 12, borderWidth: 1, gap: 4 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardLine: { fontSize: 13 },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 4,
  },
  summaryName: { flex: 1, fontSize: 13 },
  summaryAmount: { fontSize: 14, fontWeight: '600' },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
  },
  totalLabel: { fontSize: 15, fontWeight: '700' },
  totalAmount: { fontSize: 18, fontWeight: '700' },
  orderId: { fontSize: 11, paddingTop: 6 },
  button: { paddingVertical: 13, borderRadius: 10, alignItems: 'center' },
  buttonText: { fontSize: 15, fontWeight: '700' },
  emptyTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  emptyBody: { fontSize: 13, textAlign: 'center' },
});
