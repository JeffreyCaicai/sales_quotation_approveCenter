import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;
const templateRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the quotation workspace role entry", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /报价审批中心/);
  assert.match(html, /楼宇报价与折扣审批/);
  assert.match(html, /模拟数据/);
  assert.match(html, /销售/);
  assert.match(html, /销售主管/);
  assert.match(html, /CEO/);
  assert.doesNotMatch(html, developmentPreviewMeta);
});

test("replaces the disposable starter with the quotation workspace", async () => {
  const [page, layout, packageJson, quotationApp, quoteWizard, approvalScreen, quotationScreen, appShell, dashboard, ui, css, favicon] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../components/quotation-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/quote-wizard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/approval-screen.tsx", import.meta.url), "utf8").catch(() => ""),
    readFile(new URL("../components/quotation-screen.tsx", import.meta.url), "utf8").catch(() => ""),
    readFile(new URL("../components/app-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-screen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ui.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../public/favicon.svg", import.meta.url), "utf8"),
  ]);

  assert.match(page, /export const metadata:\s*Metadata/);
  assert.match(page, /<QuotationApp \/>/);
  assert.doesNotMatch(page, /codex-preview|_sites-preview|SkeletonPreview/);
  assert.doesNotMatch(layout, /title:\s*"Starter Project"/);
  assert.match(layout, /title:\s*"报价审批中心"/);
  assert.match(layout, /description:\s*"[^"]*楼宇报价与折扣审批[^"]*"/);
  assert.doesNotMatch(layout, /codex-preview|_sites-preview|themeColor|\bViewport\b/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(quotationApp, /loadQuotes/);
  assert.match(quotationApp, /saveQuotes/);
  assert.match(quotationApp, /<QuoteWizard/);
  assert.match(quotationApp, /<ApprovalScreen/);
  assert.match(quotationApp, /approveQuote/);
  assert.match(quotationApp, /returnQuote/);
  assert.match(quotationApp, /<QuotationScreen/);
  assert.match(quotationApp, /window\.print\(\)/);
  assert.match(quoteWizard, /export function QuoteWizard/);
  assert.match(quoteWizard, /validateQuote/);
  assert.match(quoteWizard, /validateQuoteReferences/);
  assert.match(quoteWizard, /calculatePricing/);
  assert.match(quoteWizard, /销售主管 → CEO/);
  assert.match(quoteWizard, /aria-current=\{index === step \? "step" : undefined\}/);
  assert.match(quoteWizard, /aria-invalid=\{Boolean\(error\)\}/);
  assert.match(quoteWizard, /id="bonus"[\s\S]*error=\{errors\.bonus\}/);
  assert.match(quoteWizard, /const handleSave = \(\) => \{\s*onSave\(input\);\s*\}/);
  assert.match(approvalScreen, /export function ApprovalScreen/);
  assert.match(approvalScreen, /客户与品牌/);
  assert.match(approvalScreen, /投放资源/);
  assert.match(approvalScreen, /计算明细/);
  assert.match(approvalScreen, /审批时间线/);
  assert.match(approvalScreen, /<dialog/);
  assert.match(approvalScreen, /请填写退回原因/);
  assert.match(quotationScreen, /export function QuotationScreen/);
  assert.match(quotationScreen, /quote\.status !== "approved"/);
  assert.match(quotationScreen, /报价编号/);
  assert.match(quotationScreen, /报价日期/);
  assert.match(quotationScreen, /客户与品牌/);
  assert.match(quotationScreen, /销售负责人/);
  assert.match(quotationScreen, /投放周期/);
  assert.match(quotationScreen, /Spot/);
  assert.match(quotationScreen, /Bonus/);
  assert.match(quotationScreen, /日均流量/);
  assert.match(quotationScreen, /月曝光/);
  assert.match(quotationScreen, /Rate Card 基础价/);
  assert.match(quotationScreen, /折扣减免/);
  assert.match(quotationScreen, /折后净价/);
  assert.match(quotationScreen, /模拟税费/);
  assert.match(quotationScreen, /DEMO_TAX_RATE/);
  assert.doesNotMatch(quotationScreen, /pricing\.tax\s*\/\s*quote\.pricing\.netPrice/);
  assert.match(quotationScreen, /含税总额/);
  assert.match(quotationScreen, /报价条款/);
  assert.match(quotationScreen, /楼宇明细附录/);
  assert.match(quotationScreen, /审批记录/);
  assert.match(appShell, /DEMO/);
  assert.match(dashboard, /quotesForRole/);
  assert.match(ui, /export function StatusBadge/);
  assert.match(ui, /export function Money/);
  assert.match(ui, /export function Modal/);
  assert.match(ui, /<dialog/);
  assert.match(ui, /showModal\(\)/);
  assert.match(ui, /onCancel=/);
  assert.match(ui, /autoFocus/);
  assert.match(ui, /restoreFocusRef\.current\?\.focus\(\)/);
  assert.match(appShell, /aria-label="移动端切换角色"/);
  assert.match(appShell, /aria-label="打开移动端账户菜单"/);
  assert.match(appShell, /退出当前角色/);
  assert.doesNotMatch(appShell, /onClick=\{onLogout\}><UserIcon \/>我的/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /@page\s*\{[\s\S]*size:\s*A4/);
  assert.match(css, /@media print[\s\S]*\.app-header[\s\S]*display:\s*none/);
  assert.match(css, /@media print[\s\S]*\.quotation-total[\s\S]*break-inside:\s*avoid/);
  assert.match(css, /@media print[\s\S]*\.quotation-table tr[\s\S]*break-inside:\s*avoid/);
  assert.doesNotMatch(css, /\.quotation-section,\s*\.quotation-document__footer\s*\{\s*break-inside:\s*avoid/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.pricing-ledger \{ display: grid;/);
  assert.doesNotMatch(css, /\.pricing-ledger \{ display: none;/);
  assert.match(favicon, /#087F77/i);
  assert.doesNotMatch(favicon, /#68C4FF|#0C79D8|#2E9EFF/i);

  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", templateRoot)));
  await assert.rejects(access(new URL("app/_sites-preview/preview.css", templateRoot)));
  await assert.rejects(access(new URL("public/_sites-preview", templateRoot)));
});

test("includes the approved-only printable quotation experience", async () => {
  const quotationScreen = await readFile(
    new URL("../components/quotation-screen.tsx", import.meta.url),
    "utf8",
  ).catch(() => "");

  assert.match(quotationScreen, /export function QuotationScreen/);
  assert.match(quotationScreen, /quote\.status !== "approved"/);
});
