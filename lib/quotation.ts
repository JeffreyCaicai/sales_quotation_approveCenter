import type { DiscountBand, PricingSummary, QuoteInput, QuoteStatus } from "./types.ts";

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
