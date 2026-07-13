import { USERS } from "@/lib/mock-data";
import type { Role, User } from "@/lib/types";

import { LanguageSwitcher } from "./language-switcher";
import { useLocale } from "./locale-provider";

const ROLE_SECTIONS: Record<Role, "roleSales" | "roleManager" | "roleBusinessControl" | "roleCeo"> = {
  sales: "roleSales",
  manager: "roleManager",
  business_control: "roleBusinessControl",
  ceo: "roleCeo",
};

export function LoginScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const { t } = useLocale();

  return (
    <main className="login-screen">
      <header className="login-header">
        <ProductMark />
        <LanguageSwitcher />
        <span className="demo-chip">{t("login.demo")}</span>
      </header>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-intro">
          <p className="eyebrow">{t("login.eyebrow")}</p>
          <h1 id="login-title">{t("login.title")}</h1>
          <p>{t("login.description")}</p>
        </div>

        <div className="role-grid" role="group" aria-label={t("login.rolePicker")}>
          {USERS.map((user) => {
            const section = ROLE_SECTIONS[user.role];
            return (
              <button className="role-card" type="button" key={user.id} onClick={() => onLogin(user)}>
                <span className={`role-card__symbol role-card__symbol--${user.role}`} aria-hidden="true">
                  {t(`${section}.symbol`)}
                </span>
                <span className="role-card__copy">
                  <span className="role-card__eyebrow">{t(`${section}.eyebrow`)}</span>
                  <strong>{t(`${section}.label`)}</strong>
                  <span>{t(`${section}.description`)}</span>
                </span>
                <span className="role-card__arrow" aria-hidden="true">→</span>
              </button>
            );
          })}
        </div>

        <p className="login-note">{t("login.note")}</p>
      </section>
    </main>
  );
}

export function ProductMark() {
  const { t } = useLocale();

  return (
    <div className="product-mark" aria-label={t("product.name")}>
      <span className="product-mark__icon" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="product-mark__text">
        <strong>{t("product.name")}</strong>
        <small>{t("product.workspace")}</small>
      </span>
    </div>
  );
}
