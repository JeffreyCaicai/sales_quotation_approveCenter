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
  assert.match(html, /销售/);
  assert.match(html, /销售主管/);
  assert.match(html, /CEO/);
  assert.doesNotMatch(html, developmentPreviewMeta);
});

test("replaces the disposable starter with the quotation workspace", async () => {
  const [page, layout, packageJson, quotationApp, appShell, dashboard, ui] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../components/quotation-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/app-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-screen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ui.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /export const metadata:\s*Metadata/);
  assert.match(page, /<QuotationApp \/>/);
  assert.doesNotMatch(page, /codex-preview|_sites-preview|SkeletonPreview/);
  assert.doesNotMatch(layout, /title:\s*"Starter Project"/);
  assert.doesNotMatch(layout, /codex-preview|_sites-preview|themeColor|\bViewport\b/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(quotationApp, /loadQuotes/);
  assert.match(appShell, /DEMO/);
  assert.match(dashboard, /quotesForRole/);
  assert.match(ui, /export function StatusBadge/);
  assert.match(ui, /export function Money/);
  assert.match(ui, /export function Modal/);

  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", templateRoot)));
  await assert.rejects(access(new URL("app/_sites-preview/preview.css", templateRoot)));
  await assert.rejects(access(new URL("public/_sites-preview", templateRoot)));
});
