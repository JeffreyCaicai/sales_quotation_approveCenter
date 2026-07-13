"use client";

import { useState } from "react";

import { localizeBuilding, localizeCustomer, localizePackage } from "@/lib/display-data";
import { BUILDINGS, CUSTOMERS, DEMO_TAX_RATE, PACKAGES } from "@/lib/mock-data";
import { calculatePricing, validateQuote, validateQuoteReferences } from "@/lib/quotation";
import type { TranslationKey } from "@/lib/i18n";
import type { CommercialSelectionInput, PlacementMode, Quote, QuoteInput, User } from "@/lib/types";

import { useLocale } from "./locale-provider";
import { Money } from "./ui";

interface QuoteWizardProps {
  initialQuote?: Quote;
  salesUser: User;
  onCancel: () => void;
  onSave: (input: QuoteInput) => void;
  onSubmit: (input: QuoteInput) => void;
}

interface CommercialSelectionValues {
  mode?: PlacementMode;
  resourceIds: string[];
  tvcDurationSeconds: number;
  weeks: number;
  spots: number;
}

interface WizardValues {
  customerId: string;
  brandId: string;
  placement: CommercialSelectionValues;
  bonusEnabled: boolean;
  bonus: CommercialSelectionValues;
  discount: number;
}

type SelectionName = "placement" | "bonus";
type LocalizedBuilding = ReturnType<typeof localizeBuilding>;
type LocalizedPackage = ReturnType<typeof localizePackage>;

const STEPS: TranslationKey[] = [
  "wizard.stepCustomer",
  "commercial.placement",
  "commercial.bonus",
  "wizard.stepParameters",
  "wizard.stepDiscount",
  "wizard.stepReview",
];

const QUOTE_REFERENCES = { customers: CUSTOMERS, buildings: BUILDINGS, packages: PACKAGES };
const ERROR_STEPS: Record<string, number> = {
  customerId: 0,
  brandId: 0,
  placement: 1,
  "placement.mode": 1,
  "placement.resourceIds": 1,
  "placement.grossPrice": 1,
  "bonus.mode": 2,
  "bonus.resourceIds": 2,
  "bonus.grossPrice": 2,
  "placement.tvcDurationSeconds": 3,
  "placement.weeks": 3,
  "placement.spots": 3,
  "bonus.tvcDurationSeconds": 3,
  "bonus.weeks": 3,
  "bonus.spots": 3,
  discount: 4,
};

export function QuoteWizard({ initialQuote, salesUser, onCancel, onSave, onSubmit }: QuoteWizardProps) {
  const { locale, t } = useLocale();
  const [step, setStep] = useState(0);
  const [placementSearch, setPlacementSearch] = useState("");
  const [bonusSearch, setBonusSearch] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [values, setValues] = useState<WizardValues>(() => ({
    customerId: initialQuote?.customerId ?? "",
    brandId: initialQuote?.brandId ?? "",
    placement: selectionValues(initialQuote?.placement, 160),
    bonusEnabled: Boolean(initialQuote?.bonus),
    bonus: selectionValues(initialQuote?.bonus, 60),
    discount: initialQuote?.discount ?? 50,
  }));

  const customers = CUSTOMERS
    .filter((customer) => customer.salesId === salesUser.id)
    .map((item) => localizeCustomer(item, locale));
  const localizedBuildings = BUILDINGS.map((item) => localizeBuilding(item, locale));
  const localizedPackages = PACKAGES.map((item) => localizePackage(item, locale));
  const customer = customers.find((item) => item.id === values.customerId);
  const brand = customer?.brands.find((item) => item.id === values.brandId);
  const placementResources = selectedResources(values.placement, localizedBuildings, localizedPackages);
  const bonusResources = values.bonusEnabled
    ? selectedResources(values.bonus, localizedBuildings, localizedPackages)
    : [];
  const placement = deriveSelection(values.placement, placementResources);
  const bonus = values.bonusEnabled ? deriveSelection(values.bonus, bonusResources) : undefined;
  const input = toQuoteInput(values, placement, bonus);
  const pricing = calculatePricing({
    ...input,
    discount: Number.isFinite(input.discount) ? input.discount : 0,
  });
  const approval = approvalPath(pricing.effectiveDiscountRate);

  const clearErrors = (...keys: string[]) => {
    setErrors((current) => {
      if (!keys.some((key) => current[key])) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
  };

  const updateValue = <Key extends "customerId" | "brandId" | "discount">(
    key: Key,
    value: WizardValues[Key],
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
    clearErrors(key);
  };

  const updateSelection = <Key extends keyof CommercialSelectionValues>(
    selection: SelectionName,
    key: Key,
    value: CommercialSelectionValues[Key],
  ) => {
    setValues((current) => ({
      ...current,
      [selection]: { ...current[selection], [key]: value },
    }));
    clearErrors(`${selection}.${key}`, `${selection}.grossPrice`);
  };

  const changeSelectionMode = (selection: SelectionName, mode: PlacementMode) => {
    setValues((current) => ({
      ...current,
      [selection]: { ...current[selection], mode, resourceIds: [] },
    }));
    clearErrors(`${selection}.mode`, `${selection}.resourceIds`, `${selection}.grossPrice`);
  };

  const toggleResource = (selection: SelectionName, id: string) => {
    const currentSelection = values[selection];
    const selected = currentSelection.resourceIds.includes(id);
    updateSelection(
      selection,
      "resourceIds",
      currentSelection.mode === "package"
        ? (selected ? [] : [id])
        : selected
          ? currentSelection.resourceIds.filter((item) => item !== id)
          : [...currentSelection.resourceIds, id],
    );
  };

  const validateStep = (targetStep: number) => {
    const validation = getValidationErrors(input, salesUser.id);
    const nextErrors = Object.fromEntries(
      Object.entries(validation).filter(([key]) => targetStep === 5 || ERROR_STEPS[key] === targetStep),
    );
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const validateAll = () => {
    const nextErrors = getValidationErrors(input, salesUser.id);
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

  return (
    <div className="quote-wizard">
      <header className="wizard-heading">
        <div>
          <button className="back-button" type="button" onClick={onCancel}>← {t("wizard.back")}</button>
          <p className="eyebrow">{t("wizard.eyebrow")}</p>
          <h1>{t(initialQuote ? "wizard.editTitle" : "wizard.newTitle")}</h1>
          <p>{initialQuote ? `${initialQuote.quoteNumber} · V${initialQuote.version}` : t("wizard.description")}</p>
        </div>
        <button className="button button--secondary" type="button" onClick={() => onSave(input)}>
          {t("wizard.saveDraft")}
        </button>
      </header>

      <nav className="wizard-steps" aria-label={t("wizard.stepsLabel")}>
        <ol>
          {STEPS.map((label, index) => (
            <li key={`${label}-${index}`}>
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
              <CommercialResourceSelector
                selectionKey="placement"
                labelKey="commercial.placement"
                value={values.placement}
                search={placementSearch}
                buildings={localizedBuildings}
                packages={localizedPackages}
                errors={errors}
                onSearchChange={setPlacementSearch}
                onModeChange={(mode) => changeSelectionMode("placement", mode)}
                onToggle={(id) => toggleResource("placement", id)}
              />
            ) : null}

            {step === 2 ? (
              <BonusStep
                enabled={values.bonusEnabled}
                value={values.bonus}
                search={bonusSearch}
                buildings={localizedBuildings}
                packages={localizedPackages}
                errors={errors}
                onEnabledChange={(bonusEnabled) => {
                  setValues((current) => ({ ...current, bonusEnabled }));
                  if (!bonusEnabled) {
                    setErrors((current) => Object.fromEntries(
                      Object.entries(current).filter(([key]) => !key.startsWith("bonus.")),
                    ));
                  }
                }}
                onSearchChange={setBonusSearch}
                onModeChange={(mode) => changeSelectionMode("bonus", mode)}
                onToggle={(id) => toggleResource("bonus", id)}
              />
            ) : null}

            {step === 3 ? (
              <ParameterStep
                values={values}
                errors={errors}
                onChange={updateSelection}
              />
            ) : null}

            {step === 4 ? (
              <DiscountStep
                discount={values.discount}
                pricing={pricing}
                approval={approval}
                error={errors.discount}
                onChange={(discount) => updateValue("discount", discount)}
              />
            ) : null}

            {step === 5 ? (
              <ReviewStep
                customerName={customer?.name ?? t("wizard.notSelected")}
                brandName={brand?.name ?? t("wizard.notSelected")}
                placement={values.placement}
                placementResources={placementResources.map((item) => item.name)}
                bonusEnabled={values.bonusEnabled}
                bonus={values.bonus}
                bonusResources={bonusResources.map((item) => item.name)}
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
              <button
                className="button button--primary"
                type="button"
                onClick={() => {
                  if (validateAll()) onSubmit(input);
                }}
              >
                {t(initialQuote?.status === "returned" ? "wizard.resubmit" : "wizard.submitManager")}
              </button>
            )}
          </footer>
        </main>

        <PricingSummary
          pricing={pricing}
          discount={values.discount}
          approval={approval}
          placement={placement}
          bonus={bonus}
        />
      </div>
    </div>
  );
}

function WizardSectionHeading({ step }: { step: number }) {
  const { t } = useLocale();
  const content = ([
    ["wizard.customerTitle", "wizard.customerHelp"],
    ["commercial.placement", "wizard.resourcesHelp"],
    ["commercial.bonus", "wizard.calculationHelp"],
    ["wizard.parametersTitle", "wizard.parametersHelp"],
    ["wizard.discountTitle", "wizard.discountStepHelp"],
    ["wizard.reviewTitle", "wizard.reviewHelp"],
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
  customers: ReturnType<typeof localizeCustomer>[];
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
      <fieldset className="form-fieldset" aria-invalid={Boolean(errors.customerId)}>
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

function CommercialResourceSelector({
  selectionKey,
  labelKey,
  value,
  search,
  buildings,
  packages,
  errors,
  onSearchChange,
  onModeChange,
  onToggle,
}: {
  selectionKey: SelectionName;
  labelKey: TranslationKey;
  value: CommercialSelectionValues;
  search: string;
  buildings: LocalizedBuilding[];
  packages: LocalizedPackage[];
  errors: Record<string, string>;
  onSearchChange: (value: string) => void;
  onModeChange: (mode: PlacementMode) => void;
  onToggle: (id: string) => void;
}) {
  const { t, formatNumber } = useLocale();
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleBuildings = normalizedSearch
    ? buildings.filter((building) =>
        `${building.name} ${building.location} ${building.category}`.toLocaleLowerCase().includes(normalizedSearch),
      )
    : buildings;
  const resources = value.mode === "package" ? packages : visibleBuildings;
  const modeError = errors[`${selectionKey}.mode`];
  const resourceError = errors[`${selectionKey}.resourceIds`] ?? errors[`${selectionKey}.grossPrice`];

  return (
    <div className="commercial-selector">
      <fieldset className="form-fieldset" aria-invalid={Boolean(modeError)}>
        <legend>{t(labelKey)} · {t("wizard.placementMode")}</legend>
        <div className="mode-grid">
          <ModeCard
            selected={value.mode === "building"}
            icon="B"
            titleKey="wizard.buildingMode"
            descriptionKey="wizard.buildingModeDescription"
            metaKey="wizard.buildingModeMeta"
            onClick={() => onModeChange("building")}
          />
          <ModeCard
            selected={value.mode === "package"}
            icon="P"
            titleKey="wizard.packageMode"
            descriptionKey="wizard.packageModeDescription"
            metaKey="wizard.packageModeMeta"
            onClick={() => onModeChange("package")}
          />
        </div>
        <FieldError id={`${selectionKey}-mode-error`} message={modeError} />
      </fieldset>

      {value.mode ? (
        <fieldset className="form-fieldset form-stack" aria-invalid={Boolean(resourceError)}>
          <legend>{t("wizard.resources")}</legend>
          {value.mode === "building" ? (
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

          <div className={value.mode === "package" ? "resource-grid resource-grid--packages" : "resource-grid"}>
            {resources.map((item) => {
              const selected = value.resourceIds.includes(item.id);
              const description =
                "description" in item && typeof item.description === "string"
                  ? item.description
                  : undefined;
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
                  <span className="resource-card__price">
                    <Money amount={item.priceIdr} />
                    <small>{t("wizard.fourWeeksSuffix")}</small>
                  </span>
                </button>
              );
            })}
          </div>
          {resources.length === 0 ? <p className="inline-notice">{t("wizard.noBuildings")}</p> : null}
          <FieldError id={`${selectionKey}-resource-error`} message={resourceError} />
        </fieldset>
      ) : (
        <p className="inline-notice">{t("wizard.chooseModeFirst")}</p>
      )}
    </div>
  );
}

function ModeCard({
  selected,
  icon,
  titleKey,
  descriptionKey,
  metaKey,
  onClick,
}: {
  selected: boolean;
  icon: string;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  metaKey: TranslationKey;
  onClick: () => void;
}) {
  const { t } = useLocale();
  return (
    <button
      className={selected ? "mode-card mode-card--selected" : "mode-card"}
      type="button"
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="mode-card__icon" aria-hidden="true">{icon}</span>
      <strong>{t(titleKey)}</strong>
      <span>{t(descriptionKey)}</span>
      <small>{t(metaKey)}</small>
    </button>
  );
}

function BonusStep({
  enabled,
  value,
  search,
  buildings,
  packages,
  errors,
  onEnabledChange,
  onSearchChange,
  onModeChange,
  onToggle,
}: {
  enabled: boolean;
  value: CommercialSelectionValues;
  search: string;
  buildings: LocalizedBuilding[];
  packages: LocalizedPackage[];
  errors: Record<string, string>;
  onEnabledChange: (enabled: boolean) => void;
  onSearchChange: (value: string) => void;
  onModeChange: (mode: PlacementMode) => void;
  onToggle: (id: string) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="bonus-step">
      <div className="bonus-choice" role="group" aria-label={t("commercial.bonus")}>
        <button
          className={!enabled ? "bonus-choice__button bonus-choice__button--selected" : "bonus-choice__button"}
          type="button"
          aria-pressed={!enabled}
          onClick={() => onEnabledChange(false)}
        >
          <span aria-hidden="true">—</span>
          <strong>{t("commercial.noBonus")}</strong>
        </button>
        <button
          className={enabled ? "bonus-choice__button bonus-choice__button--selected" : "bonus-choice__button"}
          type="button"
          aria-pressed={enabled}
          onClick={() => onEnabledChange(true)}
        >
          <span aria-hidden="true">+</span>
          <strong>{t("commercial.addBonus")}</strong>
        </button>
      </div>
      {enabled ? (
        <CommercialResourceSelector
          selectionKey="bonus"
          labelKey="commercial.bonus"
          value={value}
          search={search}
          buildings={buildings}
          packages={packages}
          errors={errors}
          onSearchChange={onSearchChange}
          onModeChange={onModeChange}
          onToggle={onToggle}
        />
      ) : (
        <p className="inline-notice bonus-step__notice">{t("wizard.calculationHelp")}</p>
      )}
    </div>
  );
}

function ParameterStep({
  values,
  errors,
  onChange,
}: {
  values: WizardValues;
  errors: Record<string, string>;
  onChange: <Key extends keyof CommercialSelectionValues>(
    selection: SelectionName,
    key: Key,
    value: CommercialSelectionValues[Key],
  ) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="commercial-parameters">
      <CommercialParameterCard
        selection="placement"
        label={t("commercial.placement")}
        value={values.placement}
        errors={errors}
        onChange={onChange}
      />
      {values.bonusEnabled ? (
        <CommercialParameterCard
          selection="bonus"
          label={t("commercial.bonus")}
          value={values.bonus}
          errors={errors}
          onChange={onChange}
        />
      ) : (
        <section className="parameter-card parameter-card--disabled">
          <header><span>B</span><strong>{t("commercial.noBonus")}</strong></header>
          <p>{t("wizard.calculationHelp")}</p>
        </section>
      )}
      <div className="parameter-note">
        <strong>{t("wizard.calculationNote")}</strong>
        <span>{t("wizard.calculationHelp")}</span>
      </div>
    </div>
  );
}

function CommercialParameterCard({
  selection,
  label,
  value,
  errors,
  onChange,
}: {
  selection: SelectionName;
  label: string;
  value: CommercialSelectionValues;
  errors: Record<string, string>;
  onChange: <Key extends keyof CommercialSelectionValues>(
    selection: SelectionName,
    key: Key,
    value: CommercialSelectionValues[Key],
  ) => void;
}) {
  const { t } = useLocale();
  return (
    <section className="parameter-card">
      <header><span>{selection === "placement" ? "P" : "B"}</span><strong>{label}</strong></header>
      <div className="number-grid">
        <NumberField
          id={`${selection}-tvc-duration`}
          label={t("wizard.tvcDuration")}
          suffix={t("wizard.secondUnit")}
          min={1}
          value={value.tvcDurationSeconds}
          error={errors[`${selection}.tvcDurationSeconds`]}
          onChange={(next) => onChange(selection, "tvcDurationSeconds", next)}
        />
        <NumberField
          id={`${selection}-weeks`}
          label={t("wizard.weeks")}
          suffix={t("wizard.weekUnit")}
          min={1}
          value={value.weeks}
          error={errors[`${selection}.weeks`]}
          onChange={(next) => onChange(selection, "weeks", next)}
        />
        <NumberField
          id={`${selection}-spots`}
          label={t("wizard.spots")}
          suffix={t("wizard.occurrenceUnit")}
          min={1}
          value={value.spots}
          error={errors[`${selection}.spots`]}
          onChange={(next) => onChange(selection, "spots", next)}
        />
      </div>
    </section>
  );
}

function DiscountStep({
  discount,
  pricing,
  approval,
  error,
  onChange,
}: {
  discount: number;
  pricing: ReturnType<typeof calculatePricing>;
  approval: ReturnType<typeof approvalPath>;
  error?: string;
  onChange: (value: number) => void;
}) {
  const { t, formatNumber } = useLocale();
  return (
    <div className="discount-step-stack">
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
              onChange={(event) => onChange(event.target.value === "" ? Number.NaN : event.target.valueAsNumber)}
            />
            <span>%</span>
          </span>
          <small>{t("wizard.discountHelp")}</small>
          <FieldError id="discount-error" message={error} />
        </label>
        <div className={`approval-callout approval-callout--${approval.tone}`} role="status" aria-live="polite">
          <span>{t("commercial.directApprover")}</span>
          <strong>{t(approval.labelKey)}</strong>
          <p>{t(approval.descriptionKey)}</p>
        </div>
      </div>
      <dl className="discount-pricing-preview">
        <div><dt>{t("commercial.placementGross")}</dt><dd><Money amount={pricing.placementGross} /></dd></div>
        <div><dt>{t("wizard.discountDeduction", { discount: Number.isFinite(discount) ? formatNumber(discount) : "—" })}</dt><dd>− <Money amount={pricing.placementDiscountAmount} /></dd></div>
        <div><dt>{t("commercial.placementNett")}</dt><dd><Money amount={pricing.placementNet} /></dd></div>
        <div><dt>{t("commercial.bonusGross")}</dt><dd><Money amount={pricing.bonusGross} /></dd></div>
        <div><dt>{t("commercial.bonusNett")}</dt><dd>{t("commercial.free")}</dd></div>
        <div><dt>{t("commercial.effectiveDiscount")}</dt><dd>{formatPercent(pricing.effectiveDiscountRate)}%</dd></div>
      </dl>
    </div>
  );
}

function ReviewStep({
  customerName,
  brandName,
  placement,
  placementResources,
  bonusEnabled,
  bonus,
  bonusResources,
  approval,
  errors,
}: {
  customerName: string;
  brandName: string;
  placement: CommercialSelectionValues;
  placementResources: string[];
  bonusEnabled: boolean;
  bonus: CommercialSelectionValues;
  bonusResources: string[];
  approval: ReturnType<typeof approvalPath>;
  errors: Record<string, string>;
}) {
  const { locale, t, formatNumber } = useLocale();
  const separator = locale === "zh-CN" ? "、" : ", ";
  return (
    <div className="review-stack">
      {Object.keys(errors).length > 0 ? (
        <div className="form-error-summary" role="alert">
          <strong>{t("wizard.completeInformation")}</strong>
          <ul>{Object.entries(errors).map(([key, message]) => <li key={key}>{t(message as TranslationKey)}</li>)}</ul>
        </div>
      ) : null}
      <dl className="review-grid">
        <div><dt>{t("wizard.customer")}</dt><dd>{customerName}</dd></div>
        <div><dt>{t("wizard.brand")}</dt><dd>{brandName}</dd></div>
        <ReviewSelection
          label={t("commercial.placement")}
          value={placement}
          resources={placementResources}
          separator={separator}
          formatNumber={formatNumber}
        />
        {bonusEnabled ? (
          <ReviewSelection
            label={t("commercial.bonus")}
            value={bonus}
            resources={bonusResources}
            separator={separator}
            formatNumber={formatNumber}
          />
        ) : (
          <div className="review-grid__wide"><dt>{t("commercial.bonus")}</dt><dd>{t("commercial.noBonus")}</dd></div>
        )}
        <div className="review-grid__wide"><dt>{t("commercial.directApprover")}</dt><dd><strong>{t(approval.labelKey)}</strong></dd></div>
      </dl>
      <p className="review-notice">{t("wizard.reviewNotice")}</p>
    </div>
  );
}

function ReviewSelection({
  label,
  value,
  resources,
  separator,
  formatNumber,
}: {
  label: string;
  value: CommercialSelectionValues;
  resources: string[];
  separator: string;
  formatNumber: (value: number) => string;
}) {
  const { t } = useLocale();
  return (
    <>
      <div>
        <dt>{label} · {t("wizard.placementMode")}</dt>
        <dd>{value.mode ? t(value.mode === "building" ? "wizard.buildingMode" : "wizard.packageMode") : t("wizard.notSelected")}</dd>
      </div>
      <div>
        <dt>{label} · {t("wizard.parameters")}</dt>
        <dd>
          {formatNumber(value.tvcDurationSeconds)} {t("wizard.secondUnit")} · {formatNumber(value.weeks)} {t("wizard.weekUnit")} · {formatNumber(value.spots)} {t("wizard.occurrenceUnit")}
        </dd>
      </div>
      <div className="review-grid__wide"><dt>{label} · {t("wizard.resources")}</dt><dd>{resources.join(separator) || t("wizard.notSelected")}</dd></div>
    </>
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
  placement,
  bonus,
}: {
  pricing: ReturnType<typeof calculatePricing>;
  discount: number;
  approval: ReturnType<typeof approvalPath>;
  placement: CommercialSelectionInput;
  bonus?: CommercialSelectionInput;
}) {
  const { t, formatNumber } = useLocale();
  return (
    <aside className="pricing-summary" aria-label={t("wizard.liveSummary")}>
      <header>
        <div><span>{t("wizard.livePricing")}</span><strong>{t("wizard.liveSummary")}</strong></div>
        <span className="demo-chip">{t("wizard.demo")}</span>
      </header>
      <dl className="pricing-ledger">
        <div><dt>{t("commercial.placementGross")}</dt><dd><Money amount={pricing.placementGross} /></dd></div>
        <div><dt>{t("wizard.discountDeduction", { discount: Number.isFinite(discount) ? formatNumber(discount) : "—" })}</dt><dd className="pricing-ledger__discount">− <Money amount={pricing.placementDiscountAmount} /></dd></div>
        <div><dt>{t("commercial.placementNett")}</dt><dd><Money amount={pricing.placementNet} /></dd></div>
        <div><dt>{t("commercial.bonusGross")}</dt><dd><Money amount={pricing.bonusGross} /></dd></div>
        <div><dt>{t("commercial.bonusNett")}</dt><dd>{t("commercial.free")}</dd></div>
        <div><dt>{t("commercial.totalGross")}</dt><dd><Money amount={pricing.totalGross} /></dd></div>
        <div><dt>{t("commercial.totalNett")}</dt><dd><Money amount={pricing.totalNet} /></dd></div>
        <div><dt>{t("commercial.effectiveDiscount")}</dt><dd>{formatPercent(pricing.effectiveDiscountRate)}%</dd></div>
        <div><dt>{t("wizard.simulatedTax", { tax: formatNumber(DEMO_TAX_RATE * 100) })}</dt><dd><Money amount={pricing.tax} /></dd></div>
        <div className="pricing-ledger__total"><dt>{t("wizard.totalWithTax")}</dt><dd><Money amount={pricing.totalIncludingTax} /></dd></div>
      </dl>
      <div className="selection-audience">
        <AudienceRow label={t("commercial.placement")} selection={placement} />
        {bonus ? <AudienceRow label={t("commercial.bonus")} selection={bonus} /> : null}
      </div>
      <div className={`approval-strip approval-strip--${approval.tone}`}>
        <span>{t("commercial.directApprover")}</span>
        <strong>{t(approval.labelKey)}</strong>
      </div>
      <p>{t("wizard.demoNotice")}</p>
    </aside>
  );
}

function AudienceRow({ label, selection }: { label: string; selection: CommercialSelectionInput }) {
  const { t, formatNumber } = useLocale();
  return (
    <div>
      <strong>{label}</strong>
      <span>{t("wizard.dailyTraffic")} · {formatNumber(selection.traffic ?? 0)}</span>
      <span>{t("wizard.monthlyImpressions")} · {formatNumber(selection.impressions ?? 0)}</span>
    </div>
  );
}

function selectionValues(input: CommercialSelectionInput | undefined, defaultSpots: number): CommercialSelectionValues {
  return {
    mode: input?.mode,
    resourceIds: [...(input?.resourceIds ?? [])],
    tvcDurationSeconds: input?.tvcDurationSeconds ?? 15,
    weeks: input?.weeks ?? 4,
    spots: input?.spots ?? defaultSpots,
  };
}

function selectedResources(
  selection: CommercialSelectionValues,
  buildings: LocalizedBuilding[],
  packages: LocalizedPackage[],
): Array<LocalizedBuilding | LocalizedPackage> {
  const catalog = selection.mode === "package" ? packages : buildings;
  return catalog.filter((item) => selection.resourceIds.includes(item.id));
}

function deriveSelection(
  values: CommercialSelectionValues,
  resources: Array<LocalizedBuilding | LocalizedPackage>,
): CommercialSelectionInput {
  const fourWeekRate = resources.reduce((total, item) => total + item.priceIdr, 0);
  const weeks = Number.isFinite(values.weeks) ? values.weeks : 0;
  return {
    mode: values.mode,
    resourceIds: [...values.resourceIds],
    tvcDurationSeconds: values.tvcDurationSeconds,
    weeks: values.weeks,
    spots: values.spots,
    grossPrice: Math.round(fourWeekRate * (weeks / 4)),
    traffic: resources.reduce((total, item) => total + item.traffic, 0),
    impressions: resources.reduce((total, item) => total + item.impressions, 0),
  };
}

function toQuoteInput(
  values: WizardValues,
  placement: CommercialSelectionInput,
  bonus?: CommercialSelectionInput,
): QuoteInput {
  return {
    customerId: values.customerId,
    brandId: values.brandId,
    placement,
    ...(values.bonusEnabled && bonus ? { bonus } : {}),
    discount: values.discount,
    taxRate: DEMO_TAX_RATE,
  };
}

function getValidationErrors(input: QuoteInput, salesId: string): Record<string, string> {
  return {
    ...validateQuoteReferences(input, salesId, QUOTE_REFERENCES),
    ...validateQuote(input),
  };
}

function approvalPath(effectiveDiscountRate: number) {
  if (effectiveDiscountRate > 70) {
    return {
      labelKey: "wizard.approvalExecutive",
      tone: "executive",
      descriptionKey: "wizard.approvalExecutiveHelp",
    } as const;
  }
  if (effectiveDiscountRate > 65) {
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

function formatPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
