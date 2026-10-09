import { createNativeStackNavigator } from '@react-navigation/native-stack';

import PhoneEntryScreen from '../screens/PhoneEntryScreen';
import OtpVerifyScreen from '../screens/OtpVerifyScreen';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

/**
 * Phone + OTP sign-in flow. Shown while there is no stored token. Headers are
 * off; each screen renders its own ScreenHeader, so the navigator's title bar
 * would sit on top of it as a second header.
 */
export default function AuthStack() {
  return (
    <Stack.Navigator initialRouteName="PhoneEntry" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="PhoneEntry" component={PhoneEntryScreen} />
      <Stack.Screen name="OtpVerify" component={OtpVerifyScreen} />
    </Stack.Navigator>
  );
}
