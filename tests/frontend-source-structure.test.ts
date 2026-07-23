import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const wizardSource = readFileSync(join(process.cwd(), "components/quote-wizard.tsx"), "utf8");
const appSource = readFileSync(join(process.cwd(), "components/quotation-app.tsx"), "utf8");
const adminSources = [
  "components/admin/import-admin-app.tsx",
  "components/admin/admin-login.tsx",
  "components/admin/import-admin-dashboard.tsx",
  "components/admin/import-workspace.tsx",
  "components/admin/import-job-detail.tsx",
  "components/admin/import-history.tsx",
  "components/admin/admin-locale-provider.tsx",
  "app/admin/imports/page.tsx",
  "lib/admin-i18n.ts",
  "lib/client/import-admin-api.ts",
].map((file) => readFileSync(join(process.cwd(), file), "utf8")).join("\n");

describe("quotation wizard source structure", () => {
  it("models placement and optional bonus as independent commercial selections", () => {
    expect(wizardSource).toContain("interface CommercialSelectionValues");
    expect(wizardSource).toMatch(/placement:\s*CommercialSelectionValues/);
    expect(wizardSource).toMatch(/bonusEnabled:\s*boolean/);
    expect(wizardSource).toMatch(/bonus:\s*CommercialSelectionValues/);
    expect(wizardSource).toContain("function CommercialResourceSelector");
    expect(wizardSource.match(/<CommercialResourceSelector/g)).toHaveLength(2);
  });

  it("uses a strict six-step flow with placement and bonus before parameters", () => {
    expect(wizardSource).toMatch(
      /const STEPS:[\s\S]*commercial\.placement[\s\S]*commercial\.bonus[\s\S]*wizard\.stepParameters[\s\S]*wizard\.stepDiscount[\s\S]*wizard\.stepReview/,
    );
    expect(wizardSource).toContain('t("commercial.noBonus")');
    expect(wizardSource).toContain('t("commercial.addBonus")');
  });

  it("derives nested pricing and routes on customer discount", () => {
    expect(wizardSource).toContain("tvcDurationSeconds");
    expect(wizardSource).toContain("pricing.placementGross");
    expect(wizardSource).toContain("pricing.bonusGross");
    expect(wizardSource).toContain("pricing.totalGross");
    expect(wizardSource).toContain("pricing.totalNet");
    expect(wizardSource).toContain("pricing.totalIncludingTax");
    expect(wizardSource).toContain("approvalPath(values.discount)");
    expect(wizardSource).toContain("pricing.effectiveDiscountRate");
    expect(wizardSource).not.toContain("pricing.total)");
    expect(wizardSource).not.toContain('id="bonus"');
  });
});

describe("quotation workspace navigation", () => {
  it("resets the viewport after leaving the role picker", () => {
    expect(appSource).toContain("function resetViewport()");
    expect(appSource).toMatch(/onLogin=\{\(nextUser\) => \{[\s\S]*resetViewport\(\)/);
  });
});

describe("import administration source isolation", () => {
  it("does not depend on quotation demo users, role switching, or quotation components", () => {
    expect(adminSources).not.toMatch(/@\/lib\/mock-data|@\/components\/(?:quotation|quote-)|role-switcher|USERS/);
  });

  it("does not render the visual reference as application UI", () => {
    expect(adminSources).not.toContain("import-admin-reference.png");
  });
});
