import type { ReactNode } from "react";

import { localizeUser } from "@/lib/display-data";
import { USERS } from "@/lib/mock-data";
import type { Role, User } from "@/lib/types";

import { LanguageSwitcher } from "./language-switcher";
import { useLocale } from "./locale-provider";
import { ProductMark } from "./login-screen";

interface AppShellProps {
  user: User;
  children: ReactNode;
  onSwitchUser: (user: User) => void;
  onReset: () => void;
  onLogout: () => void;
  onPlaceholder: (label: string) => void;
}

const ROLE_LABEL_KEYS: Record<Role, "roleSales.label" | "roleManager.label" | "roleBusinessControl.label" | "roleCeo.label"> = {
  sales: "roleSales.label",
  manager: "roleManager.label",
  business_control: "roleBusinessControl.label",
  ceo: "roleCeo.label",
};

export function AppShell({
  user,
  children,
  onSwitchUser,
  onReset,
  onLogout,
  onPlaceholder,
}: AppShellProps) {
  const { locale, t } = useLocale();
  const displayUser = localizeUser(user, locale);
  const requestReset = () => {
    if (window.confirm(t("shell.resetConfirm"))) onReset();
  };
  const requestLogout = () => {
    if (window.confirm(t("shell.logoutConfirm"))) onLogout();
  };
  const roleLabel = (role: Role) => t(ROLE_LABEL_KEYS[role]);

  return (
    <div className="app-frame">
      <header className="app-header">
        <ProductMark />

        <nav className="primary-nav" aria-label={t("shell.primaryNavigation")}>
          <button className="primary-nav__item primary-nav__item--active" type="button">
            <DashboardIcon />
            <span>{t("shell.dashboard")}</span>
          </button>
          <button className="primary-nav__item" type="button" onClick={() => onPlaceholder(t("shell.quoteRecords"))}>
            <DocumentIcon />
            <span>{t("shell.quoteRecords")}</span>
          </button>
        </nav>

        <div className="header-actions">
          <span className="demo-chip demo-chip--compact">DEMO</span>
          <LanguageSwitcher />
          <label className="role-switcher">
            <span className="sr-only">{t("shell.switchRole")}</span>
            <select
              value={user.id}
              onChange={(event) => {
                const nextUser = USERS.find((item) => item.id === event.target.value);
                if (nextUser) onSwitchUser(nextUser);
              }}
            >
              {USERS.map((item) => (
                <option value={item.id} key={item.id}>
                  {roleLabel(item.role)}
                </option>
              ))}
            </select>
          </label>
          <div className="user-menu">
            <span className="avatar" aria-hidden="true">{displayUser.name.slice(0, 1)}</span>
            <span className="user-menu__identity">
              <strong>{displayUser.name}</strong>
              <small>{roleLabel(user.role)}</small>
            </span>
            <details>
              <summary aria-label={t("shell.openUserMenu")}>•••</summary>
              <div className="user-menu__popover">
                <button type="button" onClick={requestReset}>{t("shell.reset")}</button>
                <button type="button" onClick={requestLogout}>{t("shell.logout")}</button>
              </div>
            </details>
          </div>
        </div>
      </header>

      <div className="demo-notice">
        <span aria-hidden="true">ⓘ</span>
        {t("shell.demoNotice")}
        <button type="button" onClick={requestReset}>{t("shell.restore")}</button>
      </div>

      <main className="app-main">{children}</main>

      <nav className="mobile-nav" aria-label={t("shell.mobileNavigation")}>
        <button className="mobile-nav__active" type="button"><DashboardIcon />{t("shell.dashboard")}</button>
        <button type="button" onClick={() => onPlaceholder(t("shell.quoteRecords"))}><DocumentIcon />{t("shell.quoteShort")}</button>
        <details className="mobile-account">
          <summary aria-label={t("shell.openMobileAccount")}><UserIcon />{t("shell.account")}</summary>
          <div className="mobile-account__popover">
            <div className="mobile-account__identity">
              <span className="avatar" aria-hidden="true">{displayUser.name.slice(0, 1)}</span>
              <span><strong>{displayUser.name}</strong><small>{roleLabel(user.role)}</small></span>
            </div>
            <LanguageSwitcher />
            <label className="mobile-role-switcher">
              <span>{t("shell.currentRole")}</span>
              <select
                aria-label={t("shell.mobileRoleSwitcher")}
                value={user.id}
                onChange={(event) => {
                  const nextUser = USERS.find((item) => item.id === event.target.value);
                  if (nextUser) onSwitchUser(nextUser);
                }}
              >
                {USERS.map((item) => (
                  <option value={item.id} key={item.id}>{roleLabel(item.role)}</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={requestReset}>{t("shell.reset")}</button>
            <button className="mobile-account__logout" type="button" onClick={requestLogout}>
              {t("shell.logoutCurrent")}
            </button>
          </div>
        </details>
      </nav>
    </div>
  );
}

function DashboardIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="2.5" width="6" height="6" rx="1"/><rect x="11.5" y="2.5" width="6" height="6" rx="1"/><rect x="2.5" y="11.5" width="6" height="6" rx="1"/><rect x="11.5" y="11.5" width="6" height="6" rx="1"/></svg>;
}

function DocumentIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h7l3 3v12H5z"/><path d="M12 2.5v3h3M7.5 9h5M7.5 12h5M7.5 15h3"/></svg>;
}

function UserIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="7" r="3.5"/><path d="M3.5 17c.6-3.3 2.8-5 6.5-5s5.9 1.7 6.5 5"/></svg>;
}
