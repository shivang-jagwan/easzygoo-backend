import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeContext';
import Logo from './Logo';

/**
 * Shared top bar: brand mark on the left, themed surface behind it.
 * Sits at the top of every screen so chrome stays consistent as real content
 * lands underneath.
 */
export default function ScreenHeader({ title }: { title?: string }) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, borderBottomColor: colors.border },
      ]}
    >
      <Logo />
      {title ? <Text style={[styles.title, { color: colors.text }]}>{title}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 16, fontWeight: '600' },
});
