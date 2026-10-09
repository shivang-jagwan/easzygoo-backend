import type { ApiClient } from '../client';
import type { UpdateMeRequest, UserProfile } from '../types';

/** PATCH /v1/users/me — any signed-in account; name and email only. */
export function updateMe(client: ApiClient, data: UpdateMeRequest): Promise<UserProfile> {
  return client.patch<UserProfile>('/v1/users/me', data);
}
