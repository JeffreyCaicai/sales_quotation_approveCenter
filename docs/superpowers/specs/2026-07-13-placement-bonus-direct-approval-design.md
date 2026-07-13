# Placement, Bonus, and Direct Approval Design

## Purpose

The quotation prototype currently treats Bonus as a numeric scheduling field attached to Placement. The confirmed quotation template and business workflow establish that Bonus is instead a separate commercial selection with its own buildings or sales package, its own campaign parameters, and a Rate Card value. Bonus is free to the customer, but its gross value must be included when the system calculates the effective discount used for approval routing.

This change updates the interactive demo and the formal application source while preserving the existing customer-to-Sales PIC restriction, quotation version history, return-and-resubmit workflow, English localization, IDR currency, and simulated 6% tax used by the prototype.

## Confirmed Business Rules

### Customer access

A Sales user may only view and quote customers and brands assigned to that Sales PIC. This rule remains enforced by both the wizard filter and domain reference validation.

### Placement

Placement is required. Sales chooses exactly one selection mode:

- one or more individual buildings; or
- one predefined sales package.

Placement stores its own TVC duration, campaign duration in weeks, Spot quantity, Rate Card gross value, traffic, and impressions.

### Bonus

Bonus is optional. Sales first chooses either `No Bonus` or `Add Bonus`.

When Bonus is enabled, Sales chooses exactly one selection mode independently from Placement:

- one or more individual buildings; or
- one predefined sales package.

Bonus stores its own TVC duration, campaign duration in weeks, Spot quantity, Rate Card gross value, traffic, and impressions. Bonus nett is always zero in this workflow. The old standalone numeric Bonus field is removed.

### Pricing and effective discount

The Sales-entered discount applies to Placement gross only.

```text
Placement Nett = Placement Gross × (1 − Placement Discount)
Bonus Nett = 0
Total Gross = Placement Gross + Bonus Gross
Total Nett = Placement Nett + Bonus Nett
Effective Discount = (Total Gross − Total Nett) ÷ Total Gross × 100
Tax = Total Nett × simulated tax rate
Total Including Tax = Total Nett + Tax
```

All persisted monetary values are integer IDR. Effective discount is retained with sufficient precision for correct boundary routing and displayed to two decimal places where appropriate.

### Direct approval routing

Approval is single-step and non-cascading. The effective discount determines exactly one approver:

- `<= 65%`: Head of Sales
- `> 65% and <= 70%`: Head of Business Control
- `> 70%`: CEO

The application represents these approvers as roles and resolves the actual user from configuration or user data. Ayu, April, and Thomas may appear as demo users, but routing logic must never depend on their names.

An approver either approves or returns the quotation. Approval immediately locks the submitted version and makes the quotation available for formal document generation. A return sends the quotation back to Sales with a required reason. On resubmission, the application creates a new immutable snapshot, recalculates the effective discount, and routes directly to the approver for the new band.

## Wizard Design

The wizard remains six steps so the overall interaction stays familiar:

1. Select customer and brand.
2. Configure Placement mode and resources.
3. Choose No Bonus or configure Bonus mode and resources.
4. Enter separate Placement and Bonus campaign parameters.
5. Enter Placement discount and review calculated pricing and direct approver.
6. Review both commercial sections and submit.

The pricing sidebar remains visible and distinguishes:

- Placement Gross
- Placement Discount and Placement Nett
- Bonus Gross and Bonus Nett (`FREE`)
- Total Gross
- Effective Discount
- Tax
- Total Including Tax

## Domain Model

Placement and Bonus use the same reusable commercial selection shape:

```ts
interface CommercialSelectionInput {
  mode?: PlacementMode;
  resourceIds: string[];
  tvcDurationSeconds: number;
  weeks: number;
  spots: number;
  grossPrice: number;
  traffic: number;
  impressions: number;
}
```

`QuoteInput.placement` is always present. `QuoteInput.bonus` is absent for No Bonus and otherwise contains a complete independent selection. Submitted `Quote`, `QuoteVersionSnapshot`, and persistence records preserve both selections and the full calculated pricing snapshot.

The pricing summary exposes explicit fields rather than overloading the old `basePrice` fields:

```ts
interface PricingSummary {
  placementGross: number;
  placementDiscountAmount: number;
  placementNet: number;
  bonusGross: number;
  bonusNet: 0;
  totalGross: number;
  totalNet: number;
  effectiveDiscountAmount: number;
  effectiveDiscountRate: number;
  tax: number;
  totalIncludingTax: number;
}
```

The demo persistence schema is versioned again so incompatible legacy browser records cannot silently enter the new workflow. Seeded demo quotations are regenerated in the new shape.

## Screens and localization

The following surfaces must consistently show Placement and Bonus:

- Sales dashboard and quotation rows
- approval queue and approval detail
- quotation progress and version history
- approved formal quotation preview
- English and Chinese localization
- role switcher and dashboards for Head of Sales, Head of Business Control, and CEO

Status labels add `Awaiting Head of Business Control`. No copy may describe the old manager-then-CEO sequence.

## Hosting and delivery

The formal source is implemented on `codex/placement-bonus-flow` from the current production repository. It is not pushed to GitHub or merged to `main`; the user will review the demo first.

The existing Sites URL uses the older Sites/Vinext runtime, while the current production repository uses Next.js standalone, PostgreSQL, MinIO, and VPS deployment. Therefore the demo update is produced on a separate branch from tag `sites-demo-v1` and receives only the compatible quotation domain, localStorage, UI, localization, and test changes. It reuses existing Sites project `appgprj_6a5134e2aaa88191a3bca54e4c374ff9`, preserves the current access policy, and updates:

`https://sales-quotation-approval.jeffrey202510.chatgpt.site`

No Sites project is created, and no PostgreSQL, MinIO, import API, CI/CD, or VPS operations are ported into the Sites demo.

## Verification

Automated verification must prove:

- No Bonus produces zero Bonus gross and the expected effective discount.
- A free Bonus selection increases Total Gross and can move approval from Head of Sales to Head of Business Control or CEO.
- 65%, 70%, and values above 70% route at exact confirmed boundaries.
- Each approver can only act on their own direct queue.
- Return and resubmit creates a new immutable version and recalculates the approver.
- Placement and Bonus resource mode, price, and campaign parameters are independently validated.
- Sales cannot quote an unassigned customer or brand.
- persisted records, seeded records, statuses, and histories use the new schema.
- English and Chinese rendered UI contain no stale numeric Bonus field or sequential approval copy.
- approved quotation preview contains separate Placement and Bonus rows and consistent totals.
- unit, logic, localization, integration, browser smoke, lint, build, and committed-secret checks pass.

The existing Sites deployment must additionally pass packaging validation and a public smoke check on the unchanged URL after publication.

## Scope boundaries

This change does not implement real authentication, enterprise SSO, database-backed quotation tables, final PDF generation, Rate Card import, tax-rule changes, or production deployment. Those remain later phases. The prototype keeps its existing simulated 6% tax until the tax and price calculation rules are formally confirmed.
