import type { ApiClient } from '../client';
import type { UploadSignature } from '../types';

/**
 * POST /v1/uploads/sign — VENDOR or RIDER with a profile (403 otherwise).
 * The folder is fixed server-side and is part of the signature, so upload with
 * exactly the returned values. 503 when uploads are not configured.
 */
export function signUpload(client: ApiClient): Promise<UploadSignature> {
  return client.post<UploadSignature>('/v1/uploads/sign');
}
