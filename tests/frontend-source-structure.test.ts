import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const wizardSource = readFileSync(join(process.cwd(), "components/quote-wizard.tsx"), "utf8");
const appSource = readFileSync(join(process.cwd(), "components/quotation-app.tsx"), "utf8");

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

  it("derives nested pricing and routes on effective discount", () => {
    expect(wizardSource).toContain("tvcDurationSeconds");
    expect(wizardSource).toContain("pricing.placementGross");
    expect(wizardSource).toContain("pricing.bonusGross");
    expect(wizardSource).toContain("pricing.totalGross");
    expect(wizardSource).toContain("pricing.totalNet");
    expect(wizardSource).toContain("pricing.totalIncludingTax");
    expect(wizardSource).toContain("approvalPath(pricing.effectiveDiscountRate)");
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
