import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './types';

/**
 * A handle on the root navigator for code that runs outside the tree — a
 * notification tap has no component to call navigation.navigate() from.
 * Attached to the NavigationContainer in RootNavigator.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
