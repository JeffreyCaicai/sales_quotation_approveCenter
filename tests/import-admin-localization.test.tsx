import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  ADMIN_LOCALE_STORAGE_KEY,
  readPersistedAdminLocale,
  translateAdmin,
  writePersistedAdminLocale,
} from "@/lib/admin-i18n";
import { ImportAdminDashboard } from "@/components/admin/import-admin-dashboard";

const summary = {
  currentRateCard: null,
  buildings: { active: 0, inactive: 0 },
  packages: { active: 0, inactive: 0 },
  jobs: { validating: 0, ready: 0, failed: 0 },
  recentPublications: [],
};

function dashboard(locale: "en" | "zh-CN") {
  return renderToStaticMarkup(
    <ImportAdminDashboard
      locale={locale}
      summary={summary}
      history={[]}
      rateCardVersions={[]}
      selectedDataType="building"
      selectedJobId={null}
      view="imports"
      onSelectDataType={() => undefined}
      onSelectJob={() => undefined}
      onSelectView={() => undefined}
      onRefresh={() => undefined}
    />,
  );
}

describe("import administration localization", () => {
  test("uses complete English workflow copy by default", () => {
    expect(translateAdmin(undefined, "page.title")).toBe("Data import administration");
    expect(translateAdmin(undefined, "upload.acceptedTypes")).toContain(".xlsx or .csv");
    expect(translateAdmin(undefined, "job.current")).toBe("Current job");
    expect(translateAdmin(undefined, "rateCard.current")).toBe("Current");
    expect(translateAdmin(undefined, "rateCard.historical")).toBe("Historical");
    expect(translateAdmin(undefined, "publish.generatedCodes", { count: 2 })).toContain("2");

    const html = dashboard("en");
    expect(html).toContain("Buildings");
    expect(html).toContain("Sales Packages");
    expect(html).toContain("Rate Cards");
    expect(html).toContain("Customer / Brand / Sales PIC");
    expect(html).toContain("Waiting for final template.");
    expect(html).toContain("Download template");
    expect(html).toContain("Recent import history");
  });

  test("renders the complete Simplified Chinese workflow copy", () => {
    const html = dashboard("zh-CN");
    expect(html).toContain("数据导入管理");
    expect(html).toContain("楼宇");
    expect(html).toContain("销售套餐");
    expect(html).toContain("价目表");
    expect(html).toContain("客户 / 品牌 / Sales PIC");
    expect(html).toContain("等待最终模板。");
    expect(html).toContain("下载模板");
    expect(html).toContain("最近导入历史");
    expect(translateAdmin("zh-CN", "error.stalePreview")).toContain("重新处理");
    expect(translateAdmin("zh-CN", "publish.generatedCodes", { count: 1 })).toContain("1");
  });

  test("persists only a validated locale under the versioned admin key", () => {
    const values = new Map<string, string>([[ADMIN_LOCALE_STORAGE_KEY, "zh-CN"]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(readPersistedAdminLocale(storage)).toBe("zh-CN");
    writePersistedAdminLocale(storage, "en");
    expect(values.get(ADMIN_LOCALE_STORAGE_KEY)).toBe("en");
    values.set(ADMIN_LOCALE_STORAGE_KEY, "fr");
    expect(readPersistedAdminLocale(storage)).toBe("en");
    expect([...values.keys()]).toEqual([ADMIN_LOCALE_STORAGE_KEY]);
  });
});
