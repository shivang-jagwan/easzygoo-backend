/**
 * Navigator param lists + the top-level app state.
 *
 * Kept in one place so screens can type their props without importing from the
 * navigator that renders them (which would be a circular import).
 */

/**
 * Which of the four top-level flows the vendor sees. Derived by
 * resolveVendorAppState() from the signed-in user plus the Vendor row's status
 * — see src/lib/vendorAppState.ts. "Still deciding" and "the check failed" are
 * deliberately NOT members here: they are handled by RootNavigator before it
 * picks a branch, so every value in this union is a real flow.
 */
export type VendorAppState = 'loggedOut' | 'onboarding' | 'pendingApproval' | 'active';

export type RootStackParamList = {
  Auth: undefined;
  Onboarding: undefined;
  PendingApproval: undefined;
  Main: undefined;
};

export type AuthStackParamList = {
  PhoneEntry: undefined;
  // Only serialisable values here. The live Firebase ConfirmationResult is
  // held in AuthContext instead.
  OtpVerify: { phoneNumber: string };
};

export type OnboardingStackParamList = {
  StoreDetails: undefined;
  BankDetails: undefined;
};

export type MainTabParamList = {
  Orders: undefined;
  Catalog: undefined;
  Earnings: undefined;
  Store: undefined;
};
