import { createNativeStackNavigator } from '@react-navigation/native-stack';

import StoreDetailsScreen from '../screens/StoreDetailsScreen';
import BankDetailsScreen from '../screens/BankDetailsScreen';
import type { OnboardingStackParamList } from './types';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

/**
 * One-time vendor profile creation, shown after sign-in when the account has
 * no Vendor row yet. Together these two screens collect the body of
 * POST /v1/vendors/onboard.
 */
export default function OnboardingStack() {
  return (
    // headerShown: false — see AuthStack; each screen carries its own header.
    <Stack.Navigator initialRouteName="StoreDetails" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="StoreDetails" component={StoreDetailsScreen} />
      <Stack.Screen name="BankDetails" component={BankDetailsScreen} />
    </Stack.Navigator>
  );
}
