import { NavigationContainer, DefaultTheme, DarkTheme, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../context/AuthContext';
import { resolveVendorAppState } from '../lib/vendorAppState';
import { useTheme } from '../theme/ThemeContext';
import AuthStack from './AuthStack';
import OnboardingStack from './OnboardingStack';
import MainTabs from './MainTabs';
import PendingApprovalScreen from '../screens/PendingApprovalScreen';
import type { RootStackParamList } from './types';

const Root = createNativeStackNavigator<RootStackParamList>();

/**
 * Switches between the four top-level flows:
 *
 *   loggedOut       -> AuthStack               phone + OTP
 *   onboarding      -> OnboardingStack         store details, then bank details
 *   pendingApproval -> PendingApprovalScreen   blocked: PENDING, REJECTED or SUSPENDED
 *   active          -> MainTabs                the approved vendor's app
 *
 * Exactly one branch is mounted at a time, so there is no back-navigation
 * between flows. Which one is computed from auth + GET /v1/vendors/me rather
 * than chosen by hand; the two non-flow outcomes (still loading, fetch failed)
 * are handled here, above the navigator.
 */
export default function RootNavigator() {
  const { isLoading, user, vendorProfile, vendorError, refreshVendor } = useAuth();
  const { colors, resolvedMode } = useTheme();

  const gate = resolveVendorAppState({
    isAuthLoading: isLoading,
    user,
    profile: vendorProfile,
    profileError: vendorError !== null,
  });

  // Feed our tokens to React Navigation so its own chrome — tab bar, headers,
  // card backgrounds — matches instead of falling back to its defaults.
  const base = resolvedMode === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme: Theme = {
    ...base,
    dark: resolvedMode === 'dark',
    colors: {
      ...base.colors,
      background: colors.background,
      card: colors.card,
      text: colors.text,
      border: colors.border,
      primary: colors.primaryGreen,
      notification: colors.primaryGreen,
    },
  };

  // Hold the splash until the restored session and the vendor's own profile
  // have both been checked, otherwise the sign-in screen flashes for a
  // returning vendor and the onboarding form flashes for an approved one.
  if (gate.kind === 'loading') {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]} testID="root-loading">
        <ActivityIndicator color={colors.primaryGreen} />
      </View>
    );
  }

  // The profile fetch failed, so which flow this vendor belongs in is genuinely
  // unknown. Say so and offer a retry rather than guessing — guessing
  // 'onboarding' would show an approved vendor a signup form.
  if (gate.kind === 'error') {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]} testID="root-error">
        <Text style={[styles.errorTitle, { color: colors.text }]}>Could not load your store</Text>
        <Text style={[styles.errorBody, { color: colors.textSecondary }]}>
          {vendorError ?? 'Check your connection and try again.'}
        </Text>
        <Pressable
          testID="root-retry"
          onPress={() => void refreshVendor()}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.button, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={[styles.buttonText, { color: colors.buttonText }]}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const { state } = gate;

  return (
    <NavigationContainer theme={navTheme}>
      <Root.Navigator screenOptions={{ headerShown: false }}>
        {state === 'loggedOut' && <Root.Screen name="Auth" component={AuthStack} />}
        {state === 'onboarding' && <Root.Screen name="Onboarding" component={OnboardingStack} />}
        {state === 'pendingApproval' && (
          <Root.Screen name="PendingApproval" component={PendingApprovalScreen} />
        )}
        {state === 'active' && <Root.Screen name="Main" component={MainTabs} />}
      </Root.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  errorTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  errorBody: { fontSize: 13, textAlign: 'center' },
  button: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, marginTop: 4 },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
