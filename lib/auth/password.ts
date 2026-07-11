import { compare, hash } from "bcryptjs";

import { AuthError } from "@/lib/auth/session";

export const BCRYPT_COST = 12;
export const MINIMUM_BOOTSTRAP_PASSWORD_LENGTH = 14;

const DUMMY_PASSWORD_HASH =
  "$2b$12$xK7hEnO7dAbg4eYl2CTK4O8Z7cH4LckYQvKfKQeZZmU1P1DHVY.Xe";

export class BootstrapCredentialError extends Error {
  constructor(
    public readonly key: "BOOTSTRAP_PASSWORD_TOO_SHORT" | "BOOTSTRAP_EMAIL_REQUIRED",
  ) {
    super(key);
    this.name = "BootstrapCredentialError";
  }
}

export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new BootstrapCredentialError("BOOTSTRAP_EMAIL_REQUIRED");
  return normalized;
}

export function assertBootstrapPassword(password: string): void {
  if (password.length < MINIMUM_BOOTSTRAP_PASSWORD_LENGTH) {
    throw new BootstrapCredentialError("BOOTSTRAP_PASSWORD_TOO_SHORT");
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertBootstrapPassword(password);
  return hash(password, BCRYPT_COST);
}

interface PasswordUser {
  passwordHash: string;
  status: "active" | "inactive";
}

export async function authenticatePassword<T extends PasswordUser>(
  user: T | null,
  password: string,
): Promise<T> {
  const matches = await compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || user.status !== "active" || !matches) {
    throw new AuthError(401, "LOGIN_FAILED");
  }
  return user;
}
