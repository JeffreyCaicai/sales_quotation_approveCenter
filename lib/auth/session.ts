import { and, eq } from "drizzle-orm";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";

import { getDb } from "@/db";
import { userPermissions, users } from "@/db/schema";
import {
  hasPermission,
  permissions,
  type Permission,
} from "@/lib/auth/permissions";

export const SESSION_COOKIE_NAME = "quotation_session";
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
export const SESSION_ISSUER = "quotation-app";
export const SESSION_AUDIENCE = "quotation-admin";

const MINIMUM_SECRET_LENGTH = 32;
const SESSION_CLOCK_SKEW_SECONDS = 60;

export type AuthErrorKey =
  | "AUTH_REQUIRED"
  | "LOGIN_FAILED"
  | "PERMISSION_DENIED"
  | "AUTH_CONFIGURATION_ERROR";

export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 403 | 500,
    public readonly key: AuthErrorKey,
  ) {
    super(key);
    this.name = "AuthError";
  }
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  status: "active";
  permissions: Permission[];
}

interface LoadedUser {
  id: string;
  email: string;
  displayName: string;
  status: "active" | "inactive";
  permissions: readonly string[];
}

interface SessionOptions {
  secret?: string;
  now?: Date;
}

function secretKey(secret = process.env.AUTH_SECRET): Uint8Array {
  if (!secret || secret.length < MINIMUM_SECRET_LENGTH) {
    throw new AuthError(500, "AUTH_CONFIGURATION_ERROR");
  }
  return new TextEncoder().encode(secret);
}

export function assertAuthConfigured(secret = process.env.AUTH_SECRET): void {
  secretKey(secret);
}

function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export async function signSessionToken(
  userId: string,
  options: SessionOptions = {},
): Promise<string> {
  const now = epochSeconds(options.now ?? new Date());
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_MAX_AGE_SECONDS)
    .sign(secretKey(options.secret));
}

export async function verifySessionToken(
  token: string,
  options: SessionOptions = {},
): Promise<JWTPayload> {
  const key = secretKey(options.secret);
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
      currentDate: options.now,
      requiredClaims: ["sub", "iat", "exp"],
    });
    const now = epochSeconds(options.now ?? new Date());
    if (
      payload.iat! > now + SESSION_CLOCK_SKEW_SECONDS ||
      payload.exp! <= payload.iat! ||
      payload.exp! - payload.iat! > SESSION_MAX_AGE_SECONDS
    ) {
      throw new AuthError(401, "AUTH_REQUIRED");
    }
    return payload;
  } catch {
    throw new AuthError(401, "AUTH_REQUIRED");
  }
}

export function sessionCookieOptions(
  environment = process.env.NODE_ENV,
): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: environment === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

type UserLoader = (userId: string) => Promise<LoadedUser | null>;

export async function authorizeSessionToken(
  token: string,
  requiredPermission: Permission,
  loadUser: UserLoader,
  options: SessionOptions = {},
): Promise<SessionUser> {
  const claims = await verifySessionToken(token, options);
  const loaded = await loadUser(claims.sub!);
  if (!loaded || loaded.status !== "active") {
    throw new AuthError(401, "AUTH_REQUIRED");
  }
  if (!hasPermission(loaded.permissions, requiredPermission)) {
    throw new AuthError(403, "PERMISSION_DENIED");
  }
  return {
    id: loaded.id,
    email: loaded.email,
    displayName: loaded.displayName,
    status: "active",
    permissions: permissions.filter((permission) =>
      loaded.permissions.includes(permission),
    ),
  };
}

async function loadDatabaseUser(userId: string): Promise<LoadedUser | null> {
  const rows = await getDb()
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
      permissionKey: userPermissions.permissionKey,
    })
    .from(users)
    .leftJoin(
      userPermissions,
      eq(userPermissions.userId, users.id),
    )
    .where(and(eq(users.id, userId), eq(users.status, "active")));

  const first = rows[0];
  if (!first) return null;
  return {
    id: first.id,
    email: first.email,
    displayName: first.displayName,
    status: first.status,
    permissions: rows.flatMap(({ permissionKey }) =>
      permissionKey === null ? [] : [permissionKey],
    ),
  };
}

export async function requirePermission(
  permission: Permission,
): Promise<SessionUser> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) throw new AuthError(401, "AUTH_REQUIRED");
  return authorizeSessionToken(token, permission, loadDatabaseUser);
}

export async function requireSession(): Promise<SessionUser> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) throw new AuthError(401, "AUTH_REQUIRED");
  const claims = await verifySessionToken(token);
  const loaded = await loadDatabaseUser(claims.sub!);
  if (!loaded || loaded.status !== "active") throw new AuthError(401, "AUTH_REQUIRED");
  return {
    id: loaded.id,
    email: loaded.email,
    displayName: loaded.displayName,
    status: "active",
    permissions: permissions.filter((permission) => loaded.permissions.includes(permission)),
  };
}
