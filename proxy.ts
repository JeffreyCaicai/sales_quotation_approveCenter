import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

export function proxy(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.replace(/\/+$/, "") === "/admin/imports") {
    return NextResponse.next();
  }
  if (!request.cookies.has(SESSION_COOKIE_NAME)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", "/admin");
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
