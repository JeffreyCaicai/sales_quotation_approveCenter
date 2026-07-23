import type { Locale } from "./i18n.ts";
import type { ApprovalEvent, Brand, Building, Customer, SalesPackage, User } from "./types.ts";

const USER_ENGLISH: Record<string, Pick<User, "name" | "title">> = {
  "sales-chen": { name: "Chen Chen", title: "Jakarta Account Manager" },
  "sales-freelancer-demo": { name: "Freelancer Demo", title: "Freelance Sales" },
  "sales-amal": { name: "Amal", title: "Sales Controller" },
  "sales-desti": { name: "Desti", title: "Sales Controller" },
  "manager-lin": { name: "Ayu Purnama", title: "Head of Sales" },
  "business-control-april": { name: "Aprilliani Shintia Dewi", title: "Head of Business Control" },
  "ceo-zhao": { name: "Thomas", title: "Chief Executive Officer" },
};

const CUSTOMER_ENGLISH: Record<string, Pick<Customer, "name" | "industry">> = {
  "customer-kopi": { name: "Kopi Nusantara Group", industry: "Food & Coffee" },
  "customer-traveloka": { name: "Traveloka Indonesia", industry: "Online Travel" },
  "customer-bank-mandiri": { name: "Bank Mandiri", industry: "Financial Services" },
  "customer-gojek": { name: "GoTo Gojek Tokopedia", industry: "Local Services & E-commerce" },
  "customer-ayu-demo": { name: "Ayu Direct Account", industry: "Corporate Account" },
  "customer-freelancer-demo": { name: "Freelancer Account", industry: "Local Services" },
};

const BRAND_CATEGORY_ENGLISH: Record<string, string> = {
  "brand-kopi-kenangan": "Freshly Brewed Coffee",
  "brand-chaco": "Ready-to-Drink Beverages",
  "brand-traveloka": "Travel Services",
  "brand-livin": "Digital Banking",
  "brand-gofood": "Local Services",
  "brand-tokopedia": "E-commerce",
  "brand-ayu-demo": "Business Services",
  "brand-freelancer-demo": "Local Services",
};

const BUILDING_CATEGORY_ENGLISH: Record<string, string> = {
  "building-pacific-place": "Premium Mall",
  "building-menara-bca": "Grade A Office",
  "building-wisma-46": "Grade A Office",
  "building-menara-astra": "Corporate Headquarters",
  "building-kota-kasablanka": "Urban Mixed-Use Complex",
  "building-gandaria-8": "Grade A Office",
  "building-sampoerna": "Business Complex",
  "building-pik-avenue": "Premium Mall",
};

const PACKAGE_ENGLISH: Record<string, Pick<SalesPackage, "description" | "category">> = {
  "package-cbd-premium": {
    description: "Reaches high-value business audiences across Sudirman, Thamrin, and SCBD.",
    category: "Core Business District",
  },
  "package-south-lifestyle": {
    description: "Connects office, dining, and shopping scenarios across South Jakarta.",
    category: "Lifestyle",
  },
  "package-jakarta-signature": {
    description: "A flagship mix spanning Jakarta’s core business districts and premium lifestyle destinations.",
    category: "Flagship Network",
  },
};

const SEEDED_EVENT_COMMENT_ENGLISH: Record<string, string> = {
  "quote-returned-returned": "Please add weekend mall scenarios and confirm the Bonus schedule.",
  "quote-approved-approved": "Pricing aligns with the campaign objective. Approved.",
};

export function localizeUser(user: User, locale: Locale): User {
  return locale === "en" ? { ...user, ...USER_ENGLISH[user.id] } : user;
}

export function localizeCustomer(customer: Customer, locale: Locale): Customer {
  if (locale !== "en") return customer;
  return {
    ...customer,
    ...CUSTOMER_ENGLISH[customer.id],
    brands: customer.brands.map((brand) => localizeBrand(brand, locale)),
  };
}

export function localizeBrand(brand: Brand, locale: Locale): Brand {
  const category = BRAND_CATEGORY_ENGLISH[brand.id];
  return locale === "en" && category ? { ...brand, category } : brand;
}

export function localizeBuilding(building: Building, locale: Locale): Building {
  const category = BUILDING_CATEGORY_ENGLISH[building.id];
  return locale === "en" && category ? { ...building, category } : building;
}

export function localizePackage(salesPackage: SalesPackage, locale: Locale): SalesPackage {
  return locale === "en" ? { ...salesPackage, ...PACKAGE_ENGLISH[salesPackage.id] } : salesPackage;
}

export function localizeApprovalEvent(event: ApprovalEvent, locale: Locale): ApprovalEvent {
  if (locale !== "en") return event;
  const actor = USER_ENGLISH[event.actorId];
  const seededComment = SEEDED_EVENT_COMMENT_ENGLISH[event.id];
  return {
    ...event,
    actorName: actor?.name ?? event.actorName,
    ...(seededComment ? { comment: seededComment } : {}),
  } as ApprovalEvent;
}
