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
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DecimalString, ProductUnit } from '@easzygoo/api-client';

const STORAGE_KEY = 'easzygoo:cart';

/**
 * What a screen hands to addItem. Structurally satisfied by both `Product`
 * (vendor storefront) and `SearchProductHit` (search results) — the latter also
 * carries the vendor, which is where the store name for the conflict prompt
 * comes from.
 */
export interface CartProduct {
  id: string;
  name: string;
  price: DecimalString;
  unit: ProductUnit;
  unitValue: number;
  vendor?: { storeName: string };
}

/**
 * A line in the cart. `price` is a number: the Decimal string from the wire is
 * parsed exactly once, here, so no screen ever does arithmetic on a string.
 */
export interface CartItem {
  productId: string;
  name: string;
  price: number;
  unit: ProductUnit;
  unitValue: number;
  quantity: number;
}

/**
 * Why an addItem call did not go through.
 *  - 'different-vendor': the cart already holds items from another store. A
 *    cart is single-vendor (the orders endpoint rejects mixed ones), so the
 *    screen must confirm with the customer and then call replaceCart.
 *  - 'invalid-price': the product's price did not parse as a finite number.
 *    Should not happen against our own backend, but refusing beats silently
 *    treating the item as free.
 */
export type AddItemFailure = 'different-vendor' | 'invalid-price';

export type AddItemResult =
  | { ok: true }
  | {
      ok: false;
      reason: AddItemFailure;
      /** Set for 'different-vendor' — who the cart currently belongs to. */
      currentVendorId?: string;
      /** Store name for the prompt, when whatever filled the cart knew it. */
      currentVendorName?: string | null;
    };

interface CartContextValue {
  /** The single vendor this cart belongs to. Null exactly when items is empty. */
  vendorId: string | null;
  /** Null when unknown — screens should fall back to a generic phrase. */
  vendorName: string | null;
  items: CartItem[];
  /** Sum of price x quantity, rounded to 2dp. Derived, never stored. */
  subtotal: number;
  addItem: (vendorId: string, product: CartProduct, quantity?: number) => AddItemResult;
  /** Throws away the current cart and starts a new one at this vendor. */
  replaceCart: (vendorId: string, product: CartProduct, quantity?: number) => void;
  removeItem: (productId: string) => void;
  /** A quantity of 0 or less removes the line, same as removeItem. */
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  /** False until the persisted cart has been read back on launch. */
  isRestored: boolean;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

/** The persisted shape. Bump the version when this changes incompatibly. */
interface PersistedCart {
  version: 1;
  vendorId: string | null;
  vendorName: string | null;
  items: CartItem[];
}

const CART_VERSION = 1;

export function CartProvider({ children }: { children: ReactNode }) {
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState<string | null>(null);
  const [items, setItems] = useState<CartItem[]>([]);
  const [isRestored, setIsRestored] = useState(false);

  // addItem has to know the current vendor synchronously to return a conflict
  // rather than a promise, and a state value read inside the callback would be
  // the one captured at render. This ref is the same value, readable now.
  const vendorIdRef = useRef<string | null>(null);
  vendorIdRef.current = vendorId;

  // ---------- persistence ----------

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const restored = raw ? parsePersisted(raw) : null;
        if (!cancelled && restored) {
          setVendorId(restored.vendorId);
          setVendorName(restored.vendorName);
          setItems(restored.items);
        }
      } catch (err) {
        // An unreadable cart is not worth blocking the app for — start empty
        // and let the next write replace it.
        console.error('[cart] restore failed:', err);
      } finally {
        if (!cancelled) setIsRestored(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Guard: without this, the empty initial state would be written over the
    // stored cart in the moment before the restore resolves.
    if (!isRestored) return;

    const payload: PersistedCart = { version: CART_VERSION, vendorId, vendorName, items };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch((err) => {
      console.error('[cart] persist failed:', err);
    });
  }, [isRestored, vendorId, vendorName, items]);

  // ---------- mutations ----------

  /** Discards whatever was in the cart and opens a new one at this vendor. */
  const startCart = useCallback(
    (nextVendorId: string, product: CartProduct, price: number, quantity: number) => {
      setVendorId(nextVendorId);
      vendorIdRef.current = nextVendorId;
      setVendorName(product.vendor?.storeName ?? null);
      setItems([toCartItem(product, price, quantity)]);
    },
    [],
  );

  const addItem = useCallback(
    (nextVendorId: string, product: CartProduct, quantity = 1): AddItemResult => {
      const price = Number(product.price);
      if (!Number.isFinite(price)) {
        console.error('[cart] unparseable price:', product.price, 'for product', product.id);
        return { ok: false, reason: 'invalid-price' };
      }
      if (quantity <= 0) return { ok: true }; // nothing asked for, nothing to do

      const current = vendorIdRef.current;

      if (current !== null && current !== nextVendorId) {
        // Neither merge nor replace — the screen decides, then calls replaceCart.
        return {
          ok: false,
          reason: 'different-vendor',
          currentVendorId: current,
          currentVendorName: vendorName,
        };
      }

      if (current === null) {
        startCart(nextVendorId, product, price, quantity);
        return { ok: true };
      }

      // Same vendor: a product already in the cart gains quantity rather than
      // appearing as a second row.
      setItems((prev) => {
        const existing = prev.find((item) => item.productId === product.id);
        if (!existing) return [...prev, toCartItem(product, price, quantity)];
        return prev.map((item) =>
          item.productId === product.id ? { ...item, quantity: item.quantity + quantity } : item,
        );
      });

      // Cart opened from the storefront (no vendor on the product), now added to
      // from search (which carries one) — worth learning the name late.
      if (!vendorName && product.vendor?.storeName) {
        setVendorName(product.vendor.storeName);
      }

      return { ok: true };
    },
    [startCart, vendorName],
  );

  const replaceCart = useCallback(
    (nextVendorId: string, product: CartProduct, quantity = 1) => {
      const price = Number(product.price);
      if (!Number.isFinite(price)) {
        console.error('[cart] unparseable price:', product.price, 'for product', product.id);
        return;
      }
      startCart(nextVendorId, product, price, Math.max(1, quantity));
    },
    [startCart],
  );

  const removeItem = useCallback((productId: string) => {
    setItems((prev) => {
      const next = prev.filter((item) => item.productId !== productId);
      // An empty cart has no vendor, so the next add can start anywhere.
      if (next.length === 0) {
        setVendorId(null);
        vendorIdRef.current = null;
        setVendorName(null);
      }
      return next;
    });
  }, []);

  const updateQuantity = useCallback(
    (productId: string, quantity: number) => {
      if (quantity <= 0) {
        removeItem(productId);
        return;
      }
      setItems((prev) =>
        prev.map((item) => (item.productId === productId ? { ...item, quantity } : item)),
      );
    },
    [removeItem],
  );

  const clearCart = useCallback(() => {
    setItems([]);
    setVendorId(null);
    vendorIdRef.current = null;
    setVendorName(null);
  }, []);

  const subtotal = useMemo(
    () => round2(items.reduce((sum, item) => sum + item.price * item.quantity, 0)),
    [items],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      vendorId,
      vendorName,
      items,
      subtotal,
      addItem,
      replaceCart,
      removeItem,
      updateQuantity,
      clearCart,
      isRestored,
    }),
    [
      vendorId,
      vendorName,
      items,
      subtotal,
      addItem,
      replaceCart,
      removeItem,
      updateQuantity,
      clearCart,
      isRestored,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used inside <CartProvider>');
  }
  return ctx;
}

function toCartItem(product: CartProduct, price: number, quantity: number): CartItem {
  return {
    productId: product.id,
    name: product.name,
    price,
    unit: product.unit,
    unitValue: product.unitValue,
    quantity,
  };
}

/** Float money drifts (0.1 + 0.2); keep the running total at 2dp. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Validates whatever came out of storage. Anything unrecognised is discarded
 * rather than trusted — a half-parsed cart is worse than an empty one.
 */
function parsePersisted(raw: string): PersistedCart | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const candidate = parsed as Partial<PersistedCart>;
  if (candidate.version !== CART_VERSION) return null;
  if (!Array.isArray(candidate.items)) return null;

  const items = candidate.items.filter(isCartItem);
  if (items.length !== candidate.items.length) return null;

  const vendorId = typeof candidate.vendorId === 'string' ? candidate.vendorId : null;
  const vendorName = typeof candidate.vendorName === 'string' ? candidate.vendorName : null;

  // The two have to agree, or the cart is unusable: items with no vendor cannot
  // be ordered, and a vendor with no items is a lock on an empty cart.
  if (items.length === 0 && vendorId !== null) return null;
  if (items.length > 0 && vendorId === null) return null;

  return { version: CART_VERSION, vendorId, vendorName, items };
}

function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.productId === 'string' &&
    typeof item.name === 'string' &&
    typeof item.price === 'number' &&
    Number.isFinite(item.price) &&
    typeof item.unit === 'string' &&
    typeof item.unitValue === 'number' &&
    typeof item.quantity === 'number' &&
    item.quantity > 0
  );
}
