import type { DiscountBand, PricingSummary, Quote, QuoteInput, QuoteStatus, User } from "./types.ts";

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
  if (!input.placementIds?.length) {
    errors.placementIds = "请至少选择一栋楼宇或一个销售包";
  }
  if (!input.weeks || input.weeks <= 0) errors.weeks = "投放周期必须大于 0";
  if (!input.spots || input.spots <= 0) errors.spots = "Spot 数量必须大于 0";
  if (!Number.isFinite(input.discount) || input.discount < 0 || input.discount > 100) {
    errors.discount = "折扣必须在 0%–100% 之间";
  }

  return errors;
}

export function submitQuote(input: QuoteInput, previousQuote: Quote | undefined, actor: User): Quote {
  const now = new Date().toISOString();
  const isResubmission = previousQuote?.status === "returned";
  const version = isResubmission ? previousQuote.version + 1 : (previousQuote?.version ?? 1);
  const identifier = now.replace(/\D/g, "");
  const id = previousQuote?.id ?? `quote-demo-${identifier}`;
  const action = isResubmission ? "resubmitted" : "submitted";

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
    approvalHistory: [
      ...(previousQuote?.approvalHistory ?? []),
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
