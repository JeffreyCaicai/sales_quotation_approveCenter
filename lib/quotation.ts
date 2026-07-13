import type {
  ApprovalDirectory,
  ApproverRole,
  Building,
  CommercialSelection,
  CommercialSelectionInput,
  Customer,
  DiscountBand,
  PricingSummary,
  Quote,
  QuoteInput,
  QuoteStatus,
  QuoteVersionSnapshot,
  Role,
  SalesPackage,
  SubmittedQuote,
  User,
} from "./types.ts";
import { USERS } from "./mock-data.ts";

export interface QuoteReferenceData {
  customers: readonly Customer[];
  buildings: readonly Building[];
  packages: readonly SalesPackage[];
}

const VALIDATION = {
  customerRequired: "validation.customerRequired",
  brandRequired: "validation.brandRequired",
  placementModeRequired: "validation.placementModeRequired",
  placementRequired: "validation.placementRequired",
  tvcDurationPositiveInteger: "validation.tvcDurationPositiveInteger",
  weeksPositiveInteger: "validation.weeksPositiveInteger",
  spotsPositiveInteger: "validation.spotsPositiveInteger",
  discountRange: "validation.discountRange",
  grossPriceFiniteNonnegative: "validation.grossPriceFiniteNonnegative",
  pricingUnsafeInteger: "validation.pricingUnsafeInteger",
  effectiveDiscountRateRange: "validation.effectiveDiscountRateRange",
  taxRateFiniteNonnegative: "validation.taxRateFiniteNonnegative",
  trafficNonnegativeInteger: "validation.trafficNonnegativeInteger",
  impressionsNonnegativeInteger: "validation.impressionsNonnegativeInteger",
  customerOwned: "validation.customerOwned",
  brandBelongsToCustomer: "validation.brandBelongsToCustomer",
  resourceModeMismatch: "validation.resourceModeMismatch",
  basePriceMismatch: "validation.basePriceMismatch",
  trafficMismatch: "validation.trafficMismatch",
  impressionsMismatch: "validation.impressionsMismatch",
  returnReasonRequired: "validation.returnReasonRequired",
} as const;

const DOMAIN_ERROR = {
  salesRoleRequired: "quotation.submit.salesRoleRequired",
  approvalRoleRequired: "quotation.approval.roleRequired",
  approvalStageRequired: "quotation.approval.stageRequired",
} as const;

const APPROVER_STATUS_BY_ROLE = {
  manager: "pending_manager",
  business_control: "pending_business_control",
  ceo: "pending_ceo",
} as const satisfies Partial<Record<Role, QuoteStatus>>;

export const VALIDATION_KEYS = Object.values(VALIDATION);
export type ValidationKey = (typeof VALIDATION)[keyof typeof VALIDATION];

export function getDiscountBand(discount: number): DiscountBand {
  if (discount <= 65) return "standard";
  if (discount <= 70) return "elevated";
  return "executive";
}

export function getApprovalStatus(effectiveDiscountRate: number): QuoteStatus {
  if (!Number.isFinite(effectiveDiscountRate) || effectiveDiscountRate < 0 || effectiveDiscountRate > 100) {
    throw new RangeError(VALIDATION.effectiveDiscountRateRange);
  }
  if (effectiveDiscountRate <= 65) return "pending_manager";
  if (effectiveDiscountRate <= 70) return "pending_business_control";
  return "pending_ceo";
}

export function getNextApproval(effectiveDiscountRate: number): QuoteStatus {
  return getApprovalStatus(effectiveDiscountRate);
}

export function calculatePricing(input: QuoteInput): PricingSummary {
  const placementGross = safeIdrOrZero(input.placement?.grossPrice);
  const placementDiscountAmount = Math.round(placementGross * (input.discount / 100));
  const placementNet = placementGross - placementDiscountAmount;
  const bonusGross = safeIdrOrZero(input.bonus?.grossPrice);
  const bonusNet = 0 as const;
  const totalGross = placementGross + bonusGross;
  const totalNet = placementNet;
  const effectiveDiscountAmount = totalGross - totalNet;
  const effectiveDiscountRate = totalGross === 0 ? 0 : (effectiveDiscountAmount / totalGross) * 100;
  const tax = Math.round(totalNet * (input.taxRate ?? 0.06));
  const totalIncludingTax = totalNet + tax;

  assertSafeIdrAmounts([
    placementGross,
    placementDiscountAmount,
    placementNet,
    bonusGross,
    bonusNet,
    totalGross,
    totalNet,
    effectiveDiscountAmount,
    tax,
    totalIncludingTax,
  ]);

  return {
    placementGross,
    placementDiscountAmount,
    placementNet,
    bonusGross,
    bonusNet,
    totalGross,
    totalNet,
    effectiveDiscountAmount,
    effectiveDiscountRate,
    tax,
    totalIncludingTax,
  };
}

export function validateQuote(input: QuoteInput): Record<string, ValidationKey> {
  const errors: Record<string, ValidationKey> = {};
  if (!input.customerId) errors.customerId = VALIDATION.customerRequired;
  if (!input.brandId) errors.brandId = VALIDATION.brandRequired;
  if (!input.placement) errors.placement = VALIDATION.placementRequired;
  else validateCommercialSelection(input.placement, "placement", errors);
  if (input.bonus) validateCommercialSelection(input.bonus, "bonus", errors);
  if (!Number.isFinite(input.discount) || input.discount < 0 || input.discount > 100) {
    errors.discount = VALIDATION.discountRange;
  }
  if (input.taxRate !== undefined && (!Number.isFinite(input.taxRate) || input.taxRate < 0)) {
    errors.taxRate = VALIDATION.taxRateFiniteNonnegative;
  }
  return errors;
}

function validateCommercialSelection(
  selection: CommercialSelectionInput,
  field: "placement" | "bonus",
  errors: Record<string, ValidationKey>,
): void {
  if (!selection.mode) errors[`${field}.mode`] = VALIDATION.placementModeRequired;
  if (!selection.resourceIds?.length) errors[`${field}.resourceIds`] = VALIDATION.placementRequired;
  if (!Number.isInteger(selection.tvcDurationSeconds) || (selection.tvcDurationSeconds ?? 0) <= 0) {
    errors[`${field}.tvcDurationSeconds`] = VALIDATION.tvcDurationPositiveInteger;
  }
  if (!Number.isInteger(selection.weeks) || (selection.weeks ?? 0) <= 0) {
    errors[`${field}.weeks`] = VALIDATION.weeksPositiveInteger;
  }
  if (!Number.isInteger(selection.spots) || (selection.spots ?? 0) <= 0) {
    errors[`${field}.spots`] = VALIDATION.spotsPositiveInteger;
  }
  if (!Number.isSafeInteger(selection.grossPrice) || (selection.grossPrice ?? -1) < 0) {
    errors[`${field}.grossPrice`] = VALIDATION.grossPriceFiniteNonnegative;
  }
  if (!Number.isInteger(selection.traffic) || (selection.traffic ?? -1) < 0) {
    errors[`${field}.traffic`] = VALIDATION.trafficNonnegativeInteger;
  }
  if (!Number.isInteger(selection.impressions) || (selection.impressions ?? -1) < 0) {
    errors[`${field}.impressions`] = VALIDATION.impressionsNonnegativeInteger;
  }
}

export function createDraftQuote(input: QuoteInput, previousQuote: Quote | undefined, actor: User): Quote {
  const now = new Date().toISOString();
  const identifier = now.replace(/\D/g, "");
  const normalizedInput: QuoteInput = {
    customerId: input.customerId ?? "",
    brandId: input.brandId ?? "",
    placement: normalizeDraftSelection(input.placement),
    bonus: normalizeDraftSelection(input.bonus),
    discount: normalizeDraftDiscount(input.discount),
    taxRate: normalizeDraftTaxRate(input.taxRate),
  };

  return {
    id: previousQuote?.id ?? `quote-draft-${identifier}`,
    quoteNumber: previousQuote?.quoteNumber ?? `DEMO-DRAFT-${identifier.slice(0, 8)}-${identifier.slice(8)}`,
    salesId: actor.id,
    customerId: normalizedInput.customerId ?? "",
    brandId: normalizedInput.brandId ?? "",
    placement: cloneSelectionInput(normalizedInput.placement),
    bonus: cloneSelectionInput(normalizedInput.bonus),
    discount: normalizedInput.discount,
    pricing: calculatePricing(normalizedInput),
    status: previousQuote?.status === "returned" ? "returned" : "draft",
    version: previousQuote?.version ?? 1,
    versionSnapshots: cloneVersionSnapshots(previousQuote?.versionSnapshots ?? []),
    approvalHistory: structuredClone(previousQuote?.approvalHistory ?? []),
    createdAt: previousQuote?.createdAt ?? now,
    updatedAt: now,
    isDemoData: true,
  };
}

export function validateQuoteReferences(
  input: QuoteInput,
  salesId: string,
  references: QuoteReferenceData,
): Record<string, ValidationKey> {
  const errors: Record<string, ValidationKey> = {};
  const customer = references.customers.find((item) => item.id === input.customerId);
  if (!customer || customer.salesId !== salesId) {
    errors.customerId = VALIDATION.customerOwned;
  } else if (!customer.brands.some((brand) => brand.id === input.brandId)) {
    errors.brandId = VALIDATION.brandBelongsToCustomer;
  }
  if (input.placement) validateSelectionReferences(input.placement, "placement", references, errors);
  if (input.bonus) validateSelectionReferences(input.bonus, "bonus", references, errors);
  return errors;
}

function validateSelectionReferences(
  selection: CommercialSelectionInput,
  field: "placement" | "bonus",
  references: QuoteReferenceData,
  errors: Record<string, ValidationKey>,
): void {
  const ids = selection.resourceIds ?? [];
  const resources = selection.mode === "building"
    ? references.buildings
    : selection.mode === "package"
      ? references.packages
      : undefined;
  const selected = resources ? ids.map((id) => resources.find((resource) => resource.id === id)) : [];
  const invalid = !resources
    || ids.length === 0
    || new Set(ids).size !== ids.length
    || selected.some((resource) => !resource)
    || (selection.mode === "package" && ids.length !== 1);
  if (invalid) {
    errors[`${field}.resourceIds`] = VALIDATION.resourceModeMismatch;
    return;
  }
  if (Number.isInteger(selection.weeks) && (selection.weeks ?? 0) > 0) {
    const expected = Math.round(
      selected.reduce((sum, resource) => sum + (resource?.priceIdr ?? 0), 0) * ((selection.weeks ?? 0) / 4),
    );
    if (selection.grossPrice !== expected) errors[`${field}.grossPrice`] = VALIDATION.basePriceMismatch;
  }
  const expectedTraffic = selected.reduce((sum, resource) => sum + (resource?.traffic ?? 0), 0);
  const expectedImpressions = selected.reduce((sum, resource) => sum + (resource?.impressions ?? 0), 0);
  if (selection.traffic !== expectedTraffic) errors[`${field}.traffic`] = VALIDATION.trafficMismatch;
  if (selection.impressions !== expectedImpressions) errors[`${field}.impressions`] = VALIDATION.impressionsMismatch;
}

export function submitQuote(
  input: QuoteInput,
  previousQuote: Quote | undefined,
  actor: User,
  references: QuoteReferenceData,
  approvalDirectory: ApprovalDirectory,
): SubmittedQuote {
  if (actor.role !== "sales") throw new Error(DOMAIN_ERROR.salesRoleRequired);
  const errors = {
    ...validateQuote(input),
    ...validateQuoteReferences(input, actor.id, references),
  };
  if (Object.keys(errors).length > 0) throw new Error(Object.values(errors).join(","));
  if (previousQuote && (previousQuote.salesId !== actor.id || (previousQuote.status !== "draft" && previousQuote.status !== "returned"))) {
    throw new Error(DOMAIN_ERROR.salesRoleRequired);
  }

  const now = new Date().toISOString();
  const isResubmission = previousQuote?.status === "returned";
  const version = isResubmission ? previousQuote.version + 1 : (previousQuote?.version ?? 1);
  const identifier = now.replace(/\D/g, "");
  const id = previousQuote?.id ?? `quote-demo-${identifier}`;
  const action = isResubmission ? "resubmitted" : "submitted";
  const placement = toCommercialSelection(input.placement);
  const bonus = input.bonus ? toCommercialSelection(input.bonus) : undefined;
  const pricing = calculatePricing(input);
  const status = getApprovalStatus(pricing.effectiveDiscountRate) as SubmittedQuote["status"];
  const approverRole = getApproverRole(status);
  const requiredApproverId = approvalDirectory[approverRole];
  const requiredApprover = USERS.find((user) => user.id === requiredApproverId && user.role === approverRole);
  if (!requiredApprover) throw new Error(DOMAIN_ERROR.approvalStageRequired);
  const snapshot = createVersionSnapshot(input, version, now, requiredApproverId);

  return {
    id,
    quoteNumber: previousQuote?.quoteNumber ?? `DEMO-Q-${identifier.slice(0, 8)}-${identifier.slice(8)}`,
    salesId: actor.id,
    customerId: input.customerId ?? "",
    brandId: input.brandId ?? "",
    placement: cloneCommercialSelection(placement)!,
    bonus: cloneCommercialSelection(bonus),
    discount: input.discount,
    pricing: { ...pricing },
    status,
    requiredApproverId,
    version,
    versionSnapshots: [
      ...(isResubmission ? cloneVersionSnapshots(previousQuote?.versionSnapshots ?? []) : []),
      snapshot,
    ],
    approvalHistory: [
      ...structuredClone(previousQuote?.approvalHistory ?? []),
      {
        id: `${id}-v${version}-${action}`,
        role: "sales",
        action,
        actorId: actor.id,
        actorName: actor.name,
        createdAt: now,
        version,
      },
    ],
    createdAt: previousQuote?.createdAt ?? now,
    updatedAt: now,
    isDemoData: true,
  };
}

function createVersionSnapshot(
  input: QuoteInput,
  version: number,
  submittedAt: string,
  requiredApproverId: string,
): QuoteVersionSnapshot {
  return {
    version,
    customerId: input.customerId ?? "",
    brandId: input.brandId ?? "",
    placement: toCommercialSelection(input.placement),
    bonus: input.bonus ? toCommercialSelection(input.bonus) : undefined,
    pricing: { ...calculatePricing(input) },
    discount: input.discount,
    requiredApproverId,
    submittedAt,
  };
}

function cloneVersionSnapshots(snapshots: QuoteVersionSnapshot[]): QuoteVersionSnapshot[] {
  return snapshots.map((snapshot) => ({
    ...snapshot,
    placement: cloneCommercialSelection(snapshot.placement)!,
    bonus: cloneCommercialSelection(snapshot.bonus),
    pricing: { ...snapshot.pricing },
  }));
}

export function approveQuote(quote: Quote, actor: User): Quote {
  assertApprovalTransition(quote, actor);
  const now = new Date().toISOString();
  const eventNumber = quote.approvalHistory.length + 1;
  return {
    ...quote,
    placement: cloneSelectionInput(quote.placement),
    bonus: cloneSelectionInput(quote.bonus),
    pricing: { ...quote.pricing },
    versionSnapshots: cloneVersionSnapshots(quote.versionSnapshots),
    approvalHistory: [
      ...structuredClone(quote.approvalHistory),
      {
        id: `${quote.id}-v${quote.version}-approved-${eventNumber}`,
        role: actor.role,
        action: "approved",
        actorId: actor.id,
        actorName: actor.name,
        createdAt: now,
        version: quote.version,
      },
    ],
    status: "approved",
    requiredApproverId: undefined,
    updatedAt: now,
    approvedAt: now,
  };
}

export function canApproveQuote(quote: Quote, actor: User): boolean {
  if (!isApproverRole(actor.role)) return false;
  if (!isSubmittedQuote(quote)) return false;
  const requiredStatus = APPROVER_STATUS_BY_ROLE[actor.role];
  if (quote.status !== requiredStatus) return false;
  if (actor.id !== quote.requiredApproverId) return false;
  try {
    return getApprovalStatus(quote.pricing.effectiveDiscountRate) === requiredStatus;
  } catch {
    return false;
  }
}

export function returnQuote(quote: Quote, actor: User, reason: string): Quote {
  assertApprovalTransition(quote, actor);
  const comment = reason.trim();
  if (!comment) throw new Error(VALIDATION.returnReasonRequired);
  const now = new Date().toISOString();
  const eventNumber = quote.approvalHistory.length + 1;
  return {
    ...quote,
    placement: cloneSelectionInput(quote.placement),
    bonus: cloneSelectionInput(quote.bonus),
    pricing: { ...quote.pricing },
    versionSnapshots: cloneVersionSnapshots(quote.versionSnapshots),
    approvalHistory: [
      ...structuredClone(quote.approvalHistory),
      {
        id: `${quote.id}-v${quote.version}-returned-${eventNumber}`,
        role: actor.role,
        action: "returned",
        actorId: actor.id,
        actorName: actor.name,
        createdAt: now,
        version: quote.version,
        comment,
      },
    ],
    status: "returned",
    requiredApproverId: undefined,
    updatedAt: now,
    approvedAt: undefined,
  };
}

function assertApprovalTransition(quote: Quote, actor: User): asserts actor is User & { role: ApproverRole } {
  if (!isApproverRole(actor.role)) throw new Error(DOMAIN_ERROR.approvalRoleRequired);
  if (!canApproveQuote(quote, actor)) throw new Error(DOMAIN_ERROR.approvalStageRequired);
}

function isApproverRole(role: Role): role is ApproverRole {
  return role in APPROVER_STATUS_BY_ROLE;
}

function getApproverRole(status: SubmittedQuote["status"]): ApproverRole {
  if (status === "pending_manager") return "manager";
  if (status === "pending_business_control") return "business_control";
  return "ceo";
}

export function isSubmittedQuote(quote: Quote): quote is SubmittedQuote {
  return (quote.status === "pending_manager" || quote.status === "pending_business_control" || quote.status === "pending_ceo")
    && typeof quote.requiredApproverId === "string"
    && quote.requiredApproverId.length > 0
    && isCompleteCommercialSelection(quote.placement)
    && (quote.bonus === undefined || isCompleteCommercialSelection(quote.bonus));
}

function isCompleteCommercialSelection(value: CommercialSelectionInput | undefined): value is CommercialSelection {
  return value !== undefined
    && (value.mode === "building" || value.mode === "package")
    && Array.isArray(value.resourceIds)
    && value.resourceIds.length > 0
    && Number.isInteger(value.tvcDurationSeconds) && (value.tvcDurationSeconds ?? 0) > 0
    && Number.isInteger(value.weeks) && (value.weeks ?? 0) > 0
    && Number.isInteger(value.spots) && (value.spots ?? 0) > 0
    && Number.isSafeInteger(value.grossPrice) && (value.grossPrice ?? -1) >= 0
    && Number.isInteger(value.traffic) && (value.traffic ?? -1) >= 0
    && Number.isInteger(value.impressions) && (value.impressions ?? -1) >= 0;
}

function toCommercialSelection(input: CommercialSelectionInput | undefined): CommercialSelection {
  if (!input?.mode || !input.resourceIds || input.tvcDurationSeconds === undefined || input.weeks === undefined
    || input.spots === undefined || input.grossPrice === undefined || input.traffic === undefined
    || input.impressions === undefined) {
    throw new Error(VALIDATION.placementRequired);
  }
  return {
    mode: input.mode,
    resourceIds: [...input.resourceIds],
    tvcDurationSeconds: input.tvcDurationSeconds,
    weeks: input.weeks,
    spots: input.spots,
    grossPrice: input.grossPrice,
    traffic: input.traffic,
    impressions: input.impressions,
  };
}

function cloneCommercialSelection(selection: CommercialSelection | undefined): CommercialSelection | undefined {
  return selection ? { ...selection, resourceIds: [...selection.resourceIds] } : undefined;
}

function cloneSelectionInput(selection: CommercialSelectionInput | undefined): CommercialSelectionInput | undefined {
  return selection ? { ...selection, resourceIds: [...(selection.resourceIds ?? [])] } : undefined;
}

function normalizeDraftSelection(selection: CommercialSelectionInput | undefined): CommercialSelectionInput | undefined {
  if (!selection) return undefined;
  return {
    mode: selection.mode,
    resourceIds: [...(selection.resourceIds ?? [])],
    tvcDurationSeconds: normalizeDraftInteger(selection.tvcDurationSeconds),
    weeks: normalizeDraftInteger(selection.weeks),
    spots: normalizeDraftInteger(selection.spots),
    grossPrice: normalizeDraftAmount(selection.grossPrice),
    traffic: normalizeDraftInteger(selection.traffic),
    impressions: normalizeDraftInteger(selection.impressions),
  };
}

function safeIdrOrZero(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(VALIDATION.grossPriceFiniteNonnegative);
  return value;
}

function assertSafeIdrAmounts(amounts: number[]): void {
  if (amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0)) {
    throw new RangeError(VALIDATION.pricingUnsafeInteger);
  }
}

function normalizeDraftInteger(value: number | undefined): number {
  return Number.isInteger(value) && (value ?? 0) >= 0 ? (value ?? 0) : 0;
}

function normalizeDraftDiscount(value: number): number {
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : 0;
}

function normalizeDraftAmount(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) >= 0 ? (value ?? 0) : 0;
}

function normalizeDraftTaxRate(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) >= 0 ? (value ?? 0) : 0.06;
}
