import { createNativeStackNavigator } from '@react-navigation/native-stack';

import PhoneEntryScreen from '../screens/PhoneEntryScreen';
import OtpVerifyScreen from '../screens/OtpVerifyScreen';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

/** Phone + OTP sign-in. Shown while there is no stored token. */
export default function AuthStack() {
  return (
    // headerShown: false — every screen draws its own ScreenHeader, and the
    // navigator's title bar on top of that is two headers stacked.
    <Stack.Navigator initialRouteName="PhoneEntry" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="PhoneEntry" component={PhoneEntryScreen} />
      <Stack.Screen name="OtpVerify" component={OtpVerifyScreen} />
    </Stack.Navigator>
  );
}
