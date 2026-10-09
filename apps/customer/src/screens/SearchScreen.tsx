import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { search, type SearchResults } from '@easzygoo/api-client';

import ScreenHeader from '../components/ScreenHeader';
import { useLocation, type Coords } from '../context/LocationContext';
import { api } from '../lib/api';
import { toUserMessage } from '../lib/errors';
import { useTheme } from '../theme/ThemeContext';
import type { HomeStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<HomeStackParamList, 'Search'>;

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 400;

type Status = 'idle' | 'searching' | 'ready' | 'error';

export default function SearchScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { coords, status: locationStatus, requestLocation } = useLocation();

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [results, setResults] = useState<SearchResults>({ vendors: [], products: [] });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  /** The query the currently displayed results belong to. */
  const [resultsFor, setResultsFor] = useState('');

  // Identifies the latest in-flight search so a slow earlier response cannot
  // overwrite a newer one.
  const requestId = useRef(0);

  const runSearch = useCallback(async (q: string, at: Coords) => {
    const id = ++requestId.current;
    setStatus('searching');
    setErrorMessage(null);

    try {
      const next = await search(api, q, at.lat, at.lng);

      if (id !== requestId.current) return; // superseded
      setResults(next);
      setResultsFor(q);
      setStatus('ready');
    } catch (err) {
      if (id !== requestId.current) return;
      console.error('[search] failed:', err);
      setErrorMessage(toUserMessage(err));
      setStatus('error');
    }
  }, []);

  const askForLocation = useCallback(async () => {
    setLocationError(null);
    try {
      await requestLocation();
    } catch (err) {
      // Permission is fine but there is no fix — show it in the same block as
      // the denied case, since both leave us without coords.
      console.error('[search] location failed:', err);
      setLocationError(toUserMessage(err));
    }
  }, [requestLocation]);

  // Home normally has coords by the time this screen is pushed, in which case
  // this short-circuits inside the context and no native call happens. It only
  // does real work if Search was reached without Home ever getting a position.
  useEffect(() => {
    if (!coords) void askForLocation();
  }, [coords, askForLocation]);

  // Debounce: only the last keystroke in a 400ms window fires a request. With
  // coords already in hand there is no permission round trip in the way, so the
  // request goes out the moment the window closes.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      // Cancel anything in flight so its result can't land after we go idle.
      requestId.current += 1;
      setStatus('idle');
      setResults({ vendors: [], products: [] });
      return;
    }
    if (!coords) return; // the location block is showing instead

    const timer = setTimeout(() => void runSearch(q, coords), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, coords, runSearch]);

  const openVendor = useCallback(
    (vendorId: string, storeName: string) =>
      navigation.navigate('VendorStorefront', { vendorId, storeName }),
    [navigation],
  );

  const isEmpty =
    status === 'ready' && results.vendors.length === 0 && results.products.length === 0;

  /** Everything below the input; the input itself stays mounted in every state. */
  const body = ((): ReactNode => {
    if (!coords) {
      if (locationStatus === 'requesting') {
        return (
          <View style={styles.centre}>
            <ActivityIndicator color={colors.primaryGreen} />
          </View>
        );
      }
      return (
        <View style={styles.centre}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            Enable location to see vendors near you
          </Text>
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
            {locationError ?? 'We use your location only to find stores that deliver to you.'}
          </Text>
          <PrimaryButton label="Try again" onPress={() => void askForLocation()} />
        </View>
      );
    }

    if (status === 'searching') {
      return (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.primaryGreen} />
        </View>
      );
    }

    if (status === 'error') {
      return (
        <View style={styles.centre}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Could not search</Text>
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>{errorMessage}</Text>
          <PrimaryButton label="Retry" onPress={() => void runSearch(query.trim(), coords)} />
        </View>
      );
    }

    if (isEmpty) {
      return (
        <View style={styles.centre}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            No results for “{resultsFor}”
          </Text>
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
            Try a different word, or check back as more stores join.
          </Text>
        </View>
      );
    }

    if (status !== 'ready') return null; // idle — nothing under the input yet

    return (
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {results.vendors.length > 0 ? (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Shops</Text>
            {results.vendors.map((vendor) => (
              <Pressable
                key={vendor.id}
                onPress={() => openVendor(vendor.id, vendor.storeName)}
                style={({ pressed }) => [
                  styles.card,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text style={[styles.primaryLine, { color: colors.text }]}>{vendor.storeName}</Text>
                <Text style={[styles.secondaryLine, { color: colors.textSecondary }]}>
                  {vendor.distanceKm} km away
                </Text>
              </Pressable>
            ))}
          </>
        ) : null}

        {results.products.length > 0 ? (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Vegetables</Text>
            {results.products.map((product) => (
              <Pressable
                key={product.id}
                // A cart is single-vendor, so adding an item means going to
                // that item's store — land the customer there directly.
                onPress={() => openVendor(product.vendor.id, product.vendor.storeName)}
                style={({ pressed }) => [
                  styles.card,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text style={[styles.primaryLine, { color: colors.text }]}>{product.name}</Text>
                <Text style={[styles.secondaryLine, { color: colors.textSecondary }]}>
                  {product.vendor.storeName} · {product.vendor.distanceKm} km away
                </Text>
              </Pressable>
            ))}
          </>
        ) : null}
      </ScrollView>
    );
  })();

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader />

      <View style={styles.searchRow}>
        <TextInput
          style={[
            styles.input,
            { backgroundColor: colors.card, borderColor: colors.border, color: colors.text },
          ]}
          value={query}
          onChangeText={setQuery}
          placeholder="Search shops and vegetables"
          placeholderTextColor={colors.textSecondary}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {body}
    </View>
  );
}

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.button, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={[styles.buttonText, { color: colors.buttonText }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  searchRow: { paddingHorizontal: 16, paddingVertical: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  content: { paddingBottom: 32 },
  sectionTitle: { fontSize: 16, fontWeight: '700', paddingHorizontal: 16, paddingVertical: 8 },
  card: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  primaryLine: { fontSize: 16, fontWeight: '600' },
  secondaryLine: { fontSize: 13 },
  emptyTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  emptyBody: { fontSize: 13, textAlign: 'center' },
  button: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
