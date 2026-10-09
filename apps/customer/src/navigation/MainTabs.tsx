import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import CartStack from './CartStack';
import HomeStack from './HomeStack';
import ProfileStack from './ProfileStack';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

/**
 * The signed-in app. Search is deliberately not a tab — it is reached from the
 * Home search bar and pushed over the Home stack.
 *
 * headerShown: false — the nested stacks already turn their own headers off,
 * but this navigator draws one too, which landed a route-name title directly
 * above every screen's ScreenHeader. The tab bar itself is unaffected.
 */
export default function MainTabs() {
  return (
    <Tab.Navigator initialRouteName="Home" screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Home" component={HomeStack} />
      <Tab.Screen name="Cart" component={CartStack} />
      <Tab.Screen name="Profile" component={ProfileStack} />
    </Tab.Navigator>
  );
}
