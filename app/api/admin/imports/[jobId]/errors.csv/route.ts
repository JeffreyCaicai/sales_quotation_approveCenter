import { NextResponse } from "next/server";

import { AuthError, requireSession } from "@/lib/auth/session";
import { AdminReadError, getImportJobDetail } from "@/lib/imports/admin-read-model";
import {
  renderImportErrorsCsv,
  type ImportErrorReportLocale,
} from "@/lib/imports/render-error-report";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  try {
    const actor = await requireSession();
    const searchParams = new URL(request.url).searchParams;
    const locale = searchParams.get("locale") ?? "en";
    if (
      [...searchParams.keys()].some((key) => key !== "locale")
      || searchParams.getAll("locale").length > 1
      || !isReportLocale(locale)
    ) {
      return NextResponse.json({ error: "IMPORT_LOCALE_INVALID" }, { status: 400 });
    }
    const { jobId } = await context.params;
    const detail = await getImportJobDetail(actor, jobId);
    const safeJobId = jobId.replaceAll(/[^A-Za-z0-9._-]/g, "_");
    return new NextResponse(renderImportErrorsCsv(detail.errors, locale), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="import-${safeJobId}-errors.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof AdminReadError || (error instanceof AuthError && error.status < 500)) {
      return NextResponse.json({ error: error.key }, { status: error.status });
    }
    return NextResponse.json({ error: "IMPORT_ADMIN_READ_FAILED" }, { status: 500 });
  }
}

function isReportLocale(value: string): value is ImportErrorReportLocale {
  return value === "en" || value === "zh-CN";
}
