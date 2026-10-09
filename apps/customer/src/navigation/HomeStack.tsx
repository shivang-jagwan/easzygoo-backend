import { createNativeStackNavigator } from '@react-navigation/native-stack';

import HomeScreen from '../screens/HomeScreen';
import SearchScreen from '../screens/SearchScreen';
import VendorStorefrontScreen from '../screens/VendorStorefrontScreen';
import type { HomeStackParamList } from './types';

const Stack = createNativeStackNavigator<HomeStackParamList>();

/**
 * Wraps the Home tab so a vendor storefront can be pushed on top of it. The
 * bottom tab bar stays visible; headers are off because each screen renders
 * its own ScreenHeader.
 */
export default function HomeStack() {
  return (
    <Stack.Navigator initialRouteName="HomeFeed" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HomeFeed" component={HomeScreen} />
      <Stack.Screen name="Search" component={SearchScreen} />
      <Stack.Screen name="VendorStorefront" component={VendorStorefrontScreen} />
    </Stack.Navigator>
  );
}
