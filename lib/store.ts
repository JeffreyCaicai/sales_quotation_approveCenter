import { SEEDED_QUOTES, USERS } from "./mock-data.ts";
import type { ApprovalAction, Quote, QuoteStatus, Role } from "./types.ts";

const STORAGE_KEY = "quotation-prototype-v1";
const ROLES: Role[] = ["sales", "manager", "ceo"];
const STATUSES: QuoteStatus[] = ["draft", "pending_manager", "pending_ceo", "returned", "approved"];
const ACTIONS: ApprovalAction[] = ["submitted", "resubmitted", "approved", "returned"];

export function loadQuotes(): Quote[] {
  const storage = getStorage();
  if (!storage) return cloneSeeds();

  try {
    const stored = storage.getItem(STORAGE_KEY);
    if (!stored) return cloneSeeds();

    const value: unknown = JSON.parse(stored);
    return isQuoteArray(value) ? cloneQuotes(value) : cloneSeeds();
  } catch {
    return cloneSeeds();
  }
}

export function saveQuotes(quotes: Quote[]): void {
  const storage = getStorage();
  if (!storage || !isQuoteArray(quotes)) return;

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(quotes));
  } catch {
    // Demo persistence is best-effort; quota and privacy errors must not break the prototype.
  }
}

export function resetQuotes(): Quote[] {
  const storage = getStorage();

  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // A blocked storage API still permits an in-memory reset to fresh demo fixtures.
  }

  return cloneSeeds();
}

export function quotesForRole(quotes: Quote[], role: Role, userId: string): Quote[] {
  if (role === "sales") return quotes.filter((quote) => quote.salesId === userId);
  if (role === "ceo") return quotes.filter((quote) => quote.status === "pending_ceo");

  const manager = USERS.find((user) => user.role === "manager" && user.id === userId);
  const teamMemberIds = manager?.teamMemberIds ?? [];
  return quotes.filter((quote) => teamMemberIds.includes(quote.salesId));
}

function getStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function cloneSeeds(): Quote[] {
  return cloneQuotes(SEEDED_QUOTES);
}

function cloneQuotes(quotes: Quote[]): Quote[] {
  return structuredClone(quotes);
}

function isQuoteArray(value: unknown): value is Quote[] {
  return Array.isArray(value) && value.every(isQuote);
}

function isQuote(value: unknown): value is Quote {
  if (!isRecord(value) || !isRecord(value.pricing) || !Array.isArray(value.approvalHistory)) return false;
  const status = value.status as QuoteStatus;
  const hasConsistentApprovalStatus = status !== "pending_ceo"
    || (isFiniteNumber(value.discount) && value.discount > 70);
  const isEditable = status === "draft" || status === "returned";
  const hasValidPlacementMode = value.placementMode === "building"
    || value.placementMode === "package"
    || (isEditable && value.placementMode === undefined);

  return (
    isString(value.id) &&
    isString(value.quoteNumber) &&
    isString(value.salesId) &&
    isString(value.customerId) &&
    isString(value.brandId) &&
    hasValidPlacementMode &&
    isStringArray(value.placementIds) &&
    (isEditable ? isNonnegativeInteger(value.weeks) : isPositiveInteger(value.weeks)) &&
    (isEditable ? isNonnegativeInteger(value.spots) : isPositiveInteger(value.spots)) &&
    isNonnegativeInteger(value.bonus) &&
    isFiniteNumber(value.discount) && value.discount >= 0 && value.discount <= 100 &&
    isPricing(value.pricing) &&
    STATUSES.includes(status) &&
    hasConsistentApprovalStatus &&
    isPositiveInteger(value.version) &&
    value.approvalHistory.every((event) => isApprovalEvent(event, value.version as number)) &&
    isIsoTimestamp(value.createdAt) &&
    isIsoTimestamp(value.updatedAt) &&
    value.isDemoData === true &&
    (value.approvedAt === undefined || isIsoTimestamp(value.approvedAt))
  );
}

function isPricing(value: Record<string, unknown>): boolean {
  const amounts = [value.basePrice, value.discountAmount, value.netPrice, value.tax, value.total];
  return amounts.every((amount) => isFiniteNumber(amount) && amount >= 0);
}

function isApprovalEvent(value: unknown, quoteVersion: number): boolean {
  if (!isRecord(value)) return false;

  const hasCommonFields = (
    isString(value.id) &&
    ROLES.includes(value.role as Role) &&
    ACTIONS.includes(value.action as ApprovalAction) &&
    isString(value.actorId) &&
    isString(value.actorName) &&
    isIsoTimestamp(value.createdAt) &&
    isPositiveInteger(value.version) && value.version <= quoteVersion &&
    (value.comment === undefined || isString(value.comment))
  );

  if (!hasCommonFields) return false;
  if (value.action === "submitted" || value.action === "resubmitted") {
    return value.role === "sales" && value.comment === undefined;
  }
  if (value.action === "returned") {
    return (value.role === "manager" || value.role === "ceo")
      && isString(value.comment)
      && value.comment.trim().length > 0;
  }
  return value.role === "manager" || value.role === "ceo";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isIsoTimestamp(value: unknown): value is string {
  if (!isString(value)) return false;

  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value > 0;
}

function isNonnegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}
