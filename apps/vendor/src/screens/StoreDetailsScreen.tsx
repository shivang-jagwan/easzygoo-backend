import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import ScreenHeader from '../components/ScreenHeader';
import { useTheme } from '../theme/ThemeContext';
import type { OnboardingStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'StoreDetails'>;

export default function StoreDetailsScreen({ navigation }: Props) {
  const { colors } = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Store details" />
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.text }]}>Store details</Text>
        {/* TODO: storeName, address, pincode, latitude, longitude, openTime,
            closeTime — these become the body of POST /v1/vendors/onboard. */}
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Store name, address, pincode, location, hours
        </Text>
        <Pressable
          onPress={() => navigation.navigate('BankDetails')}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.button, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={[styles.buttonText, { color: colors.buttonText }]}>Continue</Text>
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
