import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { ApiError, createOrder, myAddresses, type Address } from '@easzygoo/api-client';

import ScreenHeader from '../components/ScreenHeader';
import { useCart } from '../context/CartContext';
import { api } from '../lib/api';
import { toUserMessage } from '../lib/errors';
import { formatPrice, round2 } from '../lib/format';
import { useTheme } from '../theme/ThemeContext';
import type { CartStackParamList, RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CartStackParamList, 'Checkout'>;

type AddressStatus = 'loading' | 'ready' | 'error';

/**
 * One entry from the backend's 409 `products` array. `requested`/`available`
 * are only present when the reason is a stock shortfall — an inactive product,
 * or one whose stock moved mid-transaction, carries neither.
 */
interface StockIssue {
  productId: string;
  name?: string;
  reason?: string;
  requested?: number;
  available?: number;
}

/** How a failed order placement should be shown. Each lands in a different place. */
type PlaceFailure =
  | { kind: 'stock'; products: StockIssue[] }
  | { kind: 'coupon'; message: string }
  | { kind: 'generic'; message: string };

export default function CheckoutScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const selectedAddressId = route.params?.selectedAddressId;
  const { vendorId, vendorName, items, subtotal, clearCart } = useCart();

  const [addressStatus, setAddressStatus] = useState<AddressStatus>('loading');
  const [addressError, setAddressError] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);

  const [couponInput, setCouponInput] = useState('');
  const [appliedCode, setAppliedCode] = useState('');

  const [isPlacing, setIsPlacing] = useState(false);
  const [failure, setFailure] = useState<PlaceFailure | null>(null);

  const loadAddresses = useCallback(async () => {
    setAddressStatus('loading');
    setAddressError(null);
    try {
      setAddresses(await myAddresses(api));
      setAddressStatus('ready');
    } catch (err) {
      console.error('[checkout] addresses failed:', err);
      setAddressError(toUserMessage(err));
      setAddressStatus('error');
    }
  }, []);

  // The param carries only an id, so the list is what turns it into something
  // displayable. Refetching when it changes also picks up an address created
  // moments ago on AddAddressScreen.
  useEffect(() => {
    void loadAddresses();
  }, [loadAddresses, selectedAddressId]);

  const selectedAddress = useMemo(
    () => addresses.find((a) => a.id === selectedAddressId) ?? null,
    [addresses, selectedAddressId],
  );

  const canPlaceOrder = items.length > 0 && selectedAddressId !== undefined && !isPlacing;

  /**
   * The address screens live on the root stack now, so they are opened through
   * the parent. 'select' is what makes tapping an address come back here with
   * it chosen, rather than offering edit/delete.
   */
  const openAddressList = useCallback(() => {
    navigation
      .getParent<NativeStackNavigationProp<RootStackParamList>>()
      ?.navigate('AddressList', { mode: 'select' });
  }, [navigation]);

  const placeOrder = useCallback(async () => {
    if (!vendorId || !selectedAddressId || items.length === 0) return;

    setIsPlacing(true);
    setFailure(null);
    try {
      const order = await createOrder(api, {
        vendorId,
        addressId: selectedAddressId,
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        couponCode: appliedCode || undefined,
      });

      // The order exists server-side now, so the local cart is stale.
      clearCart();

      // Tracking lives on the root stack, above the tabs, so it is pushed
      // through the parent rather than this one.
      navigation
        .getParent<NativeStackNavigationProp<RootStackParamList>>()
        ?.navigate('OrderTracking', { orderId: order.id });

      // Then drop the checkout flow underneath it, so returning to the Cart tab
      // lands on the cart rather than a checkout for an order already placed.
      navigation.reset({ index: 0, routes: [{ name: 'CartHome' }] });
    } catch (err) {
      console.error('[checkout] place order failed:', err);
      setFailure(classifyFailure(err, appliedCode !== ''));
    } finally {
      setIsPlacing(false);
    }
  }, [vendorId, selectedAddressId, items, appliedCode, clearCart, navigation]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader />
      <Text style={[styles.title, { color: colors.text }]}>Checkout</Text>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* ---------- delivery address ---------- */}

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Delivery address</Text>

        {addressStatus === 'loading' && selectedAddressId ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ActivityIndicator color={colors.primaryGreen} />
          </View>
        ) : addressStatus === 'error' ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              Could not load your addresses
            </Text>
            <Text style={[styles.cardLine, { color: colors.textSecondary }]}>{addressError}</Text>
            <SmallButton testID="retry-addresses" label="Retry" onPress={() => void loadAddresses()} />
          </View>
        ) : selectedAddress ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                {selectedAddress.label ?? 'Address'}
              </Text>
              <Pressable testID="change-address" onPress={openAddressList} hitSlop={8}>
                <Text style={[styles.linkAction, { color: colors.button }]}>Change</Text>
              </Pressable>
            </View>
            <Text style={[styles.cardLine, { color: colors.textSecondary }]}>
              {selectedAddress.line1}
            </Text>
            {selectedAddress.line2 ? (
              <Text style={[styles.cardLine, { color: colors.textSecondary }]}>
                {selectedAddress.line2}
              </Text>
            ) : null}
            <Text style={[styles.cardLine, { color: colors.textSecondary }]}>
              {`${selectedAddress.city} ${selectedAddress.pincode}`}
            </Text>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Select a delivery address</Text>
            {/* Covers both "none picked yet" and an id that no longer resolves —
                an address deleted on another device, say. */}
            <Text style={[styles.cardLine, { color: colors.textSecondary }]}>
              We need somewhere to deliver this order.
            </Text>
            <SmallButton
              testID="select-address"
              label="Choose address"
              onPress={openAddressList}
            />
          </View>
        )}

        {/* ---------- order summary ---------- */}

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Order summary</Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            {vendorName ?? 'Your order'}
          </Text>

          {items.length === 0 ? (
            <Text style={[styles.cardLine, { color: colors.textSecondary }]}>
              Your cart is empty.
            </Text>
          ) : (
            // Read-only on purpose: quantities change in the cart, not here,
            // so there is one place where the order can be edited.
            items.map((item) => (
              <View key={item.productId} style={styles.summaryRow}>
                <Text style={[styles.summaryName, { color: colors.textSecondary }]}>
                  {`${item.name} × ${item.quantity}`}
                </Text>
                <Text
                  testID={`line-total-${item.productId}`}
                  style={[styles.summaryAmount, { color: colors.text }]}
                >
                  {formatPrice(round2(item.price * item.quantity))}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* ---------- coupon ---------- */}

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Coupon</Text>

        <View style={styles.couponRow}>
          <TextInput
            testID="coupon-input"
            style={[
              styles.couponInput,
              { backgroundColor: colors.card, borderColor: colors.border, color: colors.text },
            ]}
            value={couponInput}
            onChangeText={setCouponInput}
            placeholder="Coupon code"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <Pressable
            testID="apply-coupon"
            // No client-side validation and no discount preview: the backend
            // owns coupon rules and only rules on them at order creation.
            onPress={() => {
              setAppliedCode(couponInput.trim());
              setFailure(null);
            }}
            style={({ pressed }) => [
              styles.applyButton,
              { backgroundColor: colors.button, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={[styles.applyText, { color: colors.buttonText }]}>Apply</Text>
          </Pressable>
        </View>

        {appliedCode ? (
          <Text testID="applied-coupon" style={[styles.couponNote, { color: colors.textSecondary }]}>
            {`${appliedCode} will be applied when you place the order.`}
          </Text>
        ) : null}

        {failure?.kind === 'coupon' ? (
          <Text testID="coupon-error" style={[styles.couponError, { color: colors.text }]}>
            {failure.message}
          </Text>
        ) : null}

        {/* ---------- failures that are not the coupon's ---------- */}

        {failure?.kind === 'stock' ? (
          <View
            testID="stock-issues"
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.primaryGreen }]}
          >
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              Some items are no longer available
            </Text>
            {failure.products.map((product) => (
              <Text
                key={product.productId}
                testID={`stock-issue-${product.productId}`}
                style={[styles.cardLine, { color: colors.textSecondary }]}
              >
                {describeStockIssue(product)}
              </Text>
            ))}
            <SmallButton
              testID="review-cart"
              label="Review cart"
              onPress={() => navigation.navigate('CartHome')}
            />
          </View>
        ) : null}

        {failure?.kind === 'generic' ? (
          <View
            testID="error-banner"
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.cardLine, { color: colors.text }]}>{failure.message}</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* ---------- sticky footer ---------- */}

      <View
        style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border }]}
      >
        <View style={[styles.subtotal, { backgroundColor: colors.offerBackground }]}>
          <Text style={[styles.subtotalLabel, { color: colors.text }]}>Subtotal</Text>
          <Text testID="subtotal" style={[styles.subtotalAmount, { color: colors.text }]}>
            {formatPrice(subtotal)}
          </Text>
        </View>
        <Text style={[styles.footerNote, { color: colors.textSecondary }]}>
          Delivery fee and any discount are added by the store when the order is placed.
        </Text>

        <Pressable
          testID="place-order"
          disabled={!canPlaceOrder}
          onPress={() => void placeOrder()}
          style={({ pressed }) => [
            styles.placeButton,
            {
              backgroundColor: colors.button,
              opacity: !canPlaceOrder ? 0.5 : pressed ? 0.8 : 1,
            },
          ]}
        >
          <Text style={[styles.placeText, { color: colors.buttonText }]}>
            {isPlacing ? 'Placing order…' : 'Place Order'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Sorts a failed placement into the one place it belongs on screen.
 *
 * Order matters: a stock 409 is identified by its `products` payload, while
 * coupon problems are identified by message, and the backend reports the
 * coupon race as a 409 too.
 */
function classifyFailure(err: unknown, hasCoupon: boolean): PlaceFailure {
  if (err instanceof ApiError) {
    const payload = err.cause as { products?: unknown } | null | undefined;

    if (err.status === 409 && payload && Array.isArray(payload.products)) {
      return { kind: 'stock', products: payload.products as StockIssue[] };
    }

    // Every coupon rejection the backend sends names the coupon, and it only
    // sends one if we supplied a code — without one this is somebody else's
    // error and belongs in the banner.
    if (hasCoupon && (err.status === 400 || err.status === 409) && /coupon/i.test(err.message)) {
      return { kind: 'coupon', message: err.message };
    }
  }

  return { kind: 'generic', message: toUserMessage(err) };
}

/** Turns one backend `products` entry into a line a customer can act on. */
function describeStockIssue(product: StockIssue): string {
  const name = product.name ?? 'This item';

  if (typeof product.available === 'number' && typeof product.requested === 'number') {
    return product.available === 0
      ? `${name} — sold out (you asked for ${product.requested})`
      : `${name} — only ${product.available} left, you asked for ${product.requested}`;
  }
  if (product.reason === 'inactive') {
    return `${name} — no longer sold here`;
  }
  return `${name} — ${product.reason ?? 'no longer available'}`;
}

function SmallButton({
  testID,
  label,
  onPress,
}: {
  testID: string;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.smallButton,
        { backgroundColor: colors.button, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={[styles.smallButtonText, { color: colors.buttonText }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: { fontSize: 20, fontWeight: '700', paddingHorizontal: 16, paddingTop: 14 },
  content: { padding: 16, paddingBottom: 24, gap: 6 },
  sectionTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', paddingTop: 10 },
  card: { padding: 14, borderRadius: 12, borderWidth: 1, gap: 4, alignItems: 'flex-start' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', width: '100%', gap: 12 },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: '600' },
  cardLine: { fontSize: 13 },
  linkAction: { fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: 12,
    paddingTop: 4,
  },
  summaryName: { flex: 1, fontSize: 13 },
  summaryAmount: { fontSize: 14, fontWeight: '600' },
  couponRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  couponInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  applyButton: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  applyText: { fontSize: 14, fontWeight: '700' },
  couponNote: { fontSize: 12, paddingTop: 2 },
  couponError: { fontSize: 12, fontWeight: '600', paddingTop: 2 },
  smallButton: { marginTop: 8, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8 },
  smallButtonText: { fontSize: 14, fontWeight: '600' },
  footer: { padding: 16, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  subtotal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
  },
  subtotalLabel: { fontSize: 15, fontWeight: '600' },
  subtotalAmount: { fontSize: 18, fontWeight: '700' },
  footerNote: { fontSize: 12 },
  placeButton: { paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  placeText: { fontSize: 16, fontWeight: '700' },
});
