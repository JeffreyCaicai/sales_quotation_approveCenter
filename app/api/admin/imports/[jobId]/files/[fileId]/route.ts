import { NextResponse } from "next/server";

import { AuthError, requireSession } from "@/lib/auth/session";
import { AdminReadError, getImportFileDownload } from "@/lib/imports/admin-read-model";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string; fileId: string }> },
): Promise<NextResponse> {
  try {
    const actor = await requireSession();
    const { jobId, fileId } = await context.params;
    const signedUrl = await getImportFileDownload(actor, jobId, fileId);
    const response = NextResponse.redirect(signedUrl, 303);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof AdminReadError || (error instanceof AuthError && error.status < 500)) {
      return NextResponse.json({ error: error.key }, { status: error.status });
    }
    return NextResponse.json({ error: "IMPORT_ADMIN_READ_FAILED" }, { status: 500 });
  }
}
