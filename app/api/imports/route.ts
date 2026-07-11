import { NextResponse } from "next/server";

import type { ImportDataType } from "@/db/enums";
import { AuthError, requirePermission } from "@/lib/auth/session";
import { ImportError, permissionForDataType } from "@/lib/imports/contracts";
import { createImportJob } from "@/lib/imports/create-job";

export const runtime = "nodejs";

function errorResponse(error: unknown): NextResponse {
  if (error instanceof ImportError || error instanceof AuthError) {
    return NextResponse.json({ error: error.key }, { status: error.status });
  }
  return NextResponse.json({ error: "IMPORT_CREATE_FAILED" }, { status: 500 });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const form = await request.formData();
    const rawDataType = form.get("dataType");
    const permission = permissionForDataType(rawDataType);
    const actor = await requirePermission(permission);
    const templateVersion = form.get("templateVersion");
    const rawFiles = form.getAll("files");
    if (
      typeof templateVersion !== "string" ||
      templateVersion.trim().length === 0 ||
      rawFiles.some((file) => !(file instanceof File))
    ) {
      throw new ImportError(400, "IMPORT_FILES_INVALID");
    }
    const result = await createImportJob(
      {
        dataType: rawDataType as ImportDataType,
        templateVersion,
        files: rawFiles as File[],
      },
      actor,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
