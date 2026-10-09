/**
 * Bank details never leave the API in full — not to admins, not even back to
 * the vendor/rider who entered them. Responses carry only the last 4 digits of
 * the account number (enough to recognise "which account"), and drop the IFSC.
 * Payouts read the full values server-side; nothing client-facing needs them.
 */
export type WithMaskedBank<T> = Omit<T, 'bankAccountNumber' | 'bankIfsc'> & {
  bankAccountLast4: string | null;
};

export function maskBankDetails<
  T extends { bankAccountNumber: string | null; bankIfsc: string | null },
>(row: T): WithMaskedBank<T> {
  const { bankAccountNumber, bankIfsc: _ifsc, ...rest } = row;
  return {
    ...rest,
    bankAccountLast4: bankAccountNumber ? bankAccountNumber.slice(-4) : null,
  };
}
