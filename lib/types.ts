export type Role = "sales" | "manager" | "business_control" | "ceo";

export type ApproverRole = Exclude<Role, "sales">;

export type ApprovalDirectory = Record<ApproverRole, string>;

export type PlacementMode = "building" | "package";

export type DiscountBand = "standard" | "elevated" | "executive";

export type QuoteStatus =
  | "draft"
  | "pending_manager"
  | "pending_business_control"
  | "pending_ceo"
  | "returned"
  | "approved";

export type ApprovalAction = "submitted" | "resubmitted" | "approved" | "returned";

export interface DemoRecord {
  isDemoData: true;
}

export interface User extends DemoRecord {
  id: string;
  name: string;
  role: Role;
  title: string;
  teamMemberIds?: string[];
}

export interface Brand extends DemoRecord {
  id: string;
  name: string;
  category: string;
}

export interface Customer extends DemoRecord {
  id: string;
  name: string;
  industry: string;
  salesId: string;
  brands: Brand[];
}

export interface Building extends DemoRecord {
  id: string;
  name: string;
  location: string;
  category: string;
  traffic: number;
  impressions: number;
  priceIdr: number;
}

export interface SalesPackage extends DemoRecord {
  id: string;
  name: string;
  description: string;
  buildingIds: string[];
  location: string;
  category: string;
  traffic: number;
  impressions: number;
  priceIdr: number;
}

interface ApprovalEventBase {
  id: string;
  actorId: string;
  actorName: string;
  createdAt: string;
  version: number;
}

export interface SubmissionApprovalEvent extends ApprovalEventBase {
  role: "sales";
  action: "submitted" | "resubmitted";
  comment?: never;
}

export interface ApprovedApprovalEvent extends ApprovalEventBase {
  role: "manager" | "business_control" | "ceo";
  action: "approved";
  comment?: string;
}

export interface ReturnedApprovalEvent extends ApprovalEventBase {
  role: "manager" | "business_control" | "ceo";
  action: "returned";
  comment: string;
}

export type ApprovalEvent =
  | SubmissionApprovalEvent
  | ApprovedApprovalEvent
  | ReturnedApprovalEvent;

export interface CommercialSelectionInput {
  mode?: PlacementMode;
  resourceIds?: string[];
  tvcDurationSeconds?: number;
  weeks?: number;
  spots?: number;
  grossPrice?: number;
  traffic?: number;
  impressions?: number;
}

export interface CommercialSelection {
  mode: PlacementMode;
  resourceIds: string[];
  tvcDurationSeconds: number;
  weeks: number;
  spots: number;
  grossPrice: number;
  traffic: number;
  impressions: number;
}

export interface QuoteInput {
  customerId?: string;
  brandId?: string;
  placement?: CommercialSelectionInput;
  bonus?: CommercialSelectionInput;
  discount: number;
  taxRate?: number;
}

export interface PricingSummary {
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

export interface QuoteVersionSnapshot {
  version: number;
  customerId: string;
  brandId: string;
  placement: CommercialSelection;
  bonus?: CommercialSelection;
  pricing: PricingSummary;
  discount: number;
  requiredApproverId: string;
  submittedAt: string;
}

export interface Quote {
  id: string;
  quoteNumber: string;
  salesId: string;
  customerId: string;
  brandId: string;
  placement?: CommercialSelectionInput;
  bonus?: CommercialSelectionInput;
  discount: number;
  pricing: PricingSummary;
  status: QuoteStatus;
  requiredApproverId?: string;
  version: number;
  versionSnapshots: QuoteVersionSnapshot[];
  approvalHistory: ApprovalEvent[];
  createdAt: string;
  updatedAt: string;
  isDemoData: true;
  approvedAt?: string;
}

export type PendingQuoteStatus = "pending_manager" | "pending_business_control" | "pending_ceo";

export interface SubmittedQuote extends Quote {
  placement: CommercialSelection;
  bonus?: CommercialSelection;
  status: PendingQuoteStatus;
  requiredApproverId: string;
}
