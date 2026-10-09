import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import ScreenHeader from '../components/ScreenHeader';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import type { AuthStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'PhoneEntry'>;

export default function PhoneEntryScreen({ navigation }: Props) {
  const { sendOtp, setPendingConfirmation } = useAuth();
  const { colors } = useTheme();
  const [phone, setPhone] = useState('+91');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = phone.trim().length < 8;

  async function onSendOtp() {
    setError(null);
    setIsSending(true);
    try {
      // Firebase requires E.164 (+911234567890). No country-code picker yet,
      // so the field is pre-seeded with +91 and sent through as typed.
      const confirmation = await sendOtp(phone.trim());
      // The confirmation is a live Firebase object, so it goes into context;
      // route params stay serialisable.
      setPendingConfirmation(confirmation);
      navigation.navigate('OtpVerify', { phoneNumber: phone.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code');
    } finally {
      setIsSending(false);
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader />
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.text }]}>Enter your phone number</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Sign in to manage your EaszyGoo store
        </Text>

        <TextInput
          style={[
            styles.input,
            { borderColor: colors.border, color: colors.text, backgroundColor: colors.card },
          ]}
          value={phone}
          onChangeText={setPhone}
          placeholder="+91 98765 43210"
          placeholderTextColor={colors.textSecondary}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          editable={!isSending}
          autoFocus
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {isSending ? (
          <ActivityIndicator color={colors.primaryGreen} />
        ) : (
          <Pressable
            onPress={onSendOtp}
            disabled={disabled}
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: disabled ? colors.border : colors.button,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.buttonText,
                { color: disabled ? colors.textSecondary : colors.buttonText },
              ]}
            >
              Send OTP
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  title: { fontSize: 18, fontWeight: '600' },
  subtitle: { fontSize: 13, textAlign: 'center' },
  input: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  // Error red is intentionally not a theme token — it must stay legible on
  // both palettes and never be confused with brand colours.
  error: { color: '#D64545', fontSize: 13, textAlign: 'center' },
  button: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
