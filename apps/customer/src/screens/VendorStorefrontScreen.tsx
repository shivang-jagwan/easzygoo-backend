import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { listCategories, listVendorProducts, type Category, type Product } from '@easzygoo/api-client';

import ConfirmDialog from '../components/ConfirmDialog';
import ScreenHeader from '../components/ScreenHeader';
import { useCart } from '../context/CartContext';
import { api } from '../lib/api';
import { toUserMessage } from '../lib/errors';
import { formatPrice, formatUnit } from '../lib/format';
import { useTheme } from '../theme/ThemeContext';
import type { HomeStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<HomeStackParamList, 'VendorStorefront'>;

type Status = 'loading' | 'ready' | 'error';

/** A product prepared for display — price parsed once, at fetch time. */
interface Row {
  product: Product;
  price: number;
  /** Nothing to sell: withdrawn from the catalogue, or none left. */
  soldOut: boolean;
}

interface Section {
  categoryId: string;
  name: string;
  rows: Row[];
}

/** What the "start a new cart?" dialog needs to know while it is open. */
interface PendingSwitch {
  product: Product;
  otherVendorName: string | null;
}

export default function VendorStorefrontScreen({ route }: Props) {
  const { colors } = useTheme();
  const { vendorId, storeName } = route.params;
  const cart = useCart();

  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  /** Product whose price would not parse; shown inline on that row only. */
  const [unavailableId, setUnavailableId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    try {
      // Products carry only a categoryId, so the names for the section headers
      // come from the catalogue in the same round trip.
      const [nextProducts, nextCategories] = await Promise.all([
        listVendorProducts(api, vendorId),
        listCategories(api),
      ]);
      setProducts(nextProducts);
      setCategories(nextCategories);
      setStatus('ready');
    } catch (err) {
      console.error('[storefront] load failed:', err);
      setErrorMessage(toUserMessage(err));
      setStatus('error');
    }
  }, [vendorId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Grouping and price parsing both happen here, so neither runs per render as
  // the cart changes underneath.
  const sections = useMemo(() => groupByCategory(products, categories), [products, categories]);

  /** productId -> quantity, so each row is an O(1) lookup rather than a scan. */
  const quantities = useMemo(() => {
    const map = new Map<string, number>();
    // Only this vendor's cart is relevant; another vendor's items are a
    // conflict to resolve, not quantities to show here.
    if (cart.vendorId === vendorId) {
      for (const item of cart.items) map.set(item.productId, item.quantity);
    }
    return map;
  }, [cart.items, cart.vendorId, vendorId]);

  const handleAdd = useCallback(
    (product: Product) => {
      setUnavailableId(null);
      const result = cart.addItem(vendorId, product, 1);
      if (result.ok) return;

      if (result.reason === 'different-vendor') {
        setPendingSwitch({ product, otherVendorName: result.currentVendorName ?? null });
        return;
      }
      // 'invalid-price' — a bad price is this one product's problem, so it stays
      // on its row. No dialog: there is nothing for the customer to decide.
      setUnavailableId(product.id);
    },
    [cart, vendorId],
  );

  const confirmSwitch = useCallback(() => {
    if (!pendingSwitch) return;
    cart.replaceCart(vendorId, pendingSwitch.product, 1);
    setPendingSwitch(null);
  }, [cart, pendingSwitch, vendorId]);

  const shell = (body: ReactNode) => (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader />
      <Text style={[styles.storeName, { color: colors.text }]}>{storeName}</Text>
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
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Could not load this store</Text>
        <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>{errorMessage}</Text>
        <Pressable
          testID="retry"
          onPress={() => void load()}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: colors.button, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={[styles.primaryButtonText, { color: colors.buttonText }]}>Retry</Text>
        </Pressable>
      </View>,
    );
  }

  if (products.length === 0) {
    return shell(
      <View style={styles.centre}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          This store hasn’t added any products yet.
        </Text>
        <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
          Check back soon — they may still be setting up.
        </Text>
      </View>,
    );
  }

  return shell(
    <>
      <ScrollView contentContainerStyle={styles.content}>
        {sections.map((section) => (
          <View key={section.categoryId}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{section.name}</Text>

            {section.rows.map((row) => (
              <ProductRow
                key={row.product.id}
                row={row}
                quantity={quantities.get(row.product.id) ?? 0}
                showUnavailable={unavailableId === row.product.id}
                onAdd={() => handleAdd(row.product)}
                onChangeQuantity={(next) => cart.updateQuantity(row.product.id, next)}
              />
            ))}
          </View>
        ))}
      </ScrollView>

      {pendingSwitch ? (
        <ConfirmDialog
          title="Start a new cart?"
          message={`Starting a new cart will remove items from ${
            pendingSwitch.otherVendorName ?? 'your other cart'
          }. Continue?`}
          onConfirm={confirmSwitch}
          onCancel={() => setPendingSwitch(null)}
          confirmTestID="switch-confirm"
          cancelTestID="switch-cancel"
        />
      ) : null}
    </>,
  );
}

function ProductRow({
  row,
  quantity,
  showUnavailable,
  onAdd,
  onChangeQuantity,
}: {
  row: Row;
  quantity: number;
  showUnavailable: boolean;
  onAdd: () => void;
  onChangeQuantity: (next: number) => void;
}) {
  const { colors } = useTheme();
  const { product, price, soldOut } = row;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
        // Sold-out rows stay visible but recede — the customer may come back.
        soldOut ? styles.cardDisabled : null,
      ]}
    >
      <View style={styles.cardMain}>
        <Text style={[styles.productName, { color: soldOut ? colors.textSecondary : colors.text }]}>
          {product.name}
        </Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {`${formatUnit(product.unit, product.unitValue)} · ${formatPrice(price)}`}
        </Text>
        {showUnavailable ? (
          <Text style={[styles.rowError, { color: colors.textSecondary }]}>
            Unavailable right now
          </Text>
        ) : null}
      </View>

      {soldOut ? (
        <Text style={[styles.soldOut, { color: colors.textSecondary }]}>Out of stock</Text>
      ) : quantity === 0 ? (
        <Pressable
          testID={`add-${product.id}`}
          onPress={onAdd}
          style={({ pressed }) => [
            styles.addButton,
            { backgroundColor: colors.button, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={[styles.addButtonText, { color: colors.buttonText }]}>Add</Text>
        </Pressable>
      ) : (
        <View style={[styles.stepper, { borderColor: colors.button }]}>
          <Pressable
            testID={`dec-${product.id}`}
            onPress={() => onChangeQuantity(quantity - 1)}
            style={({ pressed }) => [styles.stepperButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.stepperSymbol, { color: colors.button }]}>−</Text>
          </Pressable>

          <Text style={[styles.stepperCount, { color: colors.text }]}>{quantity}</Text>

          <Pressable
            testID={`inc-${product.id}`}
            // Stock is the ceiling: letting the count run past it only defers
            // the failure to order placement, which rejects it with a 409.
            disabled={quantity >= product.stockQty}
            onPress={() => onChangeQuantity(Math.min(quantity + 1, product.stockQty))}
            style={({ pressed }) => [
              styles.stepperButton,
              { opacity: quantity >= product.stockQty ? 0.35 : pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={[styles.stepperSymbol, { color: colors.button }]}>+</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/**
 * Groups products under their category, in the catalogue's own sortOrder.
 * A product whose category is missing from the catalogue still gets shown,
 * under "Other", rather than disappearing from the store.
 */
function groupByCategory(products: Product[], categories: Category[]): Section[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const grouped = new Map<string, Row[]>();

  for (const product of products) {
    const rows = grouped.get(product.categoryId);
    const row: Row = {
      product,
      price: Number(product.price),
      soldOut: product.isActive === false || product.stockQty <= 0,
    };
    if (rows) rows.push(row);
    else grouped.set(product.categoryId, [row]);
  }

  return [...grouped.entries()]
    .map(([categoryId, rows]) => ({
      categoryId,
      name: byId.get(categoryId)?.name ?? 'Other',
      rows: rows.sort((a, b) => a.product.name.localeCompare(b.product.name)),
      sortOrder: byId.get(categoryId)?.sortOrder ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map(({ categoryId, name, rows }) => ({ categoryId, name, rows }));
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  storeName: { fontSize: 20, fontWeight: '700', paddingHorizontal: 16, paddingTop: 14 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  content: { paddingTop: 8, paddingBottom: 32 },
  sectionTitle: { fontSize: 15, fontWeight: '700', paddingHorizontal: 16, paddingVertical: 10 },
  card: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardDisabled: { opacity: 0.55 },
  cardMain: { flex: 1, gap: 2 },
  productName: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 13 },
  rowError: { fontSize: 12, fontStyle: 'italic', paddingTop: 2 },
  soldOut: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  addButton: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8 },
  addButtonText: { fontSize: 14, fontWeight: '700' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  stepperButton: { paddingHorizontal: 14, paddingVertical: 6 },
  stepperSymbol: { fontSize: 18, fontWeight: '700', lineHeight: 22 },
  stepperCount: { fontSize: 15, fontWeight: '700', minWidth: 22, textAlign: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  emptyBody: { fontSize: 13, textAlign: 'center' },
  primaryButton: { paddingHorizontal: 22, paddingVertical: 11, borderRadius: 8 },
  primaryButtonText: { fontSize: 15, fontWeight: '600' },
});
