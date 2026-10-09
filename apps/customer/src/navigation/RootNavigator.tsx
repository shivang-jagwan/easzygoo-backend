import { NavigationContainer, DefaultTheme, DarkTheme, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import AddAddressScreen from '../screens/AddAddressScreen';
import AddressListScreen from '../screens/AddressListScreen';
import OrderTrackingScreen from '../screens/OrderTrackingScreen';
import AuthStack from './AuthStack';
import { navigationRef } from './navigationRef';
import MainTabs from './MainTabs';
import type { RootStackParamList } from './types';

const Root = createNativeStackNavigator<RootStackParamList>();

/**
 * Swaps between the auth flow and the signed-in app, driven by whether
 * AuthContext has resolved a backend user. Only one branch is mounted at a
 * time, so there is no back-navigation from Main into Auth.
 */
export default function RootNavigator() {
  const { user, isLoading } = useAuth();
  const { colors, resolvedMode } = useTheme();

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

  // Hold the splash until the restored session has been checked, otherwise the
  // sign-in screen flashes for a returning user.
  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator color={colors.primaryGreen} />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      <Root.Navigator screenOptions={{ headerShown: false }}>
        {user !== null ? (
          <>
            <Root.Screen name="Main" component={MainTabs} />
            {/* Above the tabs rather than inside one: checkout (Cart tab) and
                order history (Profile tab) both push it, and a screen owned by
                either tab is unreachable from the other. */}
            <Root.Screen name="OrderTracking" component={OrderTrackingScreen} />
            {/* Also above the tabs: checkout (Cart tab) and Profile both open
                these, and a screen owned by one tab is unreachable from the other. */}
            <Root.Screen name="AddressList" component={AddressListScreen} />
            <Root.Screen name="AddAddress" component={AddAddressScreen} />
          </>
        ) : (
          <Root.Screen name="Auth" component={AuthStack} />
        )}
      </Root.Navigator>
    </NavigationContainer>
  );
}
