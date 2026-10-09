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
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { listCategories, nearbyVendors, type Category, type NearbyVendor } from '@easzygoo/api-client';

import ScreenHeader from '../components/ScreenHeader';
import { useLocation, type Coords } from '../context/LocationContext';
import { api } from '../lib/api';
import { toUserMessage } from '../lib/errors';
import { useTheme } from '../theme/ThemeContext';
import type { HomeStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<HomeStackParamList, 'HomeFeed'>;

/** State of the feed request itself. Location state lives in LocationContext. */
type FeedStatus = 'loading' | 'ready' | 'error';

export default function HomeScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { coords, status: locationStatus, requestLocation } = useLocation();

  const [feedStatus, setFeedStatus] = useState<FeedStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [vendors, setVendors] = useState<NearbyVendor[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  /**
   * Loads categories and nearby vendors together for a known position.
   * `isRefresh` keeps the existing content on screen and drives RefreshControl
   * instead of swapping the whole screen for a spinner.
   */
  const loadFeed = useCallback(async (at: Coords, isRefresh = false) => {
    if (isRefresh) setIsRefreshing(true);
    else setFeedStatus('loading');
    setErrorMessage(null);

    try {
      // Both requests go out together — one spinner covers the whole screen
      // rather than two sections resolving at different times.
      const [nextCategories, nextVendors] = await Promise.all([
        listCategories(api),
        nearbyVendors(api, at.lat, at.lng),
      ]);

      setCategories(nextCategories);
      setVendors(nextVendors);
      setFeedStatus('ready');
    } catch (err) {
      // Keep the raw cause in the logs; show the user something actionable.
      console.error('[home] feed load failed:', err);
      setErrorMessage(toUserMessage(err));
      setFeedStatus('error');
    } finally {
      if (isRefresh) setIsRefreshing(false);
    }
  }, []);

  /**
   * Asks the shared context for a position. A refused permission lands in
   * `locationStatus`; a granted-but-no-fix failure throws and becomes this
   * screen's own error state.
   */
  const askForLocation = useCallback(async () => {
    setErrorMessage(null);
    try {
      await requestLocation();
    } catch (err) {
      console.error('[home] location failed:', err);
      setErrorMessage(toUserMessage(err));
      setFeedStatus('error');
    }
  }, [requestLocation]);

  // Home is normally the first screen to need a position. If another screen
  // already obtained one, requestLocation() short-circuits and coords are there.
  useEffect(() => {
    void askForLocation();
  }, [askForLocation]);

  // Coords can arrive after mount, so load off the value rather than sequencing
  // the fetch directly after the request.
  useEffect(() => {
    if (coords) void loadFeed(coords);
  }, [coords, loadFeed]);

  const onRefresh = useCallback(() => {
    if (coords) void loadFeed(coords, true);
    else void askForLocation();
  }, [coords, loadFeed, askForLocation]);

  /** Header + search bar wrap every state, so each branch supplies only its body. */
  const shell = (body: ReactNode) => (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader />
      <Pressable
        onPress={() => navigation.navigate('Search')}
        style={({ pressed }) => [
          styles.searchBar,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text style={[styles.searchPlaceholder, { color: colors.textSecondary }]}>
          Search shops and vegetables
        </Text>
      </Pressable>
      {body}
    </View>
  );

  // ---------- non-ready states ----------

  if (locationStatus === 'denied') {
    return shell(
      <View style={styles.centre}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          Enable location to see vendors near you
        </Text>
        <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
          We use your location only to find stores that deliver to you.
        </Text>
        <PrimaryButton label="Try again" onPress={() => void askForLocation()} />
      </View>,
    );
  }

  if (feedStatus === 'error') {
    return shell(
      <View style={styles.centre}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Could not load your feed</Text>
        <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>{errorMessage}</Text>
        <PrimaryButton
          label="Retry"
          onPress={() => (coords ? void loadFeed(coords) : void askForLocation())}
        />
      </View>,
    );
  }

  if (feedStatus === 'loading') {
    return shell(
      <View style={styles.centre}>
        <ActivityIndicator color={colors.primaryGreen} />
      </View>,
    );
  }

  // ---------- ready ----------

  return shell(
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          tintColor={colors.primaryGreen}
          colors={[colors.primaryGreen]}
        />
      }
    >
      {categories.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {categories.map((category) => {
            const active = category.id === selectedCategoryId;
            return (
              <Pressable
                key={category.id}
                // Selection is cosmetic for now; filtering belongs to Search.
                onPress={() => setSelectedCategoryId(active ? null : category.id)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.primaryGreen : colors.card,
                    borderColor: active ? colors.primaryGreen : colors.border,
                  },
                ]}
              >
                <Text
                  style={[styles.chipText, { color: active ? colors.buttonText : colors.text }]}
                >
                  {category.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Vendors near you</Text>

      {vendors.length === 0 ? (
        <View style={styles.centrePadded}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No vendors near you yet</Text>
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
            Pull down to refresh once stores start delivering in your area.
          </Text>
        </View>
      ) : (
        vendors.map((vendor) => (
          <Pressable
            key={vendor.id}
            onPress={() =>
              navigation.navigate('VendorStorefront', {
                vendorId: vendor.id,
                storeName: vendor.storeName,
              })
            }
            style={({ pressed }) => [
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View style={styles.cardMain}>
              <Text style={[styles.storeName, { color: colors.text }]}>{vendor.storeName}</Text>
              <Text style={[styles.distance, { color: colors.textSecondary }]}>
                {vendor.distanceKm} km away
              </Text>
            </View>

            {/* nearbyVendors only returns open + approved vendors today, so this
                never renders yet — here for when that endpoint widens. */}
            {isClosed(vendor) ? (
              <View style={[styles.badge, { backgroundColor: colors.border }]}>
                <Text style={[styles.badgeText, { color: colors.textSecondary }]}>Closed</Text>
              </View>
            ) : null}
          </Pressable>
        ))
      )}
    </ScrollView>,
  );
}

/** NearbyVendor has no isOpen field yet; treat a future one as authoritative. */
function isClosed(vendor: NearbyVendor): boolean {
  return (vendor as NearbyVendor & { isOpen?: boolean }).isOpen === false;
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
  searchBar: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchPlaceholder: { fontSize: 15 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  centrePadded: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 40 },
  content: { paddingBottom: 32 },
  chipRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 14, fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 8 },
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
  cardMain: { flex: 1, gap: 2 },
  storeName: { fontSize: 16, fontWeight: '600' },
  distance: { fontSize: 13 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  emptyTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  emptyBody: { fontSize: 13, textAlign: 'center' },
  button: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
