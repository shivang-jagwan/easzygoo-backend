import { useCallback, useEffect, useState } from 'react';
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
import { createAddress, myAddresses, updateAddress } from '@easzygoo/api-client';

import ScreenHeader from '../components/ScreenHeader';
import { useLocation } from '../context/LocationContext';
import { api } from '../lib/api';
import { toUserMessage } from '../lib/errors';
import { useTheme } from '../theme/ThemeContext';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'AddAddress'>;

/** The fields the backend requires. Kept in one place so both the validator
 *  and the error rendering stay in step. */
const REQUIRED = ['line1', 'city', 'pincode'] as const;
type RequiredField = (typeof REQUIRED)[number];

const REQUIRED_MESSAGE: Record<RequiredField, string> = {
  line1: 'Address line 1 is required',
  city: 'City is required',
  pincode: 'Pincode is required',
};

export default function AddAddressScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { coords, status: locationStatus, requestLocation } = useLocation();

  const editingAddressId = route.params?.editingAddressId;
  const isEditing = editingAddressId !== undefined;
  const mode = route.params?.mode ?? 'manage';

  const [label, setLabel] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RequiredField, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  /** Only meaningful while editing: the existing address is still being read. */
  const [isLoadingExisting, setIsLoadingExisting] = useState(isEditing);

  const askForLocation = useCallback(async () => {
    setLocationError(null);
    try {
      await requestLocation();
    } catch (err) {
      // Permission granted but no fix. Same block as the denied case — either
      // way there are no coordinates to attach to the address.
      console.error('[add-address] location failed:', err);
      setLocationError(toUserMessage(err));
    }
  }, [requestLocation]);

  // The customer types the address; the pin comes from where they are standing,
  // so there is nothing to enter for latitude/longitude.
  useEffect(() => {
    if (!coords) void askForLocation();
  }, [coords, askForLocation]);

  /**
   * Prefills from the saved address when editing. There is no GET /addresses/:id,
   * so the list is the only way to read one back — cheap enough, and it is the
   * same call the screen we came from just made.
   */
  useEffect(() => {
    if (!editingAddressId) return;
    let cancelled = false;

    void (async () => {
      try {
        const existing = (await myAddresses(api)).find((a) => a.id === editingAddressId);
        if (cancelled) return;
        if (!existing) {
          setSubmitError('That address no longer exists.');
          return;
        }
        setLabel(existing.label ?? '');
        setLine1(existing.line1);
        setLine2(existing.line2 ?? '');
        setCity(existing.city);
        setPincode(existing.pincode);
      } catch (err) {
        console.error('[add-address] could not load the address to edit:', err);
        if (!cancelled) setSubmitError(toUserMessage(err));
      } finally {
        if (!cancelled) setIsLoadingExisting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editingAddressId]);

  const handleSave = useCallback(async () => {
    const values: Record<RequiredField, string> = {
      line1: line1.trim(),
      city: city.trim(),
      pincode: pincode.trim(),
    };

    const errors: Partial<Record<RequiredField, string>> = {};
    for (const field of REQUIRED) {
      if (!values[field]) errors[field] = REQUIRED_MESSAGE[field];
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    // The button is disabled without coords, so this is belt-and-braces.
    if (!coords) return;

    setIsSaving(true);
    setSubmitError(null);
    try {
      const body = {
        label: label.trim() || null,
        line1: values.line1,
        line2: line2.trim() || null,
        city: values.city,
        pincode: values.pincode,
        latitude: coords.lat,
        longitude: coords.lng,
      };

      const saved = editingAddressId
        ? await updateAddress(api, editingAddressId, body)
        : await createAddress(api, body);

      if (mode === 'select') {
        // Straight back to Checkout with the address selected — stopping at the
        // list again just to tap what was only now saved is busywork.
        navigation.navigate('Main', {
          screen: 'Cart',
          params: { screen: 'Checkout', params: { selectedAddressId: saved.id } },
        });
      } else {
        // Managing the saved list: return to it, where the focus listener
        // refetches and shows the change.
        navigation.goBack();
      }
    } catch (err) {
      console.error('[add-address] create failed:', err);
      // Form state is untouched, so a retry does not mean retyping.
      setSubmitError(toUserMessage(err));
    } finally {
      setIsSaving(false);
    }
  }, [label, line1, line2, city, pincode, coords, navigation, editingAddressId, mode]);

  const shellHeader = (
    <>
      <ScreenHeader />
      <Text style={[styles.title, { color: colors.text }]}>
        {isEditing ? 'Edit address' : 'Add address'}
      </Text>
    </>
  );

  // ---------- reading the address being edited ----------

  if (isLoadingExisting) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        {shellHeader}
        <View style={styles.centre}>
          <ActivityIndicator color={colors.primaryGreen} />
        </View>
      </View>
    );
  }

  // ---------- waiting on the first fix ----------

  if (!coords && locationStatus === 'requesting') {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        {shellHeader}
        <View style={styles.centre}>
          <ActivityIndicator color={colors.primaryGreen} />
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
            Finding your location…
          </Text>
        </View>
      </View>
    );
  }

  // ---------- the form ----------

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {shellHeader}

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Denied or no fix: the form still works, so the customer can type it
            out while sorting the permission. Only Save waits on coordinates. */}
        {!coords ? (
          <View
            testID="location-blocked"
            style={[styles.banner, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.bannerTitle, { color: colors.text }]}>
              Enable location to see vendors near you
            </Text>
            <Text style={[styles.bannerText, { color: colors.textSecondary }]}>
              {locationError ?? 'We use your location only to find stores that deliver to you.'}
            </Text>
            <Pressable
              testID="retry-location"
              onPress={() => void askForLocation()}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: colors.button, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={[styles.primaryButtonText, { color: colors.buttonText }]}>
                Try again
              </Text>
            </Pressable>
          </View>
        ) : null}

        {submitError ? (
          <View
            testID="submit-error"
            style={[styles.banner, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.bannerText, { color: colors.text }]}>{submitError}</Text>
          </View>
        ) : null}

        <Field
          testID="input-label"
          label="Label"
          value={label}
          onChangeText={setLabel}
          placeholder="Home, Work, etc."
        />
        <Field
          testID="input-line1"
          label="Address line 1"
          value={line1}
          onChangeText={setLine1}
          placeholder="Flat, house no., building"
          error={fieldErrors.line1}
          errorTestID="error-line1"
        />
        <Field
          testID="input-line2"
          label="Address line 2"
          value={line2}
          onChangeText={setLine2}
          placeholder="Area, street, landmark"
        />
        <Field
          testID="input-city"
          label="City"
          value={city}
          onChangeText={setCity}
          placeholder="City"
          error={fieldErrors.city}
          errorTestID="error-city"
        />
        <Field
          testID="input-pincode"
          label="Pincode"
          value={pincode}
          onChangeText={setPincode}
          placeholder="Pincode"
          keyboardType="number-pad"
          error={fieldErrors.pincode}
          errorTestID="error-pincode"
        />

        {/* An address without coordinates cannot be delivered to, so saving
            stays shut until there is a fix. */}
        <Pressable
          testID="save"
          disabled={isSaving || !coords}
          onPress={() => void handleSave()}
          style={({ pressed }) => [
            styles.saveButton,
            {
              backgroundColor: colors.button,
              opacity: isSaving || !coords ? 0.5 : pressed ? 0.8 : 1,
            },
          ]}
        >
          <Text style={[styles.saveButtonText, { color: colors.buttonText }]}>
            {isSaving ? 'Saving…' : isEditing ? 'Save changes' : 'Save address'}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Field({
  testID,
  label,
  value,
  onChangeText,
  placeholder,
  error,
  errorTestID,
  keyboardType,
}: {
  testID: string;
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  error?: string;
  errorTestID?: string;
  keyboardType?: 'number-pad';
}) {
  const { colors } = useTheme();

  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        testID={testID}
        style={[
          styles.input,
          {
            backgroundColor: colors.card,
            color: colors.text,
            // A field that failed validation says so twice: border and text.
            borderColor: error ? colors.primaryGreen : colors.border,
          },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        keyboardType={keyboardType}
        autoCorrect={false}
      />
      {error ? (
        <Text testID={errorTestID} style={[styles.fieldError, { color: colors.text }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: { fontSize: 20, fontWeight: '700', paddingHorizontal: 16, paddingTop: 14 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  content: { padding: 16, paddingBottom: 32, gap: 14 },
  banner: { padding: 14, borderRadius: 10, borderWidth: 1, gap: 8, alignItems: 'flex-start' },
  bannerTitle: { fontSize: 14, fontWeight: '600' },
  bannerText: { fontSize: 13 },
  field: { gap: 5 },
  fieldLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  fieldError: { fontSize: 12, fontWeight: '600' },
  saveButton: { marginTop: 6, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  saveButtonText: { fontSize: 16, fontWeight: '700' },
  emptyTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  emptyBody: { fontSize: 13, textAlign: 'center' },
  primaryButton: { paddingHorizontal: 22, paddingVertical: 11, borderRadius: 8 },
  primaryButtonText: { fontSize: 15, fontWeight: '600' },
});
