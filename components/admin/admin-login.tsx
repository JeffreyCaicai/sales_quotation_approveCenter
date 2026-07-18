"use client";

import type { FormEvent } from "react";

import type { AdminTranslate } from "@/lib/admin-i18n";

interface AdminLoginProps {
  t: AdminTranslate;
  busy: boolean;
  error: string | null;
  onSubmit(email: string, password: string): void;
}

export function AdminLogin({ t, busy, error, onSubmit }: AdminLoginProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = (event.currentTarget.elements.namedItem("email") as HTMLInputElement | null)?.value ?? "";
    const password = (event.currentTarget.elements.namedItem("password") as HTMLInputElement | null)?.value ?? "";
    onSubmit(email, password);
  };

  return (
    <main className="admin-login">
      <section className="admin-login__panel" aria-labelledby="admin-login-title">
        <AdminProductMark t={t} />
        <div className="admin-login__heading">
          <h1 id="admin-login-title">{t("login.title")}</h1>
          <p>{t("login.description")}</p>
        </div>
        <form className="admin-login__form" onSubmit={submit}>
          <label>
            <span>{t("login.email")}</span>
            <input name="email" type="email" autoComplete="username" required disabled={busy} />
          </label>
          <label>
            <span>{t("login.password")}</span>
            <input name="password" type="password" autoComplete="current-password" required disabled={busy} />
          </label>
          {error ? <p className="admin-alert admin-alert--error" role="alert">{error}</p> : null}
          <button className="admin-button admin-button--primary" type="submit" disabled={busy}>
            {busy ? t("login.submitting") : t("login.submit")}
          </button>
        </form>
      </section>
    </main>
  );
}

function AdminProductMark({ t }: Pick<AdminLoginProps, "t">) {
  return (
    <div className="admin-product-mark" aria-label={t("product.name")}>
      <span className="admin-product-mark__short">{t("product.shortName")}</span>
      <span aria-hidden="true" className="admin-product-mark__rule" />
      <strong>{t("product.name")}</strong>
    </div>
  );
}
