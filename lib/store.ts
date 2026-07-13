import { BUILDINGS, CUSTOMERS, PACKAGES, SEEDED_QUOTES, USERS } from "./mock-data.ts";
import { calculatePricing, getApprovalStatus } from "./quotation.ts";
import type {
  ApprovalAction,
  ApprovalEvent,
  CommercialSelection,
  CommercialSelectionInput,
  PricingSummary,
  Quote,
  QuoteStatus,
  QuoteVersionSnapshot,
  Role,
} from "./types.ts";

const STORAGE_KEY = "quotation-prototype-v3";
const ROLES: Role[] = ["sales", "manager", "business_control", "ceo"];
const STATUSES: QuoteStatus[] = [
  "draft",
  "pending_manager",
  "pending_business_control",
  "pending_ceo",
  "returned",
  "approved",
];
const ACTIONS: ApprovalAction[] = ["submitted", "resubmitted", "approved", "returned"];
const APPROVER_BY_STATUS = {
  pending_manager: "manager",
  pending_business_control: "business_control",
  pending_ceo: "ceo",
} as const;

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
  const user = USERS.find((candidate) => candidate.id === userId && candidate.role === role);
  if (!user) return [];
  if (role === "sales") return quotes.filter((quote) => quote.salesId === userId);
  if (role === "business_control") {
    return quotes.filter((quote) => quote.status === "pending_business_control" && quote.requiredApproverId === userId);
  }
  if (role === "ceo") {
    return quotes.filter((quote) => quote.status === "pending_ceo" && quote.requiredApproverId === userId);
  }
  const teamMemberIds = user.teamMemberIds ?? [];
  return quotes.filter((quote) => quote.status === "pending_manager"
    && quote.requiredApproverId === userId
    && teamMemberIds.includes(quote.salesId));
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
  if (!isRecord(value) || !isRecord(value.pricing)) return false;
  if (!Array.isArray(value.versionSnapshots) || !Array.isArray(value.approvalHistory)) return false;
  if (
    !isString(value.id)
    || !isString(value.quoteNumber)
    || !isString(value.salesId)
    || typeof value.customerId !== "string"
    || typeof value.brandId !== "string"
    || !isFiniteNumber(value.discount) || value.discount < 0 || value.discount > 100
    || !isPricing(value.pricing)
    || !STATUSES.includes(value.status as QuoteStatus)
    || (value.requiredApproverId !== undefined && !isString(value.requiredApproverId))
    || !isPositiveInteger(value.version)
    || !isIsoTimestamp(value.createdAt)
    || !isIsoTimestamp(value.updatedAt)
    || value.isDemoData !== true
    || (value.approvedAt !== undefined && !isIsoTimestamp(value.approvedAt))
  ) return false;

  const quote = value as unknown as Quote;
  const owner = USERS.find((user) => user.id === quote.salesId && user.role === "sales");
  if (!owner || !isCustomerBrandValid(quote.salesId, quote.customerId, quote.brandId, quote.status === "draft" || quote.status === "returned")) {
    return false;
  }
  if (!isCurrentStateValid(quote)) return false;

  if (quote.status === "draft") {
    return quote.version === 1
      && quote.versionSnapshots.length === 0
      && quote.approvalHistory.length === 0
      && quote.requiredApproverId === undefined
      && quote.approvedAt === undefined;
  }

  if (quote.versionSnapshots.length !== quote.version) return false;
  if (!quote.versionSnapshots.every((snapshot, index) =>
    isVersionSnapshot(snapshot, quote.salesId) && snapshot.version === index + 1
  )) return false;
  if (!quote.approvalHistory.every((event) => isApprovalEvent(event, quote.version))) return false;
  if (!hasUniqueEventIds(quote.approvalHistory)) return false;
  if (!isApprovalHistoryPhysicallyMonotonic(quote.approvalHistory)) return false;
  if (!isWorkflowValid(quote)) return false;

  const latest = quote.versionSnapshots.at(-1);
  if (!latest) return false;
  if (quote.status !== "returned" && !doesQuoteMatchSnapshot(quote, latest)) return false;
  return true;
}

function isCurrentStateValid(quote: Quote): boolean {
  const editable = quote.status === "draft" || quote.status === "returned";
  if (!isSelectionInput(quote.placement, editable)) return false;
  if (quote.bonus !== undefined && !isSelectionInput(quote.bonus, editable)) return false;
  if (!editable && quote.placement === undefined) return false;
  try {
    return arePricingEqual(quote.pricing, calculatePricing({
      customerId: quote.customerId,
      brandId: quote.brandId,
      placement: quote.placement,
      bonus: quote.bonus,
      discount: quote.discount,
    }));
  } catch {
    return false;
  }
}

function isSelectionInput(
  value: CommercialSelectionInput | undefined,
  editable: boolean,
): boolean {
  if (value === undefined) return editable;
  if (!isRecord(value)) return false;
  if (value.mode !== undefined && value.mode !== "building" && value.mode !== "package") return false;
  if (value.resourceIds !== undefined && !isStringArray(value.resourceIds)) return false;
  for (const field of ["tvcDurationSeconds", "weeks", "spots", "traffic", "impressions"] as const) {
    if (value[field] !== undefined && !isNonnegativeInteger(value[field])) return false;
  }
  if (value.grossPrice !== undefined && !isNonnegativeSafeInteger(value.grossPrice)) return false;

  const complete = isCompleteSelection(value);
  if (!editable && !complete) return false;
  if (!complete) {
    if (!editable) return false;
    const ids = value.resourceIds ?? [];
    return ids.length === new Set(ids).size
      && (value.mode !== "package" || ids.length <= 1)
      && ids.every((id) => resourceFor(value.mode, id) !== undefined);
  }
  return isCatalogSelectionValid(value);
}

function isVersionSnapshot(value: unknown, salesId: string): value is QuoteVersionSnapshot {
  if (!isRecord(value) || !isRecord(value.pricing)) return false;
  if (
    !isPositiveInteger(value.version)
    || !isString(value.customerId)
    || !isString(value.brandId)
    || !isCompleteSelection(value.placement)
    || (value.bonus !== undefined && !isCompleteSelection(value.bonus))
    || !isPricing(value.pricing)
    || !isFiniteNumber(value.discount) || value.discount < 0 || value.discount > 100
    || !isString(value.requiredApproverId)
    || !isIsoTimestamp(value.submittedAt)
  ) return false;
  if (!isCustomerBrandValid(salesId, value.customerId, value.brandId, false)) return false;
  if (!isCatalogSelectionValid(value.placement)) return false;
  if (value.bonus !== undefined && !isCatalogSelectionValid(value.bonus)) return false;
  try {
    const expected = calculatePricing({
      customerId: value.customerId,
      brandId: value.brandId,
      placement: value.placement,
      bonus: value.bonus,
      discount: value.discount,
    });
    const requiredStatus = safeApprovalStatus(expected.effectiveDiscountRate);
    if (!requiredStatus) return false;
    const requiredRole = APPROVER_BY_STATUS[requiredStatus];
    const requiredApprover = USERS.find((user) => user.id === value.requiredApproverId && user.role === requiredRole);
    return Boolean(requiredApprover) && arePricingEqual(value.pricing, expected);
  } catch {
    return false;
  }
}

function isCompleteSelection(value: unknown): value is CommercialSelection {
  if (!isRecord(value)) return false;
  return (value.mode === "building" || value.mode === "package")
    && isStringArray(value.resourceIds) && value.resourceIds.length > 0
    && isPositiveInteger(value.tvcDurationSeconds)
    && isPositiveInteger(value.weeks)
    && isPositiveInteger(value.spots)
    && isNonnegativeSafeInteger(value.grossPrice)
    && isNonnegativeInteger(value.traffic)
    && isNonnegativeInteger(value.impressions);
}

function isCatalogSelectionValid(selection: CommercialSelection): boolean {
  if (new Set(selection.resourceIds).size !== selection.resourceIds.length) return false;
  if (selection.mode === "package" && selection.resourceIds.length !== 1) return false;
  const resources = selection.resourceIds.map((id) => resourceFor(selection.mode, id));
  if (resources.some((resource) => resource === undefined)) return false;
  const expectedGross = Math.round(
    resources.reduce((sum, resource) => sum + (resource?.priceIdr ?? 0), 0) * (selection.weeks / 4),
  );
  return selection.grossPrice === expectedGross
    && selection.traffic === resources.reduce((sum, resource) => sum + (resource?.traffic ?? 0), 0)
    && selection.impressions === resources.reduce((sum, resource) => sum + (resource?.impressions ?? 0), 0);
}

function resourceFor(mode: unknown, id: string) {
  if (mode === "building") return BUILDINGS.find((resource) => resource.id === id);
  if (mode === "package") return PACKAGES.find((resource) => resource.id === id);
  return undefined;
}

function isCustomerBrandValid(
  salesId: string,
  customerId: string,
  brandId: string,
  allowIncomplete: boolean,
): boolean {
  const customer = CUSTOMERS.find((candidate) => candidate.id === customerId && candidate.salesId === salesId);
  if (!customerId && !brandId) return allowIncomplete;
  if (!customer || !brandId) return allowIncomplete && Boolean(customer) && !brandId;
  return Boolean(customer?.brands.some((brand) => brand.id === brandId));
}

function isWorkflowValid(quote: Quote): boolean {
  let priorTimestamp = quote.createdAt;
  for (const snapshot of quote.versionSnapshots) {
    const events = quote.approvalHistory.filter((event) => event.version === snapshot.version);
    const submissionAction = snapshot.version === 1 ? "submitted" : "resubmitted";
    if (events[0]?.role !== "sales" || events[0].action !== submissionAction) return false;
    if (events[0].actorId !== quote.salesId || events[0].createdAt !== snapshot.submittedAt) return false;
    if (Date.parse(events[0].createdAt) < Date.parse(priorTimestamp)) return false;

    const requiredStatus = safeApprovalStatus(snapshot.pricing.effectiveDiscountRate);
    if (!requiredStatus) return false;
    const requiredRole = APPROVER_BY_STATUS[requiredStatus];
    const requiredApprover = USERS.find((user) => user.id === snapshot.requiredApproverId && user.role === requiredRole);
    if (!requiredApprover) return false;
    const isLatest = snapshot.version === quote.version;

    if (!isLatest) {
      if (events.length !== 2 || events[1].role !== requiredRole || events[1].action !== "returned") return false;
      if (events[1].actorId !== snapshot.requiredApproverId) return false;
      priorTimestamp = events[1].createdAt;
      continue;
    }

    if (quote.status === requiredStatus) {
      if (events.length !== 1 || quote.approvedAt !== undefined) return false;
      if (quote.requiredApproverId !== snapshot.requiredApproverId) return false;
      priorTimestamp = events[0].createdAt;
    } else if (quote.status === "returned") {
      if (events.length !== 2 || events[1].role !== requiredRole || events[1].action !== "returned") return false;
      if (events[1].actorId !== snapshot.requiredApproverId || quote.requiredApproverId !== undefined) return false;
      if (quote.approvedAt !== undefined) return false;
      priorTimestamp = events[1].createdAt;
    } else if (quote.status === "approved") {
      if (events.length !== 2 || events[1].role !== requiredRole || events[1].action !== "approved") return false;
      if (events[1].actorId !== snapshot.requiredApproverId || quote.requiredApproverId !== undefined) return false;
      if (quote.approvedAt !== events[1].createdAt) return false;
      priorTimestamp = events[1].createdAt;
    } else {
      return false;
    }

    if (events.length === 2 && Date.parse(events[1].createdAt) < Date.parse(events[0].createdAt)) return false;
  }
  return Date.parse(quote.updatedAt) >= Date.parse(priorTimestamp);
}

function isApprovalEvent(value: unknown, quoteVersion: number): value is ApprovalEvent {
  if (!isRecord(value)) return false;
  if (
    !isString(value.id)
    || !isString(value.actorId)
    || !isString(value.actorName)
    || !ROLES.includes(value.role as Role)
    || !ACTIONS.includes(value.action as ApprovalAction)
    || !isIsoTimestamp(value.createdAt)
    || !isPositiveInteger(value.version) || value.version > quoteVersion
  ) return false;
  const actor = USERS.find((user) => user.id === value.actorId);
  if (!actor || actor.role !== value.role || actor.name !== value.actorName) return false;
  if (value.action === "submitted" || value.action === "resubmitted") {
    return value.role === "sales" && value.comment === undefined;
  }
  if (value.role !== "manager" && value.role !== "business_control" && value.role !== "ceo") return false;
  return value.action === "returned"
    ? isString(value.comment) && value.comment.trim().length > 0 && value.comment === value.comment.trim()
    : value.comment === undefined || isString(value.comment);
}

function doesQuoteMatchSnapshot(quote: Quote, snapshot: QuoteVersionSnapshot): boolean {
  return quote.customerId === snapshot.customerId
    && quote.brandId === snapshot.brandId
    && quote.discount === snapshot.discount
    && JSON.stringify(quote.placement) === JSON.stringify(snapshot.placement)
    && JSON.stringify(quote.bonus) === JSON.stringify(snapshot.bonus)
    && arePricingEqual(quote.pricing, snapshot.pricing);
}

function isPricing(value: unknown): value is PricingSummary {
  if (!isRecord(value)) return false;
  for (const field of [
    "placementGross",
    "placementDiscountAmount",
    "placementNet",
    "bonusGross",
    "bonusNet",
    "totalGross",
    "totalNet",
    "effectiveDiscountAmount",
    "tax",
    "totalIncludingTax",
  ] as const) {
    if (!isNonnegativeSafeInteger(value[field])) return false;
  }
  return value.bonusNet === 0
    && isFiniteNumber(value.effectiveDiscountRate)
    && value.effectiveDiscountRate >= 0
    && value.effectiveDiscountRate <= 100;
}

function arePricingEqual(left: PricingSummary, right: PricingSummary): boolean {
  return Object.keys(right).every((key) =>
    left[key as keyof PricingSummary] === right[key as keyof PricingSummary]
  ) && Object.keys(left).length === Object.keys(right).length;
}

function safeApprovalStatus(rate: number): keyof typeof APPROVER_BY_STATUS | undefined {
  try {
    const status = getApprovalStatus(rate);
    return status in APPROVER_BY_STATUS ? status as keyof typeof APPROVER_BY_STATUS : undefined;
  } catch {
    return undefined;
  }
}

function hasUniqueEventIds(events: ApprovalEvent[]): boolean {
  return new Set(events.map((event) => event.id)).size === events.length;
}

function isApprovalHistoryPhysicallyMonotonic(events: ApprovalEvent[]): boolean {
  let priorVersion = 0;
  let priorTimestamp = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    const timestamp = Date.parse(event.createdAt);
    if (event.version < priorVersion || timestamp < priorTimestamp) return false;
    priorVersion = event.version;
    priorTimestamp = timestamp;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonnegativeInteger(value) && value > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}
