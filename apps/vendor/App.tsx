import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from './src/context/AuthContext';
import RootNavigator from './src/navigation/RootNavigator';
import { ThemeProvider } from './src/theme/ThemeContext';

export default function App() {
  return (
    <SafeAreaProvider>
      {/* Theme is outermost: the auth screens, the loading gate and the
          profile-fetch error state all need colours before there is a user.
          Which flow renders is computed inside RootNavigator from auth plus
          GET /v1/vendors/me — there is no hand-flipped state constant. */}
      <ThemeProvider>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
