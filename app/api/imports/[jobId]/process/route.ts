import { NextResponse } from "next/server";

import { AuthError, requireSession } from "@/lib/auth/session";
import { ImportProcessingError, processImport } from "@/lib/imports/process-import";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  try {
    const actor = await requireSession();
    const { jobId } = await context.params;
    const result = await processImport(jobId, actor);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError || error instanceof ImportProcessingError) {
      return NextResponse.json({ error: error.key }, { status: error.status });
    }
    const key = error instanceof Error ? error.message : "IMPORT_PROCESS_FAILED";
    const status = key === "IMPORT_JOB_NOT_FOUND" ? 404 : key === "PERMISSION_DENIED" ? 403 : 409;
    return NextResponse.json({ error: key }, { status });
  }
}
