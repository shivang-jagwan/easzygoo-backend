import { ApiError } from '@easzygoo/api-client';

/**
 * Turns any thrown value into something worth showing a vendor.
 *
 * api-client normalises every request failure into ApiError, so there is no
 * transport branch here: status 0 means the request never reached the server,
 * anything else carries the backend's own human-written `{ error }` string.
 * Non-ApiError throws come from outside the API layer (e.g. expo-location).
 */
export function toUserMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.status === 0 ? 'Check your connection and try again.' : err.message;
  }
  return 'Something went wrong. Please try again.';
}
