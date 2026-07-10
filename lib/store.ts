import { SEEDED_QUOTES, USERS } from "./mock-data.ts";
import type { ApprovalAction, ApprovalEvent, Quote, QuoteStatus, Role } from "./types.ts";

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
  const isEditable = status === "draft" || status === "returned";
  const hasValidPlacementMode = value.placementMode === "building"
    || value.placementMode === "package"
    || (isEditable && value.placementMode === undefined);

  const hasValidShape = (
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
    isPositiveInteger(value.version) &&
    isIsoTimestamp(value.createdAt) &&
    isIsoTimestamp(value.updatedAt) &&
    value.isDemoData === true &&
    (value.approvedAt === undefined || isIsoTimestamp(value.approvedAt))
  );

  if (!hasValidShape) return false;

  const owner = USERS.find((user) => user.id === value.salesId);
  if (!owner || owner.role !== "sales") return false;
  if (!value.approvalHistory.every((event) => isApprovalEvent(event, value.version as number))) {
    return false;
  }

  return isCurrentVersionWorkflowValid({
    status,
    discount: value.discount as number,
    version: value.version as number,
    salesId: value.salesId as string,
    approvedAt: value.approvedAt as string | undefined,
    history: value.approvalHistory as ApprovalEvent[],
  });
}

function isPricing(value: Record<string, unknown>): boolean {
  const amounts = [value.basePrice, value.discountAmount, value.netPrice, value.tax, value.total];
  return amounts.every((amount) => isFiniteNumber(amount) && amount >= 0);
}

function isApprovalEvent(value: unknown, quoteVersion: number): value is ApprovalEvent {
  if (!isRecord(value)) return false;

  const actor = USERS.find((user) => user.id === value.actorId);

  const hasCommonFields = (
    isString(value.id) &&
    ROLES.includes(value.role as Role) &&
    ACTIONS.includes(value.action as ApprovalAction) &&
    isString(value.actorId) &&
    isString(value.actorName) &&
    isIsoTimestamp(value.createdAt) &&
    isPositiveInteger(value.version) && value.version <= quoteVersion &&
    (value.comment === undefined || isString(value.comment)) &&
    actor !== undefined && actor.role === value.role && actor.name === value.actorName
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

function isCurrentVersionWorkflowValid({
  status,
  discount,
  version,
  salesId,
  approvedAt,
  history,
}: {
  status: QuoteStatus;
  discount: number;
  version: number;
  salesId: string;
  approvedAt?: string;
  history: ApprovalEvent[];
}): boolean {
  if (!isChronological(history)) return false;

  const current = history.filter((event) => event.version === version);
  if (status === "draft") return current.length === 0 && approvedAt === undefined;
  if (approvedAt !== undefined && status !== "approved") return false;
  if (current.length === 0 || history.at(-1) !== current.at(-1)) return false;

  const submissionAction = version === 1 ? "submitted" : "resubmitted";
  const submission = current[0];
  if (
    submission.role !== "sales"
    || submission.action !== submissionAction
    || submission.actorId !== salesId
  ) {
    return false;
  }

  const managerApproved = current[1]?.role === "manager" && current[1].action === "approved";
  const managerReturned = current[1]?.role === "manager" && current[1].action === "returned";
  const ceoApproved = current[2]?.role === "ceo" && current[2].action === "approved";
  const ceoReturned = current[2]?.role === "ceo" && current[2].action === "returned";

  if (status === "pending_manager") {
    return current.length === 1 && approvedAt === undefined;
  }
  if (status === "pending_ceo") {
    return discount > 70 && current.length === 2 && managerApproved && approvedAt === undefined;
  }
  if (status === "returned") {
    return approvedAt === undefined && (
      (current.length === 2 && managerReturned)
      || (discount > 70 && current.length === 3 && managerApproved && ceoReturned)
    );
  }

  const finalApproval = current.at(-1);
  if (!finalApproval || approvedAt !== finalApproval.createdAt) return false;
  if (discount <= 70) return current.length === 2 && managerApproved;
  return current.length === 3 && managerApproved && ceoApproved;
}

function isChronological(history: ApprovalEvent[]): boolean {
  for (let index = 1; index < history.length; index += 1) {
    if (Date.parse(history[index - 1].createdAt) > Date.parse(history[index].createdAt)) {
      return false;
    }
    if (history[index - 1].version > history[index].version) return false;
  }
  return true;
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
