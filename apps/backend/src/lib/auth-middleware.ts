import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Role } from '@prisma/client';
import { prisma } from './prisma';

/**
 * The parts of a verified Firebase ID token the API relies on. firebase-admin's
 * DecodedIdToken satisfies it; tests supply a fake verifier returning just this.
 */
export interface VerifiedToken {
  uid: string;
  phone_number?: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

/** Turns a raw ID token into a VerifiedToken, or throws if it is invalid/expired. */
export type TokenVerifier = (idToken: string) => Promise<VerifiedToken>;

/**
 * The production verifier. firebase-admin is loaded on first use rather than at
 * import, so code paths (and tests) that inject their own verifier never need
 * Firebase credentials.
 */
export const firebaseTokenVerifier: TokenVerifier = async (idToken) => {
  const { firebaseAuth } = await import('./firebase');
  return firebaseAuth.verifyIdToken(idToken);
};

export interface AuthUser {
  userId: string;
  role: Role;
  phone: string;
  firebaseUid: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
  interface FastifyInstance {
    /** Set by buildApp(); firebaseTokenVerifier unless a test injects a fake. */
    verifyToken: TokenVerifier;
  }
}

/** Thrown by `verifyBearerToken`; carries the HTTP status a caller should reply with. */
export class AuthError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Verifies a raw Firebase ID token with the Admin SDK. Returns the decoded token.
 * Throws `AuthError` (401) if the token is missing, invalid, or expired.
 *
 * This is the single implementation of token verification — HTTP requests reach
 * it through `verifyBearerToken`, Socket.io handshakes call it directly with
 * `socket.handshake.auth.token`.
 */
export async function verifyFirebaseToken(
  rawToken: string | undefined,
  verifier: TokenVerifier = firebaseTokenVerifier,
): Promise<VerifiedToken> {
  const idToken = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (!idToken) {
    throw new AuthError(401, 'Missing token');
  }
  try {
    return await verifier(idToken);
  } catch {
    throw new AuthError(401, 'Invalid or expired token');
  }
}

/**
 * Pulls the `Authorization: Bearer <Firebase ID token>` header off a Fastify
 * request and verifies it via `verifyFirebaseToken`.
 *
 * Shared by `requireAuth` and the POST /v1/auth/verify signup route.
 */
export async function verifyBearerToken(request: FastifyRequest): Promise<VerifiedToken> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new AuthError(401, 'Missing or malformed Authorization header');
  }
  return verifyFirebaseToken(header.slice('Bearer '.length), request.server.verifyToken);
}

/**
 * Verifies the Firebase ID token, resolves the matching User row, and attaches it
 * to `request.authUser`. Responds 401 if the token is missing, invalid, or has no
 * matching user.
 *
 * POST /v1/auth/verify is the one route that intentionally skips this — it is the
 * signup endpoint, so it must run before the User row exists.
 */
export const requireAuth: preHandlerHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  let decoded: VerifiedToken;
  try {
    decoded = await verifyBearerToken(request);
  } catch (err) {
    const e = err as AuthError;
    return reply.code(e.statusCode).send({ error: e.message });
  }

  const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } });
  if (!user) {
    return reply.code(401).send({ error: 'No account for this token' });
  }

  request.authUser = {
    userId: user.id,
    role: user.role,
    phone: user.phone,
    firebaseUid: user.firebaseUid,
  };
};

/**
 * Guards a route to a single role. Must run after `requireAuth` in the
 * preHandler chain. Responds 401 if unauthenticated, 403 if the role mismatches.
 */
export function requireRole(role: Role): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.authUser) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    if (request.authUser.role !== role) {
      return reply.code(403).send({ error: `Requires ${role} role` });
    }
  };
}
