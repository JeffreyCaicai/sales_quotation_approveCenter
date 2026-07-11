import type {
  Building,
  Customer,
  DiscountBand,
  PricingSummary,
  Quote,
  QuoteInput,
  QuoteStatus,
  QuoteVersionSnapshot,
  SalesPackage,
  User,
} from "./types.ts";

interface QuoteReferenceData {
  customers: readonly Customer[];
  buildings: readonly Building[];
  packages: readonly SalesPackage[];
}

export function getDiscountBand(discount: number): DiscountBand {
  if (discount <= 60) return "standard";
  if (discount <= 70) return "elevated";
  return "executive";
}

export function getNextApproval(discount: number, managerApproved: boolean): QuoteStatus {
  if (!managerApproved) return "pending_manager";
  return discount > 70 ? "pending_ceo" : "approved";
}

export function calculatePricing(input: QuoteInput): PricingSummary {
  const basePrice = input.basePrice ?? 0;
  const discountAmount = Math.round(basePrice * (input.discount / 100));
  const netPrice = basePrice - discountAmount;
  const tax = Math.round(netPrice * (input.taxRate ?? 0.06));

  return {
    basePrice,
    discountAmount,
    netPrice,
    tax,
    total: netPrice + tax,
  };
}

export function validateQuote(input: QuoteInput): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!input.customerId) errors.customerId = "请选择客户";
  if (!input.brandId) errors.brandId = "请选择品牌";
  if (!input.placementMode) errors.placementMode = "请选择投放方式";
  if (!input.placementIds?.length) {
    errors.placementIds = "请至少选择一栋楼宇或一个销售包";
  }
  if (!Number.isInteger(input.weeks) || (input.weeks ?? 0) <= 0) {
    errors.weeks = "投放周期必须为正整数";
  }
  if (!Number.isInteger(input.spots) || (input.spots ?? 0) <= 0) {
    errors.spots = "Spot 数量必须为正整数";
  }
  if (!Number.isInteger(input.bonus ?? 0) || (input.bonus ?? 0) < 0) {
    errors.bonus = "Bonus 必须为非负整数";
  }
  if (!Number.isFinite(input.discount) || input.discount < 0 || input.discount > 100) {
    errors.discount = "折扣必须在 0%–100% 之间";
  }
  if (input.basePrice !== undefined && (!Number.isFinite(input.basePrice) || input.basePrice < 0)) {
    errors.basePrice = "报价基础价格必须为有限非负数";
  }
  if (input.taxRate !== undefined && (!Number.isFinite(input.taxRate) || input.taxRate < 0)) {
    errors.taxRate = "模拟税率必须为有限非负数";
  }
  if (input.traffic !== undefined && (!Number.isInteger(input.traffic) || input.traffic < 0)) {
    errors.traffic = "日均流量必须为非负整数";
  }
  if (input.impressions !== undefined && (!Number.isInteger(input.impressions) || input.impressions < 0)) {
    errors.impressions = "月曝光必须为非负整数";
  }

  return errors;
}

export function createDraftQuote(input: QuoteInput, previousQuote: Quote | undefined, actor: User): Quote {
  const now = new Date().toISOString();
  const identifier = now.replace(/\D/g, "");
  const placementIds = [...(input.placementIds ?? [])];
  const weeks = normalizeDraftInteger(input.weeks);
  const hasPricedPlacement = Boolean(input.placementMode && placementIds.length > 0 && weeks > 0);
  const normalizedInput: QuoteInput = {
    ...input,
    customerId: input.customerId ?? "",
    brandId: input.brandId ?? "",
    placementIds,
    weeks,
    spots: normalizeDraftInteger(input.spots),
    bonus: normalizeDraftInteger(input.bonus),
    discount: normalizeDraftDiscount(input.discount),
    basePrice: hasPricedPlacement ? normalizeDraftAmount(input.basePrice) : 0,
    taxRate: normalizeDraftTaxRate(input.taxRate),
  };

  return {
    id: previousQuote?.id ?? `quote-draft-${identifier}`,
    quoteNumber: previousQuote?.quoteNumber ?? `DEMO-DRAFT-${identifier.slice(0, 8)}-${identifier.slice(8)}`,
    salesId: actor.id,
    customerId: normalizedInput.customerId ?? "",
    brandId: normalizedInput.brandId ?? "",
    placementMode: normalizedInput.placementMode,
    placementIds: [...(normalizedInput.placementIds ?? [])],
    weeks: normalizedInput.weeks ?? 0,
    spots: normalizedInput.spots ?? 0,
    bonus: normalizedInput.bonus ?? 0,
    discount: normalizedInput.discount,
    pricing: calculatePricing(normalizedInput),
    status: previousQuote?.status === "returned" ? "returned" : "draft",
    version: previousQuote?.version ?? 1,
    versionSnapshots: cloneVersionSnapshots(previousQuote?.versionSnapshots ?? []),
    approvalHistory: [...(previousQuote?.approvalHistory ?? [])],
    createdAt: previousQuote?.createdAt ?? now,
    updatedAt: now,
    isDemoData: true,
  };
}

export function validateQuoteReferences(
  input: QuoteInput,
  salesId: string,
  references: QuoteReferenceData,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const customer = references.customers.find((item) => item.id === input.customerId);

  if (!customer || customer.salesId !== salesId) {
    errors.customerId = "请选择当前销售负责的客户";
  } else if (!customer.brands.some((brand) => brand.id === input.brandId)) {
    errors.brandId = "请选择该客户旗下的品牌";
  }

  const resourceIds = input.placementIds ?? [];
  const resources = input.placementMode === "building"
    ? references.buildings
    : input.placementMode === "package"
      ? references.packages
      : undefined;
  const selectedResources = resources
    ? resourceIds.map((id) => resources.find((resource) => resource.id === id))
    : [];
  const hasWrongResource = !resources
    || new Set(resourceIds).size !== resourceIds.length
    || selectedResources.some((resource) => !resource)
    || (input.placementMode === "package" && resourceIds.length !== 1);

  if (resourceIds.length > 0 && hasWrongResource) {
    errors.placementIds = "所选资源与投放方式不匹配";
  } else if (
    resourceIds.length > 0
    && selectedResources.every((resource) => resource !== undefined)
    && Number.isInteger(input.weeks)
    && (input.weeks ?? 0) > 0
  ) {
    const expectedBasePrice = Math.round(
      selectedResources.reduce((total, resource) => total + resource.priceRmb, 0)
      * ((input.weeks ?? 0) / 4),
    );
    if (!Number.isFinite(input.basePrice) || input.basePrice !== expectedBasePrice) {
      errors.basePrice = "报价基础价格与所选资源不一致";
    }
  }

  return errors;
}

export function submitQuote(input: QuoteInput, previousQuote: Quote | undefined, actor: User): Quote {
  if (actor.role !== "sales") throw new Error("只有销售可以提交报价");

  const errors = validateQuote(input);
  if (Object.keys(errors).length > 0) {
    throw new Error(Object.values(errors).join("；"));
  }

  const now = new Date().toISOString();
  const isResubmission = previousQuote?.status === "returned";
  const version = isResubmission ? previousQuote.version + 1 : (previousQuote?.version ?? 1);
  const identifier = now.replace(/\D/g, "");
  const id = previousQuote?.id ?? `quote-demo-${identifier}`;
  const action = isResubmission ? "resubmitted" : "submitted";
  const snapshot = createVersionSnapshot(input, version, now, previousQuote);
  const previousSnapshots = isResubmission
    ? cloneVersionSnapshots(previousQuote?.versionSnapshots ?? [])
    : [];

  return {
    id,
    quoteNumber: previousQuote?.quoteNumber ?? `DEMO-Q-${identifier.slice(0, 8)}-${identifier.slice(8)}`,
    salesId: actor.id,
    customerId: input.customerId ?? "",
    brandId: input.brandId ?? "",
    placementMode: input.placementMode ?? "building",
    placementIds: [...(input.placementIds ?? [])],
    weeks: input.weeks ?? 0,
    spots: input.spots ?? 0,
    bonus: input.bonus ?? 0,
    discount: input.discount,
    pricing: calculatePricing(input),
    status: "pending_manager",
    version,
    versionSnapshots: [...previousSnapshots, snapshot],
    approvalHistory: [
      ...(previousQuote?.approvalHistory ?? []),
      {
        id: `${id}-v${version}-${action}`,
        role: actor.role,
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
  previousQuote: Quote | undefined,
): QuoteVersionSnapshot {
  const matchingPreviousSnapshot = previousQuote?.versionSnapshots.at(-1);
  const hasSamePlacement = Boolean(
    matchingPreviousSnapshot
    && matchingPreviousSnapshot.placementMode === input.placementMode
    && matchingPreviousSnapshot.placementIds.length === (input.placementIds?.length ?? 0)
    && matchingPreviousSnapshot.placementIds.every((id, index) => id === input.placementIds?.[index]),
  );

  return {
    version,
    customerId: input.customerId ?? "",
    brandId: input.brandId ?? "",
    placementMode: input.placementMode ?? "building",
    placementIds: [...(input.placementIds ?? [])],
    weeks: input.weeks ?? 0,
    spots: input.spots ?? 0,
    bonus: input.bonus ?? 0,
    pricing: calculatePricing(input),
    traffic: input.traffic ?? (hasSamePlacement ? matchingPreviousSnapshot?.traffic ?? 0 : 0),
    impressions: input.impressions ?? (hasSamePlacement ? matchingPreviousSnapshot?.impressions ?? 0 : 0),
    discount: input.discount,
    submittedAt,
  };
}

function cloneVersionSnapshots(snapshots: QuoteVersionSnapshot[]): QuoteVersionSnapshot[] {
  return snapshots.map((snapshot) => ({
    ...snapshot,
    placementIds: [...snapshot.placementIds],
    pricing: { ...snapshot.pricing },
  }));
}

export function approveQuote(quote: Quote, actor: User): Quote {
  assertApprovalTransition(quote, actor);

  const now = new Date().toISOString();
  const status = actor.role === "manager" && quote.discount > 70
    ? "pending_ceo"
    : "approved";
  const eventNumber = quote.approvalHistory.length + 1;

  return {
    ...quote,
    status,
    approvalHistory: [
      ...quote.approvalHistory,
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
    updatedAt: now,
    approvedAt: status === "approved" ? now : undefined,
  };
}

export function canApproveQuote(quote: Quote, actor: User): boolean {
  if (actor.role === "manager") return quote.status === "pending_manager";
  if (actor.role === "ceo") return quote.status === "pending_ceo" && quote.discount > 70;
  return false;
}

export function returnQuote(quote: Quote, actor: User, reason: string): Quote {
  assertApprovalTransition(quote, actor);

  const comment = reason.trim();
  if (!comment) throw new Error("请填写退回原因");

  const now = new Date().toISOString();
  const eventNumber = quote.approvalHistory.length + 1;

  return {
    ...quote,
    status: "returned",
    approvalHistory: [
      ...quote.approvalHistory,
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
    updatedAt: now,
    approvedAt: undefined,
  };
}

function assertApprovalTransition(quote: Quote, actor: User): asserts actor is User & { role: "manager" | "ceo" } {
  if (actor.role !== "manager" && actor.role !== "ceo") {
    throw new Error("当前角色无权审批报价");
  }

  if (actor.role === "manager" && !canApproveQuote(quote, actor)) {
    throw new Error("报价状态不允许主管审批");
  }

  if (actor.role === "ceo" && !canApproveQuote(quote, actor)) {
    throw new Error("报价状态不允许 CEO 审批");
  }
}

function normalizeDraftInteger(value: number | undefined): number {
  return Number.isInteger(value) && (value ?? 0) >= 0 ? (value ?? 0) : 0;
}

function normalizeDraftDiscount(value: number): number {
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : 0;
}

function normalizeDraftAmount(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) >= 0 ? (value ?? 0) : 0;
}

function normalizeDraftTaxRate(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) >= 0 ? (value ?? 0) : 0.06;
}
