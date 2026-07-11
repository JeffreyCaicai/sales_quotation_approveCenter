export type Role = "sales" | "manager" | "ceo";

export type PlacementMode = "building" | "package";

export type DiscountBand = "standard" | "elevated" | "executive";

export type QuoteStatus =
  | "draft"
  | "pending_manager"
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
  role: "manager" | "ceo";
  action: "approved";
  comment?: string;
}

export interface ReturnedApprovalEvent extends ApprovalEventBase {
  role: "manager" | "ceo";
  action: "returned";
  comment: string;
}

export type ApprovalEvent =
  | SubmissionApprovalEvent
  | ApprovedApprovalEvent
  | ReturnedApprovalEvent;

export interface QuoteInput {
  customerId?: string;
  brandId?: string;
  placementMode?: PlacementMode;
  placementIds?: string[];
  weeks?: number;
  spots?: number;
  bonus?: number;
  discount: number;
  basePrice?: number;
  taxRate?: number;
  traffic?: number;
  impressions?: number;
}

export interface PricingSummary {
  basePrice: number;
  discountAmount: number;
  netPrice: number;
  tax: number;
  total: number;
}

export interface QuoteVersionSnapshot {
  version: number;
  customerId: string;
  brandId: string;
  placementMode: PlacementMode;
  placementIds: string[];
  weeks: number;
  spots: number;
  bonus: number;
  pricing: PricingSummary;
  traffic: number;
  impressions: number;
  discount: number;
  submittedAt: string;
}

export interface Quote {
  id: string;
  quoteNumber: string;
  salesId: string;
  customerId: string;
  brandId: string;
  placementMode?: PlacementMode;
  placementIds: string[];
  weeks: number;
  spots: number;
  bonus: number;
  discount: number;
  pricing: PricingSummary;
  status: QuoteStatus;
  version: number;
  versionSnapshots: QuoteVersionSnapshot[];
  approvalHistory: ApprovalEvent[];
  createdAt: string;
  updatedAt: string;
  isDemoData: true;
  approvedAt?: string;
}
