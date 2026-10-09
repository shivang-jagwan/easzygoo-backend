import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { myOrders, type OrderSummary } from '@easzygoo/api-client';

import ScreenHeader from '../components/ScreenHeader';
import { api } from '../lib/api';
import { toUserMessage } from '../lib/errors';
import { formatDate, formatPrice } from '../lib/format';
import { STATUS_BADGE, statusColor } from '../lib/orderStatus';
import { useTheme } from '../theme/ThemeContext';
import type { ProfileStackParamList, RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<ProfileStackParamList, 'OrderHistory'>;

type Status = 'loading' | 'ready' | 'error';

export default function OrderHistoryScreen({ navigation }: Props) {
  const { colors } = useTheme();

  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setIsRefreshing(true);
    else setStatus('loading');
    setErrorMessage(null);

    try {
      // Already newest-first from the backend, so no client-side sorting.
      setOrders(await myOrders(api));
      setStatus('ready');
    } catch (err) {
      console.error('[history] load failed:', err);
      setErrorMessage(toUserMessage(err));
      setStatus('error');
    } finally {
      if (isRefresh) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Tracking lives on the root stack, above the tabs, so it is reached through
   * the parent rather than this stack — see RootStackParamList.
   */
  const openOrder = useCallback(
    (orderId: string) => {
      navigation
        .getParent<NativeStackNavigationProp<RootStackParamList>>()
        ?.navigate('OrderTracking', { orderId });
    },
    [navigation],
  );

  const shell = (body: ReactNode) => (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader />
      <Text style={[styles.title, { color: colors.text }]}>Order history</Text>
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

  if (status === 'error') {
    return shell(
      <View style={styles.centre}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Could not load your orders</Text>
        <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>{errorMessage}</Text>
        <Pressable
          testID="retry"
          onPress={() => void load()}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.button, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={[styles.buttonText, { color: colors.buttonText }]}>Retry</Text>
        </Pressable>
      </View>,
    );
  }

  if (orders.length === 0) {
    return shell(
      <View style={styles.centre}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>No orders yet</Text>
        <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
          Browse stores on Home to place your first one.
        </Text>
      </View>,
    );
  }

  return shell(
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => void load(true)}
          tintColor={colors.primaryGreen}
          colors={[colors.primaryGreen]}
        />
      }
    >
      {orders.map((order) => (
        <Pressable
          key={order.id}
          testID={`order-${order.id}`}
          onPress={() => openOrder(order.id)}
          style={({ pressed }) => [
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <View style={styles.cardHeader}>
            <Text style={[styles.vendorName, { color: colors.text }]} numberOfLines={1}>
              {order.vendorName}
            </Text>
            <View
              testID={`badge-${order.id}`}
              style={[styles.badge, { borderColor: statusColor(order.status, colors) }]}
            >
              <Text style={[styles.badgeText, { color: statusColor(order.status, colors) }]}>
                {STATUS_BADGE[order.status]}
              </Text>
            </View>
          </View>

          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {`${formatDate(order.placedAt)} · ${order.itemCount} ${
              order.itemCount === 1 ? 'item' : 'items'
            }`}
          </Text>

          <Text testID={`total-${order.id}`} style={[styles.total, { color: colors.text }]}>
            {formatPrice(Number(order.total))}
          </Text>
        </Pressable>
      ))}
    </ScrollView>,
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: { fontSize: 20, fontWeight: '700', paddingHorizontal: 16, paddingTop: 14 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  content: { padding: 16, paddingBottom: 32, gap: 10 },
  card: { padding: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  vendorName: { flex: 1, fontSize: 16, fontWeight: '600' },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  badgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  meta: { fontSize: 13 },
  total: { fontSize: 16, fontWeight: '700', paddingTop: 2 },
  emptyTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  emptyBody: { fontSize: 13, textAlign: 'center' },
  button: { paddingHorizontal: 22, paddingVertical: 11, borderRadius: 8 },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
