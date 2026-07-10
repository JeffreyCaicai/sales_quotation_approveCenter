"use client";

import { useState } from "react";

import { BUILDINGS, CUSTOMERS, DEMO_TAX_RATE, PACKAGES } from "@/lib/mock-data";
import { calculatePricing, validateQuote } from "@/lib/quotation";
import type { PlacementMode, Quote, QuoteInput, User } from "@/lib/types";

import { Money } from "./ui";

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

const STEPS = ["客户与品牌", "投放方式", "资源选择", "投放参数", "折扣审批", "确认提交"];
const METRIC_FORMATTER = new Intl.NumberFormat("zh-CN");

export function QuoteWizard({ initialQuote, salesUser, onCancel, onSave, onSubmit }: QuoteWizardProps) {
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
  const basePrice = Math.round(weeklyRate * (values.weeks / 4));
  const traffic = selectedResources.reduce((total, item) => total + item.traffic, 0);
  const impressions = selectedResources.reduce((total, item) => total + item.impressions, 0);
  const input = toQuoteInput(values, basePrice);
  const pricing = calculatePricing(input);
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
    const validation = validateQuote(input);
    const keysByStep: Array<Array<keyof QuoteInput | "placementMode">> = [
      ["customerId", "brandId"],
      ["placementMode"],
      ["placementIds"],
      ["weeks", "spots"],
      ["discount"],
      ["customerId", "brandId", "placementMode", "placementIds", "weeks", "spots", "discount"],
    ];
    const nextErrors: Record<string, string> = {};

    for (const key of keysByStep[targetStep]) {
      if (key === "placementMode" && !values.placementMode) {
        nextErrors.placementMode = "请选择投放方式";
      } else if (validation[key]) {
        nextErrors[key] = validation[key];
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const goNext = () => {
    if (!validateStep(step)) return;
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = () => {
    if (!validateStep(STEPS.length - 1)) return;
    onSubmit(input);
  };

  return (
    <div className="quote-wizard">
      <header className="wizard-heading">
        <div>
          <button className="back-button" type="button" onClick={onCancel}>← 返回工作台</button>
          <p className="eyebrow">Quotation Builder</p>
          <h1>{initialQuote ? "编辑报价" : "新建报价"}</h1>
          <p>{initialQuote ? `${initialQuote.quoteNumber} · V${initialQuote.version}` : "按步骤完成客户、资源与商业条件配置。"}</p>
        </div>
        <button className="button button--secondary" type="button" onClick={() => onSave(input)}>
          保存草稿
        </button>
      </header>

      <nav className="wizard-steps" aria-label="报价创建步骤">
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
                {label}
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
                error={errors.placementIds}
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
                customerName={customer?.name ?? "未选择"}
                brandName={brand?.name ?? "未选择"}
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
              {step === 0 ? "取消" : "上一步"}
            </button>
            {step < STEPS.length - 1 ? (
              <button className="button button--primary" type="button" onClick={goNext}>
                下一步
              </button>
            ) : (
              <button className="button button--primary" type="button" onClick={handleSubmit}>
                {initialQuote?.status === "returned" ? "重新提交审批" : "提交销售主管审批"}
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
  const content = [
    ["选择客户与品牌", "仅显示当前 Sales PIC 负责的客户。"],
    ["选择投放方式", "按单栋楼宇灵活组合，或使用预设销售包。"],
    ["选择投放资源", "Rate Card、流量和曝光均为原型模拟数据。"],
    ["设置投放参数", "基础价格按四周 Rate Card 随周期等比例计算。"],
    ["设置折扣", "审批路径会随折扣实时变化。"],
    ["确认并提交", "核对信息后提交；所有报价均先进入销售主管审批。"],
  ][step];

  return (
    <header className="wizard-section__heading">
      <span>步骤 {step + 1} / {STEPS.length}</span>
      <h2 id={`wizard-step-${step}`}>{content[0]}</h2>
      <p>{content[1]}</p>
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
  const customer = customers.find((item) => item.id === customerId);

  return (
    <div className="form-stack">
      <fieldset className="form-fieldset" aria-describedby={errors.customerId ? "customer-error" : undefined}>
        <legend>客户</legend>
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
        <span>品牌</span>
        <select
          value={brandId}
          disabled={!customer}
          aria-invalid={Boolean(errors.brandId)}
          aria-describedby={errors.brandId ? "brand-error" : undefined}
          onChange={(event) => onBrandChange(event.target.value)}
        >
          <option value="">{customer ? "请选择品牌" : "请先选择客户"}</option>
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
  return (
    <fieldset className="form-fieldset" aria-describedby={error ? "placement-mode-error" : undefined}>
      <legend>投放方式</legend>
      <div className="mode-grid">
        <button
          className={value === "building" ? "mode-card mode-card--selected" : "mode-card"}
          type="button"
          aria-pressed={value === "building"}
          onClick={() => onChange("building")}
        >
          <span className="mode-card__icon" aria-hidden="true">楼</span>
          <strong>定点挑楼</strong>
          <span>按客户目标逐栋选择，可组合多个楼宇。</span>
          <small>灵活配置 · 多选</small>
        </button>
        <button
          className={value === "package" ? "mode-card mode-card--selected" : "mode-card"}
          type="button"
          aria-pressed={value === "package"}
          onClick={() => onChange("package")}
        >
          <span className="mode-card__icon" aria-hidden="true">包</span>
          <strong>预设销售包</strong>
          <span>比较已配置的区域组合与人群覆盖。</span>
          <small>快速报价 · 单选</small>
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
  if (!mode) return <p className="inline-notice">请返回上一步选择投放方式。</p>;

  const resources = mode === "building" ? visibleBuildings : PACKAGES;
  return (
    <div className="form-stack">
      {mode === "building" ? (
        <label className="search-field">
          <span className="sr-only">搜索楼宇</span>
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={search}
            placeholder="搜索楼宇名称、区域或类型"
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
      ) : (
        <div className="package-compare-label">
          <strong>销售包对比</strong>
          <span>价格均为四周 Rate Card</span>
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
                <span><small>日均流量</small>{METRIC_FORMATTER.format(item.traffic)}</span>
                <span><small>月曝光</small>{METRIC_FORMATTER.format(item.impressions)}</span>
              </span>
              <span className="resource-card__price"><Money amount={item.priceRmb} /><small> / 4 周</small></span>
            </button>
          );
        })}
      </div>
      {resources.length === 0 ? <p className="inline-notice">没有匹配的楼宇，请调整搜索关键词。</p> : null}
      <FieldError id="placement-error" message={error} />
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
  onChange: <Key extends keyof WizardValues>(key: Key, value: WizardValues[Key]) => void;
}) {
  return (
    <div className="number-grid">
      <NumberField
        id="weeks"
        label="投放周期"
        suffix="周"
        min={1}
        value={values.weeks}
        error={errors.weeks}
        onChange={(value) => onChange("weeks", value)}
      />
      <NumberField
        id="spots"
        label="Spot 数量"
        suffix="次"
        min={1}
        value={values.spots}
        error={errors.spots}
        onChange={(value) => onChange("spots", value)}
      />
      <NumberField
        id="bonus"
        label="Bonus"
        suffix="次"
        min={0}
        value={values.bonus}
        onChange={(value) => onChange("bonus", value)}
      />
      <div className="parameter-note">
        <strong>计算说明</strong>
        <span>Rate Card 以 4 周为计价单位；Spot 与 Bonus 用于排期确认，暂不改变模拟基础价格。</span>
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
  return (
    <div className="discount-editor">
      <label className="form-field form-field--discount">
        <span>客户折扣</span>
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
        <small id="discount-help">输入 0–100，数值表示从 Rate Card 扣减的比例。</small>
        <FieldError id="discount-error" message={error} />
      </label>
      <div className={`approval-callout approval-callout--${approval.tone}`} role="status" aria-live="polite">
        <span>当前审批路径</span>
        <strong>{approval.label}</strong>
        <p>{approval.description}</p>
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
  return (
    <div className="review-stack">
      {Object.keys(errors).length > 0 ? (
        <div className="form-error-summary" role="alert">
          <strong>请先完善以下信息</strong>
          <ul>{Object.values(errors).map((message) => <li key={message}>{message}</li>)}</ul>
        </div>
      ) : null}
      <dl className="review-grid">
        <div><dt>客户</dt><dd>{customerName}</dd></div>
        <div><dt>品牌</dt><dd>{brandName}</dd></div>
        <div><dt>投放方式</dt><dd>{mode === "building" ? "定点挑楼" : "预设销售包"}</dd></div>
        <div><dt>投放参数</dt><dd>{values.weeks} 周 · {values.spots} Spot · {values.bonus} Bonus</dd></div>
        <div className="review-grid__wide"><dt>投放资源</dt><dd>{resources.join("、") || "未选择"}</dd></div>
        <div className="review-grid__wide"><dt>审批路径</dt><dd><strong>{approval.label}</strong></dd></div>
      </dl>
      <p className="review-notice">提交后报价将锁定当前版本并进入销售主管审批。高于 70% 的折扣经主管通过后再流转 CEO。</p>
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
  return message ? <span className="field-error" id={id} role="alert">{message}</span> : null;
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
  return (
    <aside className="pricing-summary" aria-label="实时报价摘要">
      <header>
        <div><span>实时价格</span><strong>报价摘要</strong></div>
        <span className="demo-chip">模拟</span>
      </header>
      <dl className="pricing-ledger">
        <div><dt>Rate Card 基础价</dt><dd><Money amount={pricing.basePrice} /></dd></div>
        <div><dt>折扣（{Number.isFinite(discount) ? discount : "—"}%）</dt><dd className="pricing-ledger__discount">− <Money amount={pricing.discountAmount} /></dd></div>
        <div className="pricing-ledger__net"><dt>折后净价</dt><dd><Money amount={pricing.netPrice} /></dd></div>
        <div><dt>模拟税费（{DEMO_TAX_RATE * 100}%）</dt><dd><Money amount={pricing.tax} /></dd></div>
        <div className="pricing-ledger__total"><dt>含税总额</dt><dd><Money amount={pricing.total} /></dd></div>
      </dl>
      <div className="audience-summary">
        <div><span>日均流量</span><strong>{METRIC_FORMATTER.format(traffic)}</strong></div>
        <div><span>月曝光</span><strong>{METRIC_FORMATTER.format(impressions)}</strong></div>
      </div>
      <div className={`approval-strip approval-strip--${approval.tone}`}>
        <span>审批路径</span>
        <strong>{approval.label}</strong>
      </div>
      <p>人民币价格、流量、曝光与 6% 税率均为演示模拟值。</p>
    </aside>
  );
}

function toQuoteInput(values: WizardValues, basePrice: number): QuoteInput {
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
  };
}

function approvalPath(discount: number) {
  if (discount > 70) {
    return {
      label: "销售主管 → CEO",
      tone: "executive",
      description: "折扣高于 70%，销售主管通过后将进入 CEO 最终审批。",
    } as const;
  }

  if (discount > 60) {
    return {
      label: "较高折扣 · 销售主管审批",
      tone: "elevated",
      description: "折扣处于关注区间，请在提交前确认商业依据。",
    } as const;
  }

  return {
    label: "销售主管审批",
    tone: "standard",
    description: "报价提交后由销售主管完成审批。",
  } as const;
}
