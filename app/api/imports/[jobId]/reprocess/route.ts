import { NextResponse } from "next/server";

import { AuthError, requireSession } from "@/lib/auth/session";
import { AdminReadError, getImportJobDetail } from "@/lib/imports/admin-read-model";
import { ImportProcessingError, reprocessImport } from "@/lib/imports/process-import";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  try {
    const actor = await requireSession();
    const { jobId } = await context.params;
    await getImportJobDetail(actor, jobId);
    await reprocessImport(jobId, actor);
    return NextResponse.json(await getImportJobDetail(actor, jobId));
  } catch (error) {
    if (error instanceof AuthError || error instanceof ImportProcessingError || error instanceof AdminReadError) {
      return NextResponse.json({ error: error.key }, { status: error.status });
    }
    return NextResponse.json({ error: "IMPORT_REPROCESS_FAILED" }, { status: 500 });
  }
}
