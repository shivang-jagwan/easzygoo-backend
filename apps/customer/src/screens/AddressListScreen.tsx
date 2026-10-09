import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { deleteAddress, myAddresses, type Address } from '@easzygoo/api-client';

import ConfirmDialog from '../components/ConfirmDialog';
import ScreenHeader from '../components/ScreenHeader';
import { api } from '../lib/api';
import { toUserMessage } from '../lib/errors';
import { useTheme } from '../theme/ThemeContext';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'AddressList'>;

type Status = 'loading' | 'ready' | 'error';

export default function AddressListScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  // 'manage' is the neutral default, so opening this from anywhere that has no
  // order in progress does the harmless thing.
  const mode = route.params?.mode ?? 'manage';

  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [deleting, setDeleting] = useState<Address | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    try {
      // Already ordered default-first, then newest — no client-side sorting.
      setAddresses(await myAddresses(api));
      setStatus('ready');
    } catch (err) {
      console.error('[addresses] load failed:', err);
      setErrorMessage(toUserMessage(err));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Returning from the form — new address or an edit — has to show the change.
  useEffect(() => navigation.addListener('focus', () => void load()), [navigation, load]);

  const handleDelete = useCallback(async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    setActionError(null);
    try {
      await deleteAddress(api, target.id);
      // Deleting the default promotes another one server-side, so refetch
      // rather than splicing it out locally and guessing at the new default.
      await load();
    } catch (err) {
      console.error('[addresses] delete failed:', err);
      setActionError(toUserMessage(err));
    }
  }, [deleting, load]);

  const shell = (body: ReactNode) => (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader />
      <Text style={[styles.title, { color: colors.text }]}>
        {mode === 'select' ? 'Delivery address' : 'Saved addresses'}
      </Text>
      {body}
    </View>
  );

  const addNewRow = (
    <Pressable
      testID="add-new"
      onPress={() => navigation.navigate('AddAddress', { mode })}
      style={({ pressed }) => [
        styles.addRow,
        { borderColor: colors.button, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={[styles.addRowText, { color: colors.button }]}>+ Add new address</Text>
    </Pressable>
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
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          Could not load your addresses
        </Text>
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

  if (addresses.length === 0) {
    return shell(
      <View style={styles.centre}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>No saved addresses yet</Text>
        <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
          Add one so we know where to deliver.
        </Text>
        {addNewRow}
      </View>,
    );
  }

  return shell(
    <>
      <ScrollView contentContainerStyle={styles.content}>
        {actionError ? (
          <View
            testID="action-error"
            style={[styles.banner, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.emptyBody, { color: colors.text }]}>{actionError}</Text>
          </View>
        ) : null}

        {addresses.map((address) => {
          const body = (
            <>
              <View style={styles.cardHeader}>
                <Text style={[styles.label, { color: colors.text }]}>
                  {address.label ?? 'Address'}
                </Text>
                {address.isDefault ? (
                  <View style={[styles.badge, { backgroundColor: colors.offerBackground }]}>
                    <Text style={[styles.badgeText, { color: colors.primaryGreen }]}>Default</Text>
                  </View>
                ) : null}
              </View>

              <Text style={[styles.line, { color: colors.textSecondary }]}>{address.line1}</Text>
              {address.line2 ? (
                <Text style={[styles.line, { color: colors.textSecondary }]}>{address.line2}</Text>
              ) : null}
              <Text style={[styles.line, { color: colors.textSecondary }]}>
                {`${address.city} ${address.pincode}`}
              </Text>
            </>
          );

          const cardStyle = {
            backgroundColor: colors.card,
            borderColor: address.isDefault ? colors.primaryGreen : colors.border,
          };

          // Choosing an address only means something when an order is waiting
          // on one, so the whole card is tappable in 'select' and inert in
          // 'manage', where the per-row actions do the work instead.
          if (mode === 'select') {
            return (
              <Pressable
                key={address.id}
                testID={`address-${address.id}`}
                onPress={() =>
                  navigation.navigate('Main', {
                    screen: 'Cart',
                    params: { screen: 'Checkout', params: { selectedAddressId: address.id } },
                  })
                }
                style={({ pressed }) => [styles.card, cardStyle, { opacity: pressed ? 0.85 : 1 }]}
              >
                {body}
              </Pressable>
            );
          }

          return (
            <View key={address.id} testID={`address-${address.id}`} style={[styles.card, cardStyle]}>
              {body}

              <View style={styles.actions}>
                <Pressable
                  testID={`edit-${address.id}`}
                  onPress={() =>
                    navigation.navigate('AddAddress', { editingAddressId: address.id, mode })
                  }
                  hitSlop={6}
                >
                  <Text style={[styles.action, { color: colors.button }]}>Edit</Text>
                </Pressable>

                <Pressable testID={`delete-${address.id}`} onPress={() => setDeleting(address)} hitSlop={6}>
                  <Text style={[styles.action, { color: colors.textSecondary }]}>Delete</Text>
                </Pressable>
              </View>
            </View>
          );
        })}

        {addNewRow}
      </ScrollView>

      {deleting ? (
        <ConfirmDialog
          title="Delete this address?"
          message={`${deleting.label ?? 'This address'} will be removed from your saved addresses.`}
          confirmLabel="Delete"
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleting(null)}
          confirmTestID="delete-confirm"
          cancelTestID="delete-cancel"
        />
      ) : null}
    </>,
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: { fontSize: 20, fontWeight: '700', paddingHorizontal: 16, paddingTop: 14 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  content: { paddingTop: 12, paddingBottom: 32 },
  banner: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  card: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 2 },
  label: { flex: 1, fontSize: 16, fontWeight: '600' },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  line: { fontSize: 13 },
  actions: { flexDirection: 'row', gap: 18, paddingTop: 10 },
  action: { fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  addRow: {
    marginHorizontal: 16,
    marginTop: 6,
    paddingVertical: 13,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  addRowText: { fontSize: 15, fontWeight: '600' },
  emptyTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  emptyBody: { fontSize: 13, textAlign: 'center' },
  primaryButton: { paddingHorizontal: 22, paddingVertical: 11, borderRadius: 8 },
  primaryButtonText: { fontSize: 15, fontWeight: '600' },
});
