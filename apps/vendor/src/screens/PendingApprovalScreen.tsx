import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { VendorStatus } from '@easzygoo/api-client';

import ScreenHeader from '../components/ScreenHeader';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';

/**
 * The three statuses that park a vendor here all mean "you cannot take orders",
 * but they mean very different things to the person reading the screen, and
 * they call for different next steps. PENDING is a wait; REJECTED and SUSPENDED
 * are decisions that no amount of waiting will change — telling a rejected
 * vendor their store is "under review" would leave them refreshing forever.
 */
const COPY: Record<Exclude<VendorStatus, 'APPROVED'>, { title: string; body: string }> = {
  PENDING: {
    title: 'Your store is under review',
    body: 'We are verifying your store and bank details. You will be able to start taking orders as soon as it is approved.',
  },
  REJECTED: {
    title: 'Your application was not approved',
    body: 'Our team could not verify the details you submitted. Contact EaszyGoo support to find out what is missing and to apply again.',
  },
  SUSPENDED: {
    title: 'Your store is suspended',
    body: 'Your store has been paused and is not visible to customers right now. Contact EaszyGoo support to resolve this and get it back online.',
  },
};

// Falls back to the PENDING wording only if the status is somehow absent —
// the neutral, non-alarming choice when we do not actually know.
const FALLBACK = COPY.PENDING;

/**
 * Shown between submitting onboarding and an admin approving the Vendor row,
 * and also for the two statuses that block an already-onboarded vendor.
 */
export default function PendingApprovalScreen() {
  const { vendorStatus, refreshVendor, signOut } = useAuth();
  const { colors } = useTheme();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = vendorStatus && vendorStatus !== 'APPROVED' ? COPY[vendorStatus] : FALLBACK;

  async function onCheckAgain() {
    setError(null);
    setIsRefreshing(true);
    try {
      // If this comes back APPROVED, RootNavigator swaps the whole screen out
      // for MainTabs — there is nothing to navigate to from here.
      await refreshVendor();
    } finally {
      setIsRefreshing(false);
    }
  }

  async function onSignOut() {
    setError(null);
    setIsSigningOut(true);
    try {
      await signOut();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign out');
      setIsSigningOut(false);
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader />
      <ScrollView contentContainerStyle={styles.body}>
        <Text testID="status-title" style={[styles.title, { color: colors.text }]}>
          {copy.title}
        </Text>
        <Text testID="status-body" style={[styles.bodyText, { color: colors.textSecondary }]}>
          {copy.body}
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {isRefreshing ? (
          <ActivityIndicator color={colors.primaryGreen} />
        ) : (
          <Pressable
            testID="check-again"
            onPress={onCheckAgain}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: colors.button, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={[styles.buttonText, { color: colors.buttonText }]}>Check again</Text>
          </Pressable>
        )}

        {/* Without this a rejected or suspended vendor has no way out of the
            app at all — this is the only screen their account can reach. */}
        <Pressable
          testID="sign-out"
          onPress={onSignOut}
          disabled={isSigningOut}
          style={({ pressed }) => [
            styles.secondaryButton,
            { borderColor: colors.border, opacity: pressed || isSigningOut ? 0.6 : 1 },
          ]}
        >
          <Text style={[styles.buttonText, { color: colors.textSecondary }]}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  title: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  bodyText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  // Error red stays outside the palette on purpose: it must read as an error in
  // both themes and never be mistaken for a brand colour.
  error: { color: '#D64545', fontSize: 13, textAlign: 'center' },
  button: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, marginTop: 8 },
  secondaryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 16,
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
