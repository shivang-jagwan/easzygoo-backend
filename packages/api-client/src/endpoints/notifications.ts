import type { ApiClient } from '../client';
import type { PushToken } from '../types';

/**
 * POST /v1/notifications/register-token — upserts on the token itself, so the
 * same device switching accounts re-points the row at the new user.
 */
export function registerPushToken(
  client: ApiClient,
  token: string,
  platform?: string,
): Promise<PushToken> {
  return client.post<PushToken>('/v1/notifications/register-token', { token, platform });
}
