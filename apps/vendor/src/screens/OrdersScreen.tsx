import { StyleSheet, Text, View } from 'react-native';

import ScreenHeader from '../components/ScreenHeader';
import { useTheme } from '../theme/ThemeContext';

/** Placeholder. Themed now so the real content lands on the right surface. */
export default function OrdersScreen() {
  const { colors } = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Orders" />
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.text }]}>Orders</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Coming soon</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 18, fontWeight: '600' },
  hint: { fontSize: 13 },
});
