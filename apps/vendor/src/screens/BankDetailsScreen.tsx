import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import ScreenHeader from '../components/ScreenHeader';
import { useTheme } from '../theme/ThemeContext';
import type { OnboardingStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'BankDetails'>;

export default function BankDetailsScreen(_props: Props) {
  const { colors } = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Bank details" />
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.text }]}>Bank details</Text>
        {/* TODO: bankAccountNumber, bankIfsc. Submitting posts the whole
            onboarding payload, then calls refreshVendor() from AuthContext —
            the new Vendor row comes back status PENDING, which is what moves
            the app on to 'pendingApproval'. Nothing navigates by hand. */}
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Account number, IFSC</Text>
        <Pressable
          onPress={() => {}}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.button, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={[styles.buttonText, { color: colors.buttonText }]}>Submit</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  title: { fontSize: 18, fontWeight: '600' },
  hint: { fontSize: 13, textAlign: 'center' },
  button: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
