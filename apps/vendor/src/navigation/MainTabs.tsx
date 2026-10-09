import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import OrdersScreen from '../screens/OrdersScreen';
import CatalogScreen from '../screens/CatalogScreen';
import EarningsScreen from '../screens/EarningsScreen';
import StoreSettingsScreen from '../screens/StoreSettingsScreen';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

/**
 * The approved vendor's app. Analytics and Promotions from the PRD live inside
 * Earnings and Catalog respectively — they are not top-level tabs.
 */
export default function MainTabs() {
  return (
    // headerShown: false — each screen draws its own ScreenHeader, so the
    // navigator's title bar would be a second header above it.
    <Tab.Navigator initialRouteName="Orders" screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Orders" component={OrdersScreen} />
      <Tab.Screen name="Catalog" component={CatalogScreen} />
      <Tab.Screen name="Earnings" component={EarningsScreen} />
      <Tab.Screen name="Store" component={StoreSettingsScreen} />
    </Tab.Navigator>
  );
}
