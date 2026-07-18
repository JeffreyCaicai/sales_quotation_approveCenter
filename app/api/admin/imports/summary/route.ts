import { NextResponse } from "next/server";

import { AuthError, requireSession } from "@/lib/auth/session";
import {
  AdminReadError,
  getImportAdminSummary,
} from "@/lib/imports/admin-read-model";

export const runtime = "nodejs";

export async function GET(_request: Request): Promise<NextResponse> {
  try {
    const actor = await requireSession();
    void _request;
    return NextResponse.json(await getImportAdminSummary(actor));
  } catch (error) {
    if (error instanceof AdminReadError || (error instanceof AuthError && error.status < 500)) {
      return NextResponse.json({ error: error.key }, { status: error.status });
    }
    return NextResponse.json({ error: "IMPORT_ADMIN_READ_FAILED" }, { status: 500 });
  }
}
