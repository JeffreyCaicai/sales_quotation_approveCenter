"use client";

import { useState } from "react";

import { BUILDINGS, CUSTOMERS, DEMO_TAX_RATE, PACKAGES } from "@/lib/mock-data";
import { calculatePricing, validateQuote, validateQuoteReferences } from "@/lib/quotation";
import type { TranslationKey } from "@/lib/i18n";
import type { PlacementMode, Quote, QuoteInput, User } from "@/lib/types";

import { Money } from "./ui";
import { useLocale } from "./locale-provider";

interface QuoteWizardProps {
  initialQuote?: Quote;
  salesUser: User;
  onCancel: () => void;
  onSave: (input: QuoteInput) => void;
  onSubmit: (input: QuoteInput) => void;
}

interface WizardValues {
  customerId: string;
  brandId: string;
  placementMode?: PlacementMode;
  placementIds: string[];
  weeks: number;
  spots: number;
  bonus: number;
  discount: number;
}

const STEPS: TranslationKey[] = ["wizard.stepCustomer", "wizard.stepMode", "wizard.stepResources", "wizard.stepParameters", "wizard.stepDiscount", "wizard.stepReview"];
const QUOTE_REFERENCES = { customers: CUSTOMERS, buildings: BUILDINGS, packages: PACKAGES };
const ERROR_STEPS: Record<string, number> = {
  customerId: 0,
  brandId: 0,
  placementMode: 1,
  placementIds: 2,
  basePrice: 2,
  weeks: 3,
  spots: 3,
  bonus: 3,
  discount: 4,
};

export function QuoteWizard({ initialQuote, salesUser, onCancel, onSave, onSubmit }: QuoteWizardProps) {
  const { t } = useLocale();
  const [step, setStep] = useState(0);
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [values, setValues] = useState<WizardValues>(() => ({
    customerId: initialQuote?.customerId ?? "",
    brandId: initialQuote?.brandId ?? "",
    placementMode: initialQuote?.placementMode,
    placementIds: initialQuote ? [...initialQuote.placementIds] : [],
    weeks: initialQuote?.weeks ?? 4,
    spots: initialQuote?.spots ?? 160,
    bonus: initialQuote?.bonus ?? 0,
    discount: initialQuote?.discount ?? 50,
  }));

  const customers = CUSTOMERS.filter((customer) => customer.salesId === salesUser.id);
  const customer = customers.find((item) => item.id === values.customerId);
  const brand = customer?.brands.find((item) => item.id === values.brandId);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleBuildings = normalizedSearch
    ? BUILDINGS.filter((building) =>
        `${building.name} ${building.location} ${building.category}`.toLocaleLowerCase().includes(normalizedSearch),
      )
    : BUILDINGS;
  const selectedResources = values.placementMode === "package"
    ? PACKAGES.filter((item) => values.placementIds.includes(item.id))
    : BUILDINGS.filter((item) => values.placementIds.includes(item.id));
  const weeklyRate = selectedResources.reduce((total, item) => total + item.priceRmb, 0);
  const basePrice = Number.isFinite(values.weeks)
    ? Math.round(weeklyRate * (values.weeks / 4))
    : 0;
  const traffic = selectedResources.reduce((total, item) => total + item.traffic, 0);
  const impressions = selectedResources.reduce((total, item) => total + item.impressions, 0);
  const input = toQuoteInput(values, basePrice, traffic, impressions);
  const pricing = calculatePricing({
    ...input,
    discount: Number.isFinite(input.discount) ? input.discount : 0,
  });
  const approval = approvalPath(values.discount);

  const updateValue = <Key extends keyof WizardValues>(key: Key, value: WizardValues[Key]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const validateStep = (targetStep: number) => {
    const validation = getValidationErrors(input, values, salesUser.id);
    const keysByStep: Array<Array<keyof QuoteInput | "placementMode">> = [
      ["customerId", "brandId"],
      ["placementMode"],
      ["placementIds", "basePrice"],
      ["weeks", "spots", "bonus"],
      ["discount"],
      ["customerId", "brandId", "placementMode", "placementIds", "basePrice", "weeks", "spots", "bonus", "discount"],
    ];
    const nextErrors: Record<string, string> = {};

    for (const key of keysByStep[targetStep]) {
      if (validation[key]) {
        nextErrors[key] = validation[key];
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const validateAll = () => {
    const nextErrors = getValidationErrors(input, values, salesUser.id);
    setErrors(nextErrors);
    const firstError = Object.keys(nextErrors)
      .map((key) => ERROR_STEPS[key] ?? STEPS.length - 1)
      .sort((left, right) => left - right)[0];
    if (firstError !== undefined) setStep(firstError);
    return Object.keys(nextErrors).length === 0;
  };

  const goNext = () => {
    if (!validateStep(step)) return;
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSave = () => {
    onSave(input);
  };

  const handleSubmit = () => {
    if (!validateAll()) return;
    onSubmit(input);
  };

  return (
    <div className="quote-wizard">
      <header className="wizard-heading">
        <div>
          <button className="back-button" type="button" onClick={onCancel}>← {t("wizard.back")}</button>
          <p className="eyebrow">{t("wizard.eyebrow")}</p>
          <h1>{t(initialQuote ? "wizard.editTitle" : "wizard.newTitle")}</h1>
          <p>{initialQuote ? `${initialQuote.quoteNumber} · V${initialQuote.version}` : t("wizard.description")}</p>
        </div>
        <button className="button button--secondary" type="button" onClick={handleSave}>
          {t("wizard.saveDraft")}
        </button>
      </header>

      <nav className="wizard-steps" aria-label={t("wizard.stepsLabel")}>
        <ol>
          {STEPS.map((label, index) => (
            <li key={label}>
              <button
                className={index === step ? "wizard-step wizard-step--active" : "wizard-step"}
                type="button"
                aria-current={index === step ? "step" : undefined}
                disabled={index > step}
                onClick={() => setStep(index)}
              >
                <span>{index + 1}</span>
                {t(label)}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="wizard-layout">
        <main className="wizard-panel">
          <section className="wizard-section" aria-labelledby={`wizard-step-${step}`}>
            <WizardSectionHeading step={step} />

            {step === 0 ? (
              <CustomerStep
                customers={customers}
                customerId={values.customerId}
                brandId={values.brandId}
                errors={errors}
                onCustomerChange={(customerId) => {
                  updateValue("customerId", customerId);
                  updateValue("brandId", "");
                }}
                onBrandChange={(brandId) => updateValue("brandId", brandId)}
              />
            ) : null}

            {step === 1 ? (
              <PlacementModeStep
                value={values.placementMode}
                error={errors.placementMode}
                onChange={(placementMode) => {
                  updateValue("placementMode", placementMode);
                  updateValue("placementIds", []);
                }}
              />
            ) : null}

            {step === 2 ? (
              <ResourceStep
                mode={values.placementMode}
                selectedIds={values.placementIds}
                search={search}
                visibleBuildings={visibleBuildings}
                error={errors.placementIds ?? errors.basePrice}
                onSearchChange={setSearch}
                onToggle={(id) => {
                  const selected = values.placementIds.includes(id);
                  updateValue(
                    "placementIds",
                    values.placementMode === "package"
                      ? (selected ? [] : [id])
                      : (selected
                          ? values.placementIds.filter((item) => item !== id)
                          : [...values.placementIds, id]),
                  );
                }}
              />
            ) : null}

            {step === 3 ? (
              <ParameterStep
                values={values}
                errors={errors}
                onChange={updateValue}
              />
            ) : null}

            {step === 4 ? (
              <DiscountStep
                discount={values.discount}
                approval={approval}
                error={errors.discount}
                onChange={(discount) => updateValue("discount", discount)}
              />
            ) : null}

            {step === 5 ? (
              <ReviewStep
                customerName={customer?.name ?? t("wizard.notSelected")}
                brandName={brand?.name ?? t("wizard.notSelected")}
                mode={values.placementMode}
                resources={selectedResources.map((item) => item.name)}
                values={values}
                approval={approval}
                errors={errors}
              />
            ) : null}
          </section>

          <footer className="wizard-actions">
            <button
              className="button button--secondary"
              type="button"
              onClick={step === 0 ? onCancel : () => setStep((current) => current - 1)}
            >
              {t(step === 0 ? "wizard.cancel" : "wizard.previous")}
            </button>
            {step < STEPS.length - 1 ? (
              <button className="button button--primary" type="button" onClick={goNext}>
                {t("wizard.next")}
              </button>
            ) : (
              <button className="button button--primary" type="button" onClick={handleSubmit}>
                {t(initialQuote?.status === "returned" ? "wizard.resubmit" : "wizard.submitManager")}
              </button>
            )}
          </footer>
        </main>

        <PricingSummary
          pricing={pricing}
          discount={values.discount}
          approval={approval}
          traffic={traffic}
          impressions={impressions}
        />
      </div>
    </div>
  );
}

function WizardSectionHeading({ step }: { step: number }) {
  const { t } = useLocale();
  const content = ([
    ["wizard.customerTitle", "wizard.customerHelp"], ["wizard.modeTitle", "wizard.modeHelp"],
    ["wizard.resourcesTitle", "wizard.resourcesHelp"], ["wizard.parametersTitle", "wizard.parametersHelp"],
    ["wizard.discountTitle", "wizard.discountStepHelp"], ["wizard.reviewTitle", "wizard.reviewHelp"],
  ] as Array<[TranslationKey, TranslationKey]>)[step];

  return (
    <header className="wizard-section__heading">
      <span>{t("wizard.stepProgress", { current: step + 1, total: STEPS.length })}</span>
      <h2 id={`wizard-step-${step}`}>{t(content[0])}</h2>
      <p>{t(content[1])}</p>
    </header>
  );
}

function CustomerStep({
  customers,
  customerId,
  brandId,
  errors,
  onCustomerChange,
  onBrandChange,
}: {
  customers: typeof CUSTOMERS;
  customerId: string;
  brandId: string;
  errors: Record<string, string>;
  onCustomerChange: (id: string) => void;
  onBrandChange: (id: string) => void;
}) {
  const { t } = useLocale();
  const customer = customers.find((item) => item.id === customerId);

  return (
    <div className="form-stack">
      <fieldset className="form-fieldset" aria-invalid={Boolean(errors.customerId)} aria-describedby={errors.customerId ? "customer-error" : undefined}>
        <legend>{t("wizard.customer")}</legend>
        <div className="choice-grid choice-grid--customers">
          {customers.map((item) => (
            <button
              className={item.id === customerId ? "choice-card choice-card--selected" : "choice-card"}
              type="button"
              aria-pressed={item.id === customerId}
              key={item.id}
              onClick={() => onCustomerChange(item.id)}
            >
              <span className="choice-card__check" aria-hidden="true">{item.id === customerId ? "✓" : ""}</span>
              <strong>{item.name}</strong>
              <small>{item.industry}</small>
            </button>
          ))}
        </div>
        <FieldError id="customer-error" message={errors.customerId} />
      </fieldset>

      <label className="form-field">
        <span>{t("wizard.brand")}</span>
        <select
          value={brandId}
          disabled={!customer}
          aria-invalid={Boolean(errors.brandId)}
          aria-describedby={errors.brandId ? "brand-error" : undefined}
          onChange={(event) => onBrandChange(event.target.value)}
        >
          <option value="">{t(customer ? "wizard.selectBrand" : "wizard.selectCustomerFirst")}</option>
          {customer?.brands.map((item) => (
            <option value={item.id} key={item.id}>{item.name} · {item.category}</option>
          ))}
        </select>
        <FieldError id="brand-error" message={errors.brandId} />
      </label>
    </div>
  );
}

function PlacementModeStep({
  value,
  error,
  onChange,
}: {
  value?: PlacementMode;
  error?: string;
  onChange: (mode: PlacementMode) => void;
}) {
  const { t } = useLocale();
  return (
    <fieldset
      className="form-fieldset"
      aria-invalid={Boolean(error)}
      aria-describedby={error ? "placement-mode-error" : undefined}
    >
      <legend>{t("wizard.placementMode")}</legend>
      <div className="mode-grid">
        <button
          className={value === "building" ? "mode-card mode-card--selected" : "mode-card"}
          type="button"
          aria-pressed={value === "building"}
          onClick={() => onChange("building")}
        >
          <span className="mode-card__icon" aria-hidden="true">B</span>
          <strong>{t("wizard.buildingMode")}</strong>
          <span>{t("wizard.buildingModeDescription")}</span>
          <small>{t("wizard.buildingModeMeta")}</small>
        </button>
        <button
          className={value === "package" ? "mode-card mode-card--selected" : "mode-card"}
          type="button"
          aria-pressed={value === "package"}
          onClick={() => onChange("package")}
        >
          <span className="mode-card__icon" aria-hidden="true">P</span>
          <strong>{t("wizard.packageMode")}</strong>
          <span>{t("wizard.packageModeDescription")}</span>
          <small>{t("wizard.packageModeMeta")}</small>
        </button>
      </div>
      <FieldError id="placement-mode-error" message={error} />
    </fieldset>
  );
}

function ResourceStep({
  mode,
  selectedIds,
  search,
  visibleBuildings,
  error,
  onSearchChange,
  onToggle,
}: {
  mode?: PlacementMode;
  selectedIds: string[];
  search: string;
  visibleBuildings: typeof BUILDINGS;
  error?: string;
  onSearchChange: (value: string) => void;
  onToggle: (id: string) => void;
}) {
  const { t, formatNumber } = useLocale();
  if (!mode) return <p className="inline-notice">{t("wizard.chooseModeFirst")}</p>;

  const resources = mode === "building" ? visibleBuildings : PACKAGES;
  return (
    <fieldset
      className="form-fieldset form-stack"
      aria-invalid={Boolean(error)}
      aria-describedby={error ? "placement-error" : undefined}
    >
      <legend className="sr-only">{t("wizard.resources")}</legend>
      {mode === "building" ? (
        <label className="search-field">
          <span className="sr-only">{t("wizard.searchBuildings")}</span>
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={search}
            placeholder={t("wizard.searchPlaceholder")}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
      ) : (
        <div className="package-compare-label">
          <strong>{t("wizard.packageComparison")}</strong>
          <span>{t("wizard.fourWeekRateCard")}</span>
        </div>
      )}

      <div className={mode === "package" ? "resource-grid resource-grid--packages" : "resource-grid"}>
        {resources.map((item) => {
          const selected = selectedIds.includes(item.id);
          const description = "description" in item && typeof item.description === "string"
            ? item.description
            : null;
          return (
            <button
              className={selected ? "resource-card resource-card--selected" : "resource-card"}
              type="button"
              aria-pressed={selected}
              key={item.id}
              onClick={() => onToggle(item.id)}
            >
              <span className="resource-card__topline">
                <span>{item.category}</span>
                <span className="choice-card__check" aria-hidden="true">{selected ? "✓" : ""}</span>
              </span>
              <strong>{item.name}</strong>
              <small>{item.location}</small>
              {description ? <p>{description}</p> : null}
              <span className="resource-card__metrics">
                <span><small>{t("wizard.dailyTraffic")}</small>{formatNumber(item.traffic)}</span>
                <span><small>{t("wizard.monthlyImpressions")}</small>{formatNumber(item.impressions)}</span>
              </span>
              <span className="resource-card__price"><Money amount={item.priceRmb} /><small>{t("wizard.fourWeeksSuffix")}</small></span>
            </button>
          );
        })}
      </div>
      {resources.length === 0 ? <p className="inline-notice">{t("wizard.noBuildings")}</p> : null}
      <FieldError id="placement-error" message={error} />
    </fieldset>
  );
}

function ParameterStep({
  values,
  errors,
  onChange,
}: {
  values: WizardValues;
  errors: Record<string, string>;
  onChange: <Key extends keyof WizardValues>(key: Key, value: WizardValues[Key]) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="number-grid">
      <NumberField
        id="weeks"
        label={t("wizard.weeks")}
        suffix={t("wizard.weekUnit")}
        min={1}
        value={values.weeks}
        error={errors.weeks}
        onChange={(value) => onChange("weeks", value)}
      />
      <NumberField
        id="spots"
        label={t("wizard.spots")}
        suffix={t("wizard.occurrenceUnit")}
        min={1}
        value={values.spots}
        error={errors.spots}
        onChange={(value) => onChange("spots", value)}
      />
      <NumberField
        id="bonus"
        label={t("wizard.bonus")}
        suffix={t("wizard.occurrenceUnit")}
        min={0}
        value={values.bonus}
        error={errors.bonus}
        onChange={(value) => onChange("bonus", value)}
      />
      <div className="parameter-note">
        <strong>{t("wizard.calculationNote")}</strong>
        <span>{t("wizard.calculationHelp")}</span>
      </div>
    </div>
  );
}

function DiscountStep({
  discount,
  approval,
  error,
  onChange,
}: {
  discount: number;
  approval: ReturnType<typeof approvalPath>;
  error?: string;
  onChange: (value: number) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="discount-editor">
      <label className="form-field form-field--discount">
        <span>{t("wizard.customerDiscount")}</span>
        <span className="discount-input">
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            value={Number.isFinite(discount) ? discount : ""}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "discount-error" : "discount-help"}
            onChange={(event) => onChange(event.target.value === "" ? Number.NaN : event.target.valueAsNumber)}
          />
          <span>%</span>
        </span>
        <small id="discount-help">{t("wizard.discountHelp")}</small>
        <FieldError id="discount-error" message={error} />
      </label>
      <div className={`approval-callout approval-callout--${approval.tone}`} role="status" aria-live="polite">
        <span>{t("wizard.currentApprovalPath")}</span>
        <strong>{t(approval.labelKey)}</strong>
        <p>{t(approval.descriptionKey)}</p>
      </div>
    </div>
  );
}

function ReviewStep({
  customerName,
  brandName,
  mode,
  resources,
  values,
  approval,
  errors,
}: {
  customerName: string;
  brandName: string;
  mode?: PlacementMode;
  resources: string[];
  values: WizardValues;
  approval: ReturnType<typeof approvalPath>;
  errors: Record<string, string>;
}) {
  const { locale, t, formatNumber } = useLocale();
  return (
    <div className="review-stack">
      {Object.keys(errors).length > 0 ? (
        <div className="form-error-summary" role="alert">
          <strong>{t("wizard.completeInformation")}</strong>
          <ul>{Object.values(errors).map((message) => <li key={message}>{t(message as TranslationKey)}</li>)}</ul>
        </div>
      ) : null}
      <dl className="review-grid">
        <div><dt>{t("wizard.customer")}</dt><dd>{customerName}</dd></div>
        <div><dt>{t("wizard.brand")}</dt><dd>{brandName}</dd></div>
        <div><dt>{t("wizard.placementMode")}</dt><dd>{mode ? t(mode === "building" ? "wizard.buildingMode" : "wizard.packageMode") : t("wizard.notSelected")}</dd></div>
        <div><dt>{t("wizard.parameters")}</dt><dd>{formatNumber(values.weeks)} {t("wizard.weekUnit")} · {formatNumber(values.spots)} {t("commercial.spot")} · {formatNumber(values.bonus)} {t("commercial.bonus")}</dd></div>
        <div className="review-grid__wide"><dt>{t("wizard.resources")}</dt><dd>{resources.join(locale === "zh-CN" ? "、" : ", ") || t("wizard.notSelected")}</dd></div>
        <div className="review-grid__wide"><dt>{t("wizard.approvalPath")}</dt><dd><strong>{t(approval.labelKey)}</strong></dd></div>
      </dl>
      <p className="review-notice">{t("wizard.reviewNotice")}</p>
    </div>
  );
}

function NumberField({
  id,
  label,
  suffix,
  min,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  suffix: string;
  min: number;
  value: number;
  error?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="form-field number-field">
      <span>{label}</span>
      <span className="number-input">
        <input
          id={id}
          type="number"
          min={min}
          step="1"
          value={Number.isFinite(value) ? value : ""}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.value === "" ? Number.NaN : event.target.valueAsNumber)}
        />
        <span>{suffix}</span>
      </span>
      <FieldError id={`${id}-error`} message={error} />
    </label>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  const { t } = useLocale();
  return message ? <span className="field-error" id={id} role="alert">{t(message as TranslationKey)}</span> : null;
}

function PricingSummary({
  pricing,
  discount,
  approval,
  traffic,
  impressions,
}: {
  pricing: ReturnType<typeof calculatePricing>;
  discount: number;
  approval: ReturnType<typeof approvalPath>;
  traffic: number;
  impressions: number;
}) {
  const { t, formatNumber } = useLocale();
  return (
    <aside className="pricing-summary" aria-label={t("wizard.liveSummary")}>
      <header>
        <div><span>{t("wizard.livePricing")}</span><strong>{t("wizard.liveSummary")}</strong></div>
        <span className="demo-chip">{t("wizard.demo")}</span>
      </header>
      <dl className="pricing-ledger">
        <div><dt>{t("wizard.basePrice")}</dt><dd><Money amount={pricing.basePrice} /></dd></div>
        <div><dt>{t("wizard.discountDeduction", { discount: Number.isFinite(discount) ? formatNumber(discount) : "—" })}</dt><dd className="pricing-ledger__discount">− <Money amount={pricing.discountAmount} /></dd></div>
        <div className="pricing-ledger__net"><dt>{t("wizard.netPrice")}</dt><dd><Money amount={pricing.netPrice} /></dd></div>
        <div><dt>{t("wizard.simulatedTax", { tax: formatNumber(DEMO_TAX_RATE * 100) })}</dt><dd><Money amount={pricing.tax} /></dd></div>
        <div className="pricing-ledger__total"><dt>{t("wizard.totalWithTax")}</dt><dd><Money amount={pricing.total} /></dd></div>
      </dl>
      <div className="audience-summary">
        <div><span>{t("wizard.dailyTraffic")}</span><strong>{formatNumber(traffic)}</strong></div>
        <div><span>{t("wizard.monthlyImpressions")}</span><strong>{formatNumber(impressions)}</strong></div>
      </div>
      <div className={`approval-strip approval-strip--${approval.tone}`}>
        <span>{t("wizard.approvalPath")}</span>
        <strong>{t(approval.labelKey)}</strong>
      </div>
      <p>{t("wizard.demoNotice")}</p>
    </aside>
  );
}

function toQuoteInput(values: WizardValues, basePrice: number, traffic: number, impressions: number): QuoteInput {
  return {
    customerId: values.customerId,
    brandId: values.brandId,
    placementMode: values.placementMode,
    placementIds: values.placementIds,
    weeks: values.weeks,
    spots: values.spots,
    bonus: values.bonus,
    discount: values.discount,
    basePrice,
    taxRate: DEMO_TAX_RATE,
    traffic,
    impressions,
  };
}

function getValidationErrors(input: QuoteInput, values: WizardValues, salesId: string): Record<string, string> {
  const referenceErrors = validateQuoteReferences(input, salesId, QUOTE_REFERENCES);
  const fieldErrors = validateQuote(input);

  return {
    ...referenceErrors,
    ...fieldErrors,
    ...(!values.placementMode ? { placementMode: "validation.placementModeRequired" } : {}),
  };
}

function approvalPath(discount: number) {
  if (discount > 70) {
    return {
      labelKey: "wizard.approvalExecutive",
      tone: "executive",
      descriptionKey: "wizard.approvalExecutiveHelp",
    } as const;
  }

  if (discount > 60) {
    return {
      labelKey: "wizard.approvalElevated",
      tone: "elevated",
      descriptionKey: "wizard.approvalElevatedHelp",
    } as const;
  }

  return {
    labelKey: "wizard.approvalManager",
    tone: "standard",
    descriptionKey: "wizard.approvalStandardHelp",
  } as const;
}
