import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { onForegroundNotification, type ForegroundNotification } from '../lib/notifications';
import { useTheme } from '../theme/ThemeContext';

/** How long a foreground banner stays up before sliding away. */
const VISIBLE_MS = 4000;

/**
 * The in-app banner for notifications that arrive while the app is open — FCM
 * draws nothing itself in the foreground. Deliberately not tappable yet: the
 * customer is already mid-task, and navigating out from under them on a banner
 * they may not have meant to touch is worse than making them open it later.
 */
export default function NotificationBanner() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [notification, setNotification] = useState<ForegroundNotification | null>(null);

  useEffect(() => onForegroundNotification(setNotification), []);

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [notification]);

  if (!notification) return null;

  return (
    <Animated.View
      testID="notification-banner"
      pointerEvents="none"
      style={[
        styles.banner,
        {
          top: insets.top + 8,
          backgroundColor: colors.card,
          borderColor: colors.primaryGreen,
        },
      ]}
    >
      <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
        {notification.title}
      </Text>
      {notification.body ? (
        <Text style={[styles.body, { color: colors.textSecondary }]} numberOfLines={2}>
          {notification.body}
        </Text>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 2,
    // Above the navigator, including any modal a screen has open.
    zIndex: 100,
    elevation: 8,
  },
  title: { fontSize: 15, fontWeight: '700' },
  body: { fontSize: 13 },
});
