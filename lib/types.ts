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
  priceRmb: number;
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
  priceRmb: number;
}

export interface ApprovalEvent {
  id: string;
  role: Role;
  action: ApprovalAction;
  actorId: string;
  actorName: string;
  createdAt: string;
  version: number;
  comment?: string;
}

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
}

export interface PricingSummary {
  basePrice: number;
  discountAmount: number;
  netPrice: number;
  tax: number;
  total: number;
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
  approvalHistory: ApprovalEvent[];
  createdAt: string;
  updatedAt: string;
  isDemoData: true;
  approvedAt?: string;
}
