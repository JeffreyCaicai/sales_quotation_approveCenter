import { NextResponse } from "next/server";

import { AuthError, requirePermission } from "@/lib/auth/session";
import {
  importPermissionByDataType,
  type ActiveImportDataType,
} from "@/lib/imports/contracts";
import { generateImportTemplate } from "@/lib/imports/generate-template";
import { TEMPLATE_VERSION_V2 } from "@/lib/imports/template-v2";

export const runtime = "nodejs";

const filenames = {
  building: "02_Buildings_Template.xlsx",
  package: "03_Sales_Packages_Template.xlsx",
  rate_card: "04_Rate_Card_Template.xlsx",
} as const;

type RouteContext = { params: Promise<{ dataType: string }> };

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { dataType } = await context.params;
    if (!Object.hasOwn(importPermissionByDataType, dataType)) {
      return NextResponse.json({ error: "TEMPLATE_NOT_FOUND" }, { status: 404 });
    }
    const activeDataType = dataType as ActiveImportDataType;
    await requirePermission(importPermissionByDataType[activeDataType]);
    const buffer = await generateImportTemplate(activeDataType, TEMPLATE_VERSION_V2);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filenames[activeDataType]}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.key }, { status: error.status });
    }
    return NextResponse.json({ error: "TEMPLATE_DOWNLOAD_FAILED" }, { status: 500 });
  }
}
