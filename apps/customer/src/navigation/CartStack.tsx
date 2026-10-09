import { createNativeStackNavigator } from '@react-navigation/native-stack';

import CartScreen from '../screens/CartScreen';
import CheckoutScreen from '../screens/CheckoutScreen';
import type { CartStackParamList } from './types';

const Stack = createNativeStackNavigator<CartStackParamList>();

/**
 * Wraps the Cart tab so checkout can be pushed on top of it, the same way the
 * Home tab wraps the vendor storefront. Headers are off; each screen renders
 * its own ScreenHeader.
 */
export default function CartStack() {
  return (
    <Stack.Navigator initialRouteName="CartHome" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="CartHome" component={CartScreen} />
      <Stack.Screen name="Checkout" component={CheckoutScreen} />
    </Stack.Navigator>
  );
}
