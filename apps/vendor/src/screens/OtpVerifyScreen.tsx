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

type Props = NativeStackScreenProps<AuthStackParamList, 'OtpVerify'>;

const CODE_LENGTH = 6;

export default function OtpVerifyScreen({ route, navigation }: Props) {
  const { confirmOtp, pendingConfirmation } = useAuth();
  const { colors } = useTheme();
  const { phoneNumber } = route.params;

  const [code, setCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = code.length !== CODE_LENGTH;

  async function onVerify() {
    if (!pendingConfirmation) return;
    setError(null);
    setIsVerifying(true);
    try {
      await confirmOtp(pendingConfirmation, code.trim());
      // Nothing to navigate to on success: AuthContext sets `user`, and
      // RootNavigator swaps this whole stack out for MainTabs.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code did not work');
      setIsVerifying(false);
    }
  }

  // Reachable if the app was backgrounded long enough to lose the in-memory
  // confirmation, or the screen is entered without going through PhoneEntry.
  if (!pendingConfirmation) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <ScreenHeader />
        <View style={styles.body}>
          <Text style={[styles.title, { color: colors.text }]}>This code has expired</Text>
          <Pressable
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: colors.button, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={[styles.buttonText, { color: colors.buttonText }]}>Start over</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader />
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.text }]}>Enter the OTP</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Sent to {phoneNumber}
        </Text>

        <TextInput
          style={[
            styles.input,
            { borderColor: colors.border, color: colors.text, backgroundColor: colors.card },
          ]}
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, CODE_LENGTH))}
          placeholder="123456"
          placeholderTextColor={colors.textSecondary}
          keyboardType="number-pad"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          maxLength={CODE_LENGTH}
          editable={!isVerifying}
          autoFocus
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {isVerifying ? (
          <ActivityIndicator color={colors.primaryGreen} />
        ) : (
          <Pressable
            onPress={onVerify}
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
              Verify
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
  subtitle: { fontSize: 13 },
  input: {
    width: '60%',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 22,
    letterSpacing: 8,
    textAlign: 'center',
  },
  // See PhoneEntryScreen: error red stays outside the palette on purpose.
  error: { color: '#D64545', fontSize: 13, textAlign: 'center' },
  button: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
