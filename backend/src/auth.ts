import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { PublicUser, UserAccount } from './domain';

interface SessionPayload {
  exp: number;
  sub: string;
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const TOKEN_VERSION = 'v1';
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SALT_BYTES = 16;

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(PASSWORD_SALT_BYTES).toString('base64url');
  const hash = scryptSync(password, salt, PASSWORD_KEY_LENGTH).toString('base64url');
  return { hash, salt };
}

export function verifyPassword(password: string, account: UserAccount): boolean {
  const expected = Buffer.from(account.passwordHash, 'base64url');
  const actual = scryptSync(password, account.passwordSalt, PASSWORD_KEY_LENGTH);

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}

export function publicUser(account: UserAccount): PublicUser {
  return {
    createdAt: account.createdAt,
    displayName: account.displayName,
    email: account.email,
    id: account.id,
    updatedAt: account.updatedAt,
  };
}

export function createSessionToken(userId: string, secret: string): string {
  const payload: SessionPayload = {
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    sub: userId,
  };
  const body = `${TOKEN_VERSION}.${base64Url(JSON.stringify(payload))}`;
  return `${body}.${sign(body, secret)}`;
}

export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  const [version, encodedPayload, signature] = token.split('.');

  if (version !== TOKEN_VERSION || !encodedPayload || !signature) {
    return null;
  }

  const body = `${version}.${encodedPayload}`;
  const expectedSignature = sign(body, secret);
  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as SessionPayload;

    if (!payload.sub || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
