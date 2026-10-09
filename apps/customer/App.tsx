import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import NotificationBanner from './src/components/NotificationBanner';
import { AuthProvider } from './src/context/AuthContext';
import { CartProvider } from './src/context/CartContext';
import { LocationProvider } from './src/context/LocationContext';
import { setupNotificationHandlers } from './src/lib/notifications';
import { navigationRef } from './src/navigation/navigationRef';
import RootNavigator from './src/navigation/RootNavigator';
import { ThemeProvider } from './src/theme/ThemeContext';

export default function App() {
  // Once, for the life of the app. The ref rather than a navigation prop,
  // because a notification tap arrives from outside the component tree.
  useEffect(() => setupNotificationHandlers(navigationRef), []);

  return (
    <SafeAreaProvider>
      {/* Theme is outermost: auth screens and the loading state both need it.
          Location sits inside auth but above the navigator, so Home and Search
          share one permission check and one GPS fix. Cart is inside auth too —
          it does not read auth state today, but it will become user-scoped. */}
      <ThemeProvider>
        <AuthProvider>
          <LocationProvider>
            <CartProvider>
              <RootNavigator />
              {/* Outside the navigator so it floats over whatever is on screen. */}
              <NotificationBanner />
            </CartProvider>
          </LocationProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
