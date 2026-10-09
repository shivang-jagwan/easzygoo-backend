import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import ConfirmDialog from '../components/ConfirmDialog';
import ScreenHeader from '../components/ScreenHeader';
import { useCart, type CartItem } from '../context/CartContext';
import { formatPrice, formatUnit, round2 } from '../lib/format';
import { useTheme } from '../theme/ThemeContext';
import type { CartStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CartStackParamList, 'CartHome'>;

export default function CartScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { items, subtotal, vendorName, updateQuantity, removeItem, clearCart } = useCart();
  const [confirmingClear, setConfirmingClear] = useState(false);

  if (items.length === 0) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <ScreenHeader />
        <View style={styles.centre}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Your cart is empty</Text>
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
            Browse a store to add vegetables.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader />

      <View style={styles.titleRow}>
        {/* Which store this cart belongs to — a cart is single-vendor, and the
            customer may have arrived here from somewhere else entirely. */}
        <Text style={[styles.vendorName, { color: colors.text }]} numberOfLines={1}>
          {vendorName ?? 'Your order'}
        </Text>

        <Pressable testID="clear-cart" onPress={() => setConfirmingClear(true)} hitSlop={8}>
          {/* Deliberately a text action, not a button: destructive and rarely wanted. */}
          <Text style={[styles.clearAction, { color: colors.textSecondary }]}>Clear cart</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {items.map((item) => (
          <CartRow
            key={item.productId}
            item={item}
            onChangeQuantity={(next) => updateQuantity(item.productId, next)}
            onRemove={() => removeItem(item.productId)}
          />
        ))}
      </ScrollView>

      {/* Footer sits outside the ScrollView so it stays put as the list scrolls. */}
      <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <View style={[styles.summary, { backgroundColor: colors.offerBackground }]}>
          <Text style={[styles.summaryLabel, { color: colors.text }]}>Subtotal</Text>
          <Text testID="subtotal" style={[styles.summaryAmount, { color: colors.text }]}>
            {formatPrice(subtotal)}
          </Text>
        </View>
        {/* Not a total: the delivery fee depends on the address, which is only
            picked at checkout, and the backend is what computes it. */}
        <Text style={[styles.summaryNote, { color: colors.textSecondary }]}>
          Delivery fee is calculated at checkout.
        </Text>

        <Pressable
          testID="checkout"
          onPress={() => navigation.navigate('Checkout')}
          style={({ pressed }) => [
            styles.checkoutButton,
            { backgroundColor: colors.button, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={[styles.checkoutText, { color: colors.buttonText }]}>Checkout</Text>
        </Pressable>
      </View>

      {confirmingClear ? (
        <ConfirmDialog
          title="Clear cart?"
          message="Remove all items from your cart?"
          confirmLabel="Clear"
          onConfirm={() => {
            clearCart();
            setConfirmingClear(false);
          }}
          onCancel={() => setConfirmingClear(false)}
          confirmTestID="clear-confirm"
          cancelTestID="clear-cancel"
        />
      ) : null}
    </View>
  );
}

function CartRow({
  item,
  onChangeQuantity,
  onRemove,
}: {
  item: CartItem;
  onChangeQuantity: (next: number) => void;
  onRemove: () => void;
}) {
  const { colors } = useTheme();

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardMain}>
        <Text style={[styles.itemName, { color: colors.text }]}>{item.name}</Text>
        {/* One string, so the line wraps as a line rather than at each seam. */}
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {`${formatUnit(item.unit, item.unitValue)} · ${formatPrice(item.price)} each`}
        </Text>

        {/* Separate from stepping down to zero: some customers look for an
            explicit remove and will not decrement their way there. */}
        <Pressable testID={`remove-${item.productId}`} onPress={onRemove} hitSlop={6}>
          <Text style={[styles.removeAction, { color: colors.textSecondary }]}>Remove</Text>
        </Pressable>
      </View>

      <View style={styles.cardSide}>
        <Text testID={`line-total-${item.productId}`} style={[styles.lineTotal, { color: colors.text }]}>
          {formatPrice(round2(item.price * item.quantity))}
        </Text>

        <View style={[styles.stepper, { borderColor: colors.button }]}>
          <Pressable
            testID={`dec-${item.productId}`}
            onPress={() => onChangeQuantity(item.quantity - 1)}
            style={({ pressed }) => [styles.stepperButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.stepperSymbol, { color: colors.button }]}>−</Text>
          </Pressable>

          <Text style={[styles.stepperCount, { color: colors.text }]}>{item.quantity}</Text>

          <Pressable
            testID={`inc-${item.productId}`}
            // No stock ceiling here: the cart does not carry stockQty. Placing
            // the order is what validates availability, with a 409.
            onPress={() => onChangeQuantity(item.quantity + 1)}
            style={({ pressed }) => [styles.stepperButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.stepperSymbol, { color: colors.button }]}>+</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  vendorName: { flex: 1, fontSize: 20, fontWeight: '700' },
  clearAction: { fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
  content: { paddingTop: 8, paddingBottom: 16 },
  card: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  cardMain: { flex: 1, gap: 2 },
  cardSide: { alignItems: 'flex-end', gap: 8 },
  itemName: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 13 },
  removeAction: { fontSize: 12, fontWeight: '600', textDecorationLine: 'underline', paddingTop: 4 },
  lineTotal: { fontSize: 16, fontWeight: '700' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  stepperButton: { paddingHorizontal: 12, paddingVertical: 5 },
  stepperSymbol: { fontSize: 18, fontWeight: '700', lineHeight: 22 },
  stepperCount: { fontSize: 15, fontWeight: '700', minWidth: 22, textAlign: 'center' },
  footer: { padding: 16, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
  },
  summaryLabel: { fontSize: 15, fontWeight: '600' },
  summaryAmount: { fontSize: 18, fontWeight: '700' },
  summaryNote: { fontSize: 12 },
  checkoutButton: { paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  checkoutText: { fontSize: 16, fontWeight: '700' },
  emptyTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  emptyBody: { fontSize: 13, textAlign: 'center' },
});
