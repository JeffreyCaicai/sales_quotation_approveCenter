import { describe, expect, test } from "vitest";
import { NextRequest } from "next/server";

import {
  hasPermission,
  permissions,
  type Permission,
} from "@/lib/auth/permissions";
import {
  AuthError,
  authorizeSessionToken,
  sessionCookieOptions,
  signSessionToken,
  verifySessionToken,
} from "@/lib/auth/session";
import {
  assertBootstrapPassword,
  authenticatePassword,
  hashPassword,
  normalizeEmail,
} from "@/lib/auth/password";
import { proxy } from "@/proxy";

const strongSecret = "test-only-auth-secret-that-is-at-least-32-bytes";
const userId = "12e7130a-8321-4d8f-a6ea-312950722854";

describe("permission keys", () => {
  test("contain exactly the eight approved values", () => {
    expect(permissions).toEqual([
      "data.import.customer_brand",
      "data.import.building",
      "data.import.package",
      "rate_card.upload",
      "rate_card.publish",
      "data.rollback",
      "data.audit.read",
      "data.file.download",
    ]);
  });

  test("are exact and deny by default", () => {
    expect(hasPermission(["data.import.building"], "data.import.building")).toBe(true);
    expect(hasPermission(["data.import"], "data.import.building")).toBe(false);
    expect(hasPermission([], "rate_card.publish")).toBe(false);
  });
});

describe("sessions", () => {
  test("bind the subject, issuer, audience, issued-at, and expiry", async () => {
    const token = await signSessionToken(userId, {
      secret: strongSecret,
      now: new Date("2026-07-10T00:00:00Z"),
    });
    const claims = await verifySessionToken(token, {
      secret: strongSecret,
      now: new Date("2026-07-10T01:00:00Z"),
    });

    expect(claims.sub).toBe(userId);
    expect(claims.iss).toBe("quotation-app");
    expect(claims.aud).toBe("quotation-admin");
    expect(claims.iat).toBeTypeOf("number");
    expect(claims.exp).toBe(claims.iat! + 12 * 60 * 60);
  });

  test("rejects expired and tampered tokens", async () => {
    const issuedAt = new Date("2026-07-10T00:00:00Z");
    const token = await signSessionToken(userId, { secret: strongSecret, now: issuedAt });

    await expect(
      verifySessionToken(token, {
        secret: strongSecret,
        now: new Date("2026-07-10T12:00:01Z"),
      }),
    ).rejects.toMatchObject({ status: 401, key: "AUTH_REQUIRED" });
    await expect(
      verifySessionToken(`${token.slice(0, -1)}x`, { secret: strongSecret }),
    ).rejects.toMatchObject({ status: 401, key: "AUTH_REQUIRED" });
  });

  test.each([undefined, "short-secret"])(
    "fails closed when AUTH_SECRET is missing or weak",
    async (secret) => {
      await expect(signSessionToken(userId, { secret })).rejects.toMatchObject({
        status: 500,
        key: "AUTH_CONFIGURATION_ERROR",
      });
    },
  );

  test("uses hardened 12-hour cookie settings", () => {
    expect(sessionCookieOptions("production")).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 12 * 60 * 60,
    });
    expect(sessionCookieOptions("development").secure).toBe(false);
  });
});

describe("server-side authorization", () => {
  const permission: Permission = "rate_card.publish";

  async function token() {
    return signSessionToken(userId, { secret: strongSecret });
  }

  test.each([
    ["missing user", null],
    ["inactive user", { id: userId, email: "admin@example.com", displayName: "Admin", status: "inactive" as const, permissions: [permission] }],
  ])("rejects an authenticated %s", async (_label, loadedUser) => {
    await expect(
      authorizeSessionToken(await token(), permission, async () => loadedUser, {
        secret: strongSecret,
      }),
    ).rejects.toMatchObject({ status: 401, key: "AUTH_REQUIRED" });
  });

  test("rejects a missing permission with a stable forbidden error", async () => {
    await expect(
      authorizeSessionToken(
        await token(),
        permission,
        async () => ({
          id: userId,
          email: "admin@example.com",
          displayName: "Admin",
          status: "active",
          permissions: ["data.audit.read"],
        }),
        { secret: strongSecret },
      ),
    ).rejects.toMatchObject({ status: 403, key: "PERMISSION_DENIED" });
  });

  test("returns the database-backed active user", async () => {
    const loaded = {
      id: userId,
      email: "admin@example.com",
      displayName: "Admin",
      status: "active" as const,
      permissions: [permission],
    };
    await expect(
      authorizeSessionToken(await token(), permission, async () => loaded, {
        secret: strongSecret,
      }),
    ).resolves.toEqual(loaded);
  });
});

describe("bootstrap credentials", () => {
  test("normalizes email and refuses passwords shorter than 14 characters", () => {
    expect(normalizeEmail("  ADMIN@Example.COM ")).toBe("admin@example.com");
    expect(() => assertBootstrapPassword("1234567890123")).toThrowError(
      expect.objectContaining({ key: "BOOTSTRAP_PASSWORD_TOO_SHORT" }),
    );
    expect(() => assertBootstrapPassword("fourteen-chars!")).not.toThrow();
  });

  test("uses one login failure contract for unknown, inactive, and wrong-password users", async () => {
    const passwordHash = await hashPassword("valid-password-14+");
    const candidates = [
      [null, "valid-password-14+"],
      [{ status: "inactive" as const, passwordHash }, "valid-password-14+"],
      [{ status: "active" as const, passwordHash }, "wrong-password"],
    ] as const;

    for (const [user, password] of candidates) {
      const error = await authenticatePassword(user, password).catch((caught) => caught);
      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({ status: 401, key: "LOGIN_FAILED" });
    }
  });
});

describe("admin proxy", () => {
  test("redirects a missing session cookie to the login UX", () => {
    const response = proxy(new NextRequest("https://quotation.test/admin/rate-cards"));
    expect(response.headers.get("location")).toBe(
      "https://quotation.test/login?next=%2Fadmin",
    );
  });

  test("allows a request that carries a session cookie through", () => {
    const request = new NextRequest("https://quotation.test/admin", {
      headers: { cookie: "quotation_session=opaque-token" },
    });
    const response = proxy(request);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
