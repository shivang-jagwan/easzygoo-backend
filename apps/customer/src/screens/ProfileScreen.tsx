import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';

import ConfirmDialog from '../components/ConfirmDialog';
import ScreenHeader from '../components/ScreenHeader';
import { useAuth } from '../context/AuthContext';
import { useTheme, type ThemeMode } from '../theme/ThemeContext';
import type { ProfileStackParamList, RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<ProfileStackParamList, 'ProfileHome'>;

const THEME_OPTIONS: { mode: ThemeMode; label: string }[] = [
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
  { mode: 'system', label: 'System' },
];

export default function ProfileScreen({ navigation }: Props) {
  const { colors, mode, resolvedMode, setMode } = useTheme();
  const { phoneNumber, signOut } = useAuth();

  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  /** Address management lives on the root stack, so it goes through the parent. */
  const openAddresses = useCallback(() => {
    navigation
      .getParent<NativeStackNavigationProp<RootStackParamList>>()
      ?.navigate('AddressList', { mode: 'manage' });
  }, [navigation]);

  const handleSignOut = useCallback(async () => {
    setConfirmingSignOut(false);
    setSignOutError(null);
    try {
      // RootNavigator swaps to the auth stack off the back of this, so there is
      // nothing to navigate to here.
      await signOut();
    } catch (err) {
      console.error('[profile] sign out failed:', err);
      setSignOutError('Could not sign out. Please try again.');
    }
  }, [signOut]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader />
      <Text style={[styles.title, { color: colors.text }]}>Profile</Text>

      <ScrollView contentContainerStyle={styles.content}>
        {/* No name is collected anywhere yet, so the phone number is the whole
            identity we can honestly show. */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>Signed in as</Text>
          <Text testID="phone-number" style={[styles.phone, { color: colors.text }]}>
            {phoneNumber ?? 'Phone number unavailable'}
          </Text>
        </View>

        <Row testID="saved-addresses" label="Saved Addresses" onPress={openAddresses} />
        <Row
          testID="order-history"
          label="Order History"
          onPress={() => navigation.navigate('OrderHistory')}
        />

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>Theme</Text>

          <View style={styles.segmented}>
            {THEME_OPTIONS.map((option) => {
              const active = option.mode === mode;
              return (
                <Pressable
                  key={option.mode}
                  testID={`theme-${option.mode}`}
                  onPress={() => setMode(option.mode)}
                  style={({ pressed }) => [
                    styles.segment,
                    {
                      backgroundColor: active ? colors.button : 'transparent',
                      borderColor: active ? colors.button : colors.border,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      { color: active ? colors.buttonText : colors.text },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {mode === 'system' ? (
            <Text testID="system-note" style={[styles.note, { color: colors.textSecondary }]}>
              {`Following your device — currently ${resolvedMode}.`}
            </Text>
          ) : null}
        </View>

        {signOutError ? (
          <Text testID="sign-out-error" style={[styles.note, { color: colors.text }]}>
            {signOutError}
          </Text>
        ) : null}

        {/* Set apart from the rows above by spacing and a hollow, borderless
            treatment: it is the one action here that undoes everything else. */}
        <Pressable
          testID="sign-out"
          onPress={() => setConfirmingSignOut(true)}
          style={({ pressed }) => [
            styles.signOut,
            { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.signOutText, { color: colors.textSecondary }]}>Sign Out</Text>
        </Pressable>
      </ScrollView>

      {confirmingSignOut ? (
        <ConfirmDialog
          title="Sign out?"
          message="Sign out of EaszyGoo?"
          confirmLabel="Sign out"
          cancelLabel="Stay signed in"
          onConfirm={() => void handleSignOut()}
          onCancel={() => setConfirmingSignOut(false)}
          confirmTestID="sign-out-confirm"
          cancelTestID="sign-out-cancel"
        />
      ) : null}
    </View>
  );
}

function Row({
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
        styles.row,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
      <Text style={[styles.rowChevron, { color: colors.textSecondary }]}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: { fontSize: 20, fontWeight: '700', paddingHorizontal: 16, paddingTop: 14 },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  cardLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600' },
  phone: { fontSize: 18, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  rowLabel: { flex: 1, fontSize: 16, fontWeight: '600' },
  rowChevron: { fontSize: 20, fontWeight: '600' },
  segmented: { flexDirection: 'row', gap: 8 },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  segmentText: { fontSize: 14, fontWeight: '700' },
  note: { fontSize: 12 },
  signOut: {
    marginTop: 24,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  signOutText: { fontSize: 15, fontWeight: '700' },
});
