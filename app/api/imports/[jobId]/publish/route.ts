import { NextResponse } from "next/server";

import { AuthError, requireSession } from "@/lib/auth/session";
import { PublicationError, publishImport } from "@/lib/imports/publish";
import { RateCardPublicationError } from "@/lib/imports/publish-rate-card";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  try {
    const actor = await requireSession();
    const { jobId } = await context.params;
    return NextResponse.json(await publishImport(jobId, actor));
  } catch (error) {
    if (error instanceof AuthError || error instanceof PublicationError || error instanceof RateCardPublicationError) {
      if (error.key === "IMPORT_CHANGE_STALE") {
        return NextResponse.json(
          { error: error.key, reprocessRequired: true },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: error.key }, { status: error.status });
    }
    return NextResponse.json({ error: "IMPORT_PUBLISH_FAILED" }, { status: 500 });
  }
}
