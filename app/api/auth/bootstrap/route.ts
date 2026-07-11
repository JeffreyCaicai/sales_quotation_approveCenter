import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { users } from "@/db/schema";
import { authenticatePassword, normalizeEmail } from "@/lib/auth/password";
import {
  AuthError,
  SESSION_COOKIE_NAME,
  assertAuthConfigured,
  sessionCookieOptions,
  signSessionToken,
} from "@/lib/auth/session";

export const runtime = "nodejs";

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

function loginFailure(): NextResponse {
  return NextResponse.json({ error: "LOGIN_FAILED" }, { status: 401 });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertAuthConfigured();
  } catch {
    return NextResponse.json(
      { error: "AUTH_CONFIGURATION_ERROR" },
      { status: 500 },
    );
  }

  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return loginFailure();
  }
  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return loginFailure();
  }

  try {
    const email = normalizeEmail(body.email);
    const [user] = await getDb()
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        status: users.status,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const authenticated = await authenticatePassword(user ?? null, body.password);
    const token = await signSessionToken(authenticated.id);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(
      SESSION_COOKIE_NAME,
      token,
      sessionCookieOptions(),
    );
    return response;
  } catch (error) {
    if (error instanceof AuthError && error.status === 500) {
      return NextResponse.json({ error: error.key }, { status: error.status });
    }
    return loginFailure();
  }
}
