import { calculatePricing, resolveApprovalRoute } from "./quotation.ts";
import type {
  ApprovalDirectory,
  ApprovalEvent,
  Building,
  CommercialSelection,
  Customer,
  Quote,
  SalesPackage,
  User,
} from "./types.ts";

export const DEMO_TAX_RATE = 0.06;
export const DEMO_CNY_TO_IDR_RATE = 2_662;
export const DEMO_DATA_NOTICE = "以下客户、楼宇、流量、曝光与印尼盾价格均为模拟数据，仅用于原型演示。";

export function toDemoIdr(cnyAmount: number): number {
  return Math.round(cnyAmount * DEMO_CNY_TO_IDR_RATE);
}

export const USERS: User[] = [
  {
    id: "sales-chen", name: "陈晨", role: "sales", title: "雅加达客户经理",
    salesGroup: "sales_team", canCreateQuotations: true, isDemoData: true,
  },
  {
    id: "manager-lin",
    name: "Ayu Purnama",
    role: "manager",
    title: "销售负责人",
    teamMemberIds: ["sales-chen"],
    salesGroup: "sales_team",
    canCreateQuotations: true,
    isDemoData: true,
  },
  {
    id: "sales-freelancer-demo", name: "Freelancer Demo", role: "sales", title: "Freelance Sales",
    salesGroup: "freelancer", canCreateQuotations: false, isDemoData: true,
  },
  {
    id: "sales-amal", name: "Amal", role: "sales", title: "Sales Controller",
    salesGroup: "freelancer", canCreateQuotations: true,
    canCreateOnBehalfOfSalesIds: ["sales-freelancer-demo"], isDemoData: true,
  },
  {
    id: "sales-desti", name: "Desti", role: "sales", title: "Sales Controller",
    salesGroup: "freelancer", canCreateQuotations: true,
    canCreateOnBehalfOfSalesIds: ["sales-freelancer-demo"], isDemoData: true,
  },
  {
    id: "business-control-april",
    name: "Aprilliani Shintia Dewi",
    role: "business_control",
    title: "业务控制负责人",
    isDemoData: true,
  },
  { id: "ceo-zhao", name: "Thomas", role: "ceo", title: "首席执行官", isDemoData: true },
];

export const APPROVAL_DIRECTORY: ApprovalDirectory = {
  manager: "manager-lin",
  business_control: "business-control-april",
  ceo: "ceo-zhao",
};

export const CUSTOMERS: Customer[] = [
  {
    id: "customer-kopi", name: "Kopi Nusantara 集团", industry: "餐饮与咖啡",
    salesId: "sales-chen", isDemoData: true,
    brands: [
      { id: "brand-kopi-kenangan", name: "Kopi Kenangan", category: "现制咖啡", isDemoData: true },
      { id: "brand-chaco", name: "Chaco", category: "即饮饮品", isDemoData: true },
    ],
  },
  {
    id: "customer-traveloka", name: "Traveloka Indonesia", industry: "在线旅行",
    salesId: "sales-chen", isDemoData: true,
    brands: [{ id: "brand-traveloka", name: "Traveloka", category: "旅游服务", isDemoData: true }],
  },
  {
    id: "customer-bank-mandiri", name: "Bank Mandiri", industry: "金融服务",
    salesId: "sales-chen", isDemoData: true,
    brands: [{ id: "brand-livin", name: "Livin' by Mandiri", category: "数字银行", isDemoData: true }],
  },
  {
    id: "customer-gojek", name: "GoTo Gojek Tokopedia", industry: "本地生活与电商",
    salesId: "sales-chen", isDemoData: true,
    brands: [
      { id: "brand-gofood", name: "GoFood", category: "本地生活", isDemoData: true },
      { id: "brand-tokopedia", name: "Tokopedia", category: "电子商务", isDemoData: true },
    ],
  },
  {
    id: "customer-ayu-demo", name: "Ayu Direct Account", industry: "企业客户",
    salesId: "manager-lin", isDemoData: true,
    brands: [{ id: "brand-ayu-demo", name: "Ayu Demo Brand", category: "企业服务", isDemoData: true }],
  },
  {
    id: "customer-freelancer-demo", name: "Freelancer Account", industry: "本地服务",
    salesId: "sales-freelancer-demo", isDemoData: true,
    brands: [{
      id: "brand-freelancer-demo",
      name: "Freelancer Demo Brand",
      category: "本地服务",
      isDemoData: true,
    }],
  },
];

export const BUILDINGS: Building[] = [
  { id: "building-pacific-place", name: "Pacific Place Jakarta", location: "SCBD · South Jakarta", category: "高端商场", traffic: 38_000, impressions: 720_000, priceIdr: toDemoIdr(128_000), isDemoData: true },
  { id: "building-menara-bca", name: "Menara BCA", location: "Thamrin · Central Jakarta", category: "甲级写字楼", traffic: 18_500, impressions: 365_000, priceIdr: toDemoIdr(92_000), isDemoData: true },
  { id: "building-wisma-46", name: "Wisma 46", location: "Sudirman · Central Jakarta", category: "甲级写字楼", traffic: 17_200, impressions: 338_000, priceIdr: toDemoIdr(86_000), isDemoData: true },
  { id: "building-menara-astra", name: "Menara Astra", location: "Sudirman · Central Jakarta", category: "企业总部", traffic: 16_800, impressions: 326_000, priceIdr: toDemoIdr(89_000), isDemoData: true },
  { id: "building-kota-kasablanka", name: "Kota Kasablanka", location: "Tebet · South Jakarta", category: "城市综合体", traffic: 52_000, impressions: 910_000, priceIdr: toDemoIdr(118_000), isDemoData: true },
  { id: "building-gandaria-8", name: "Gandaria 8 Office Tower", location: "Kebayoran Lama · South Jakarta", category: "甲级写字楼", traffic: 14_900, impressions: 284_000, priceIdr: toDemoIdr(78_000), isDemoData: true },
  { id: "building-sampoerna", name: "Sampoerna Strategic Square", location: "Karet Semanggi · South Jakarta", category: "商务综合体", traffic: 20_600, impressions: 402_000, priceIdr: toDemoIdr(96_000), isDemoData: true },
  { id: "building-pik-avenue", name: "PIK Avenue", location: "Pantai Indah Kapuk · North Jakarta", category: "高端商场", traffic: 43_000, impressions: 790_000, priceIdr: toDemoIdr(112_000), isDemoData: true },
];

export const PACKAGES: SalesPackage[] = [
  {
    id: "package-cbd-premium", name: "CBD Premium",
    description: "覆盖 Sudirman、Thamrin 与 SCBD 的高价值商务人群。",
    buildingIds: ["building-pacific-place", "building-menara-bca", "building-wisma-46"],
    location: "Central & South Jakarta", category: "商务核心", traffic: 73_700,
    impressions: 1_423_000, priceIdr: toDemoIdr(276_000), isDemoData: true,
  },
  {
    id: "package-south-lifestyle", name: "South Lifestyle",
    description: "连接南雅加达办公、餐饮与购物场景。",
    buildingIds: ["building-kota-kasablanka", "building-gandaria-8", "building-sampoerna"],
    location: "South Jakarta", category: "生活方式", traffic: 87_500,
    impressions: 1_596_000, priceIdr: toDemoIdr(248_000), isDemoData: true,
  },
  {
    id: "package-jakarta-signature", name: "Jakarta Signature",
    description: "横跨雅加达核心商圈与高消费生活圈的旗舰组合。",
    buildingIds: ["building-pacific-place", "building-menara-astra", "building-kota-kasablanka", "building-pik-avenue"],
    location: "Central, South & North Jakarta", category: "旗舰全域", traffic: 149_800,
    impressions: 2_746_000, priceIdr: toDemoIdr(386_000), isDemoData: true,
  },
];

function selection(
  mode: CommercialSelection["mode"],
  resourceIds: string[],
  weeks: number,
  spots: number,
): CommercialSelection {
  const catalog = mode === "building" ? BUILDINGS : PACKAGES;
  const resources = resourceIds.map((id) => catalog.find((resource) => resource.id === id));
  if (resources.some((resource) => !resource)) throw new Error("invalid demo resource");
  return {
    mode,
    resourceIds: [...resourceIds],
    tvcDurationSeconds: 15,
    weeks,
    spots,
    grossPrice: Math.round(resources.reduce((sum, resource) => sum + (resource?.priceIdr ?? 0), 0) * (weeks / 4)),
    traffic: resources.reduce((sum, resource) => sum + (resource?.traffic ?? 0), 0),
    impressions: resources.reduce((sum, resource) => sum + (resource?.impressions ?? 0), 0),
  };
}

function seedQuote({
  id,
  quoteNumber,
  customerId,
  brandId,
  placement,
  bonus,
  discount,
  status,
  submittedAt,
  decidedAt,
  comment,
}: {
  id: string;
  quoteNumber: string;
  customerId: string;
  brandId: string;
  placement: CommercialSelection;
  bonus?: CommercialSelection;
  discount: number;
  status: "pending_manager" | "pending_business_control" | "pending_ceo" | "returned" | "approved";
  submittedAt: string;
  decidedAt?: string;
  comment?: string;
}): Quote {
  const pricing = calculatePricing({ customerId, brandId, placement, bonus, discount, taxRate: DEMO_TAX_RATE });
  const {
    status: route,
    approverRole,
    requiredApproverId,
  } = resolveApprovalRoute(pricing.effectiveDiscountRate, "sales-chen", APPROVAL_DIRECTORY);
  const history: ApprovalEvent[] = [{
    id: `${id}-submitted`, role: "sales", action: "submitted", actorId: "sales-chen",
    actorName: USERS[0].name, createdAt: submittedAt, version: 1,
  }];
  if (status === "returned" || status === "approved") {
    const approver = USERS.find((user) => user.id === requiredApproverId && user.role === approverRole);
    if (!approver) throw new Error("invalid demo approval directory");
    const action = status === "returned" ? "returned" : "approved";
    history.push({
      id: `${id}-${action}`, role: approver.role, action, actorId: approver.id,
      actorName: approver.name, createdAt: decidedAt!, version: 1,
      ...(action === "returned" ? { comment: comment ?? "请调整方案后重新提交。" } : { ...(comment ? { comment } : {}) }),
    } as ApprovalEvent);
  } else if (status !== route) {
    throw new Error("demo status does not match pricing route");
  }

  return {
    id,
    quoteNumber,
    salesId: "sales-chen",
    createdById: "sales-chen",
    customerId,
    brandId,
    placement: structuredClone(placement),
    bonus: bonus ? structuredClone(bonus) : undefined,
    discount,
    pricing: { ...pricing },
    status,
    ...(status === route ? { requiredApproverId } : {}),
    version: 1,
    versionSnapshots: [{
      version: 1,
      customerId,
      brandId,
      placement: structuredClone(placement),
      bonus: bonus ? structuredClone(bonus) : undefined,
      pricing: { ...pricing },
      discount,
      requiredApproverId,
      submittedAt,
    }],
    approvalHistory: history,
    createdAt: submittedAt,
    updatedAt: decidedAt ?? submittedAt,
    ...(status === "approved" ? { approvedAt: decidedAt } : {}),
    isDemoData: true,
  };
}

export const SEEDED_QUOTES: Quote[] = [
  seedQuote({
    id: "quote-returned", quoteNumber: "DEMO-Q-202607-001",
    customerId: "customer-kopi", brandId: "brand-kopi-kenangan",
    placement: selection("building", ["building-pacific-place", "building-kota-kasablanka"], 4, 160),
    discount: 60, status: "returned", submittedAt: "2026-07-02T02:15:00.000Z",
    decidedAt: "2026-07-02T05:40:00.000Z", comment: "请补充周末商场场景，并确认 Bonus 排期。",
  }),
  seedQuote({
    id: "quote-pending-manager", quoteNumber: "DEMO-Q-202607-002",
    customerId: "customer-traveloka", brandId: "brand-traveloka",
    placement: selection("package", ["package-cbd-premium"], 6, 240),
    discount: 50, status: "pending_manager", submittedAt: "2026-07-05T03:30:00.000Z",
  }),
  seedQuote({
    id: "quote-pending-business-control", quoteNumber: "DEMO-Q-202607-003",
    customerId: "customer-bank-mandiri", brandId: "brand-livin",
    placement: selection("package", ["package-cbd-premium"], 4, 180),
    bonus: selection("building", ["building-menara-bca"], 4, 60),
    discount: 55, status: "pending_business_control", submittedAt: "2026-07-06T01:10:00.000Z",
  }),
  seedQuote({
    id: "quote-pending-ceo", quoteNumber: "DEMO-Q-202607-004",
    customerId: "customer-bank-mandiri", brandId: "brand-livin",
    placement: selection("package", ["package-jakarta-signature"], 8, 320),
    bonus: selection("building", ["building-pacific-place"], 8, 100),
    discount: 70, status: "pending_ceo", submittedAt: "2026-07-06T04:25:00.000Z",
  }),
  seedQuote({
    id: "quote-approved", quoteNumber: "DEMO-Q-202607-005",
    customerId: "customer-gojek", brandId: "brand-gofood",
    placement: selection("package", ["package-south-lifestyle"], 4, 180),
    discount: 58, status: "approved", submittedAt: "2026-07-01T02:00:00.000Z",
    decidedAt: "2026-07-01T06:20:00.000Z", comment: "价格与投放目标匹配，同意。",
  }),
];
