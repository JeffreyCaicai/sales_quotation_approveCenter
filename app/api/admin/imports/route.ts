import { NextResponse } from "next/server";

import { AuthError, requireSession } from "@/lib/auth/session";
import { parseImportJobFilters } from "@/lib/imports/admin-contracts";
import { AdminReadError, listImportJobs } from "@/lib/imports/admin-read-model";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const actor = await requireSession();
    const filters = parseImportJobFilters(new URL(request.url).searchParams);
    if (filters === null) {
      return NextResponse.json({ error: "IMPORT_FILTER_INVALID" }, { status: 400 });
    }
    return NextResponse.json(await listImportJobs(actor, filters));
  } catch (error) {
    if (error instanceof AdminReadError || (error instanceof AuthError && error.status < 500)) {
      return NextResponse.json({ error: error.key }, { status: error.status });
    }
    return NextResponse.json({ error: "IMPORT_ADMIN_READ_FAILED" }, { status: 500 });
  }
}
