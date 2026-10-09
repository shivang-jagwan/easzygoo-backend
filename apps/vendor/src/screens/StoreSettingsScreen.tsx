import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import ScreenHeader from '../components/ScreenHeader';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';

/**
 * Placeholder for store settings. Carries the sign-out for now because an
 * approved vendor has no other way out of the app, and because it is what makes
 * the auth flow testable end to end on a device.
 */
export default function StoreSettingsScreen() {
  const { phoneNumber, vendorProfile, signOut } = useAuth();
  const { colors } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const storeName = vendorProfile?.onboarded === true ? vendorProfile.vendor.storeName : null;

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
      <ScreenHeader title="Store" />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Signed in as</Text>
          <Text testID="store-name" style={[styles.value, { color: colors.text }]}>
            {storeName ?? 'Your store'}
          </Text>
          <Text testID="phone" style={[styles.label, { color: colors.textSecondary }]}>
            {phoneNumber ?? 'Phone number unavailable'}
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

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
  body: { padding: 16, gap: 12 },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 4 },
  label: { fontSize: 13 },
  value: { fontSize: 17, fontWeight: '600' },
  // See PendingApprovalScreen: error red stays outside the palette on purpose.
  error: { color: '#D64545', fontSize: 13, textAlign: 'center' },
  secondaryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
