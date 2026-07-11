import { NextResponse } from "next/server";

import type { ImportDataType } from "@/db/enums";
import { AuthError, requirePermission } from "@/lib/auth/session";
import { ImportError, permissionForDataType } from "@/lib/imports/contracts";
import { createImportJob } from "@/lib/imports/create-job";
import { parseImportMultipart } from "@/lib/imports/multipart";

export const runtime = "nodejs";

function errorResponse(error: unknown): NextResponse {
  if (error instanceof ImportError || error instanceof AuthError) {
    return NextResponse.json({ error: error.key }, { status: error.status });
  }
  if (error instanceof Error) {
    if (error.message === "PERMISSION_DENIED") return NextResponse.json({ error: error.message }, { status: 403 });
    if (error.message === "IMPORT_JOB_NOT_FOUND") return NextResponse.json({ error: error.message }, { status: 404 });
    if (error.message === "IMPORT_JOB_NOT_PROCESSABLE") return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return NextResponse.json({ error: "IMPORT_CREATE_FAILED" }, { status: 500 });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const rawDataType = new URL(request.url).searchParams.get("dataType");
    const permission = permissionForDataType(rawDataType);
    const actor = await requirePermission(permission);
    const { templateVersion, files } = await parseImportMultipart(request);
    const result = await createImportJob(
      {
        dataType: rawDataType as ImportDataType,
        templateVersion,
        files,
      },
      actor,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
