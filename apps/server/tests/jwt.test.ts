import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signJwt, verifyJwt } from '../src/auth/jwt';
import { authMiddleware } from '../src/auth/middleware';
import { initJwtSecret } from '../src/config';

// The auth middleware reads the live `jwtSecret` binding from config and calls
// DB-backed session-service functions. We pin the secret via env (so the real
// config/jwt code is exercised) and stub only the DB-backed session calls.
const TEST_SECRET = 'unit-test-secret-do-not-use-in-prod';

vi.mock('../src/services/session.service', () => ({
  isTokenRevoked: () => false,
  hashToken: (t: string) => `hash:${t}`,
  touchSession: () => {},
}));

/** Minimal FastifyReply stand-in supporting the chained calls the middleware uses. */
function makeReply() {
  let code = 200;
  let sent = false;
  let payload: any = undefined;
  const headers: Record<string, any> = {};
  const reply: any = {
    headers,
    // Fastify's reply.code(n) is a method that sets the status and returns the reply.
    code(n: number) {
      code = n;
      return this;
    },
    header(k: string, v: any) {
      headers[k] = v;
      return this;
    },
    send(data: any) {
      sent = true;
      payload = data;
      return this;
    },
  };
  // Read-only accessors for assertions (statusCode is Fastify's getter for the code).
  Object.defineProperty(reply, 'statusCode', { get: () => code });
  Object.defineProperty(reply, 'sent', { get: () => sent });
  Object.defineProperty(reply, 'payload', { get: () => payload });
  return reply;
}

/** Minimal FastifyRequest stand-in with an optional Bearer token. */
function makeReq(token: string | null) {
  const headers: Record<string, any> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return { headers, user: undefined as any };
}

describe('verifyJwt (signature / expiry)', () => {
  it('accepts a regular JWT (no type field)', () => {
    const token = signJwt({ sub: 1, username: 'alice', role: 'user' }, TEST_SECRET);
    const payload = verifyJwt(token, TEST_SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe(1);
    expect(payload!.username).toBe('alice');
    expect(payload!.role).toBe('user');
    expect(payload!.type).toBeUndefined();
  });

  it('returns a 2fa-temp token still marked with its type (verifyJwt does not reject it)', () => {
    // verifyJwt only validates signature + expiry. The 2fa-temp restriction is
    // enforced by the auth middleware, not by verifyJwt — so the payload comes
    // back "marked" with type: '2fa-temp'.
    const token = signJwt({ sub: 1, username: 'alice', role: 'user', type: '2fa-temp' }, TEST_SECRET);
    const payload = verifyJwt(token, TEST_SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.type).toBe('2fa-temp');
  });

  it('rejects a token signed with the wrong secret', () => {
    const token = signJwt({ sub: 1, username: 'alice', role: 'user' }, 'some-other-secret');
    expect(verifyJwt(token, TEST_SECRET)).toBeNull();
  });

  it('rejects an expired token', () => {
    // A negative ttl produces an already-expired exp, which verifyJwt must refuse.
    const token = signJwt({ sub: 1, username: 'alice', role: 'user' }, TEST_SECRET, -100);
    expect(verifyJwt(token, TEST_SECRET)).toBeNull();
  });
});

describe('authMiddleware (2FA temp-token enforcement)', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    initJwtSecret();
  });

  it('rejects a 2fa-temp token with 401 and does not set req.user', async () => {
    const token = signJwt({ sub: 1, username: 'alice', role: 'user', type: '2fa-temp' }, TEST_SECRET);
    const req = makeReq(token);
    const reply = makeReply();
    await authMiddleware(req, reply);
    expect(reply.sent).toBe(true);
    expect(reply.statusCode).toBe(401);
    expect(req.user).toBeUndefined();
  });

  it('accepts a regular token and sets req.user', async () => {
    const token = signJwt({ sub: 7, username: 'bob', role: 'admin' }, TEST_SECRET);
    const req = makeReq(token);
    const reply = makeReply();
    await authMiddleware(req, reply);
    // No error reply is sent; the request proceeds with the authenticated user.
    expect(reply.sent).toBe(false);
    expect(req.user).toBeDefined();
    expect(req.user!.sub).toBe(7);
    expect(req.user!.role).toBe('admin');
  });

  it('rejects a missing token with 401', async () => {
    const req = makeReq(null);
    const reply = makeReply();
    await authMiddleware(req, reply);
    expect(reply.sent).toBe(true);
    expect(reply.statusCode).toBe(401);
  });
});
