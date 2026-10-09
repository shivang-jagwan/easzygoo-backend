/**
 * Navigator param lists. Kept in one place so screens can type their props
 * without importing from the navigator that renders them (which would be a
 * circular import).
 */

import type { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Auth: undefined;
  // Nested params so a root-level screen can send the customer back to a
  // specific tab: navigate('Main', { screen: 'Home' }).
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  /**
   * Order tracking sits at the ROOT, not inside a tab, because it is reached
   * from two different tabs — checkout in Cart, and history in Profile. Living
   * in either one would make it unreachable from the other without duplicating
   * the screen. Pushed full-screen over whichever tab is active.
   */
  OrderTracking: { orderId: string };
  /**
   * Address management is reached from checkout (pick one for this order) and
   * from Profile (curate the saved list). Same screen, two jobs — hence the mode param.
   * 'manage' is the default so the neutral entry point needs no param.
   */
  AddressList: { mode?: 'select' | 'manage' } | undefined;
  /**
   * editingAddressId turns the form into an edit of that address. mode is
   * carried through from the list so a save knows whether to hand the address
   * back to checkout or simply return to the list.
   */
  AddAddress: { editingAddressId?: string; mode?: 'select' | 'manage' } | undefined;
};

export type AuthStackParamList = {
  PhoneEntry: undefined;
  // Only serialisable values here. The live Firebase ConfirmationResult is
  // held in AuthContext instead.
  OtpVerify: { phoneNumber: string };
};

export type MainTabParamList = {
  Home: NavigatorScreenParams<HomeStackParamList> | undefined;
  Cart: NavigatorScreenParams<CartStackParamList> | undefined;
  Profile: NavigatorScreenParams<ProfileStackParamList> | undefined;
};

/**
 * The Cart tab is a stack too, so checkout pushes over it and the customer can
 * back out to their cart with the items still there.
 */
export type CartStackParamList = {
  CartHome: undefined;
  // Address selection hands its result back through a param rather than a
  // callback prop, for the same reason the OTP confirmation moved into
  // AuthContext: params have to stay serialisable.
  Checkout: { selectedAddressId?: string } | undefined;
};

/**
 * The Home tab is a stack so a vendor's storefront can push over it while the
 * bottom tabs stay visible — least disruptive place for it, and it keeps
 * Search/Cart/Profile untouched.
 */
export type HomeStackParamList = {
  HomeFeed: undefined;
  // Search is a pushed screen rather than a tab: it is entered from the Home
  // search bar and returns you there, so it does not need its own tab slot.
  Search: undefined;
  VendorStorefront: { vendorId: string; storeName: string };
};

/** The Profile tab is a stack so order history can push over it. */
export type ProfileStackParamList = {
  ProfileHome: undefined;
  OrderHistory: undefined;
};
