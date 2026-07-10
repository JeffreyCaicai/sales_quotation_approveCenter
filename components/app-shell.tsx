import type { ReactNode } from "react";

import { USERS } from "@/lib/mock-data";
import type { User } from "@/lib/types";

import { ProductMark } from "./login-screen";

interface AppShellProps {
  user: User;
  children: ReactNode;
  onSwitchUser: (user: User) => void;
  onReset: () => void;
  onLogout: () => void;
  onPlaceholder: (label: string) => void;
}

export function AppShell({
  user,
  children,
  onSwitchUser,
  onReset,
  onLogout,
  onPlaceholder,
}: AppShellProps) {
  return (
    <div className="app-frame">
      <header className="app-header">
        <ProductMark />

        <nav className="primary-nav" aria-label="主要导航">
          <button className="primary-nav__item primary-nav__item--active" type="button">
            <DashboardIcon />
            <span>工作台</span>
          </button>
          <button className="primary-nav__item" type="button" onClick={() => onPlaceholder("报价记录")}>
            <DocumentIcon />
            <span>报价记录</span>
          </button>
        </nav>

        <div className="header-actions">
          <span className="demo-chip demo-chip--compact">DEMO</span>
          <label className="role-switcher">
            <span className="sr-only">切换角色</span>
            <select
              value={user.id}
              onChange={(event) => {
                const nextUser = USERS.find((item) => item.id === event.target.value);
                if (nextUser) onSwitchUser(nextUser);
              }}
            >
              {USERS.map((item) => (
                <option value={item.id} key={item.id}>
                  {roleLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <div className="user-menu">
            <span className="avatar" aria-hidden="true">{user.name.slice(0, 1)}</span>
            <span className="user-menu__identity">
              <strong>{user.name}</strong>
              <small>{user.title}</small>
            </span>
            <details>
              <summary aria-label="打开用户菜单">•••</summary>
              <div className="user-menu__popover">
                <button type="button" onClick={onReset}>重置演示数据</button>
                <button type="button" onClick={onLogout}>退出角色</button>
              </div>
            </details>
          </div>
        </div>
      </header>

      <div className="demo-notice">
        <span aria-hidden="true">ⓘ</span>
        当前为演示环境：客户、楼宇、流量、曝光及人民币价格均为模拟数据。
        <button type="button" onClick={onReset}>恢复初始数据</button>
      </div>

      <main className="app-main">{children}</main>

      <nav className="mobile-nav" aria-label="移动端导航">
        <button className="mobile-nav__active" type="button"><DashboardIcon />工作台</button>
        <button type="button" onClick={() => onPlaceholder("报价记录")}><DocumentIcon />报价</button>
        <details className="mobile-account">
          <summary aria-label="打开移动端账户菜单"><UserIcon />账户</summary>
          <div className="mobile-account__popover">
            <div className="mobile-account__identity">
              <span className="avatar" aria-hidden="true">{user.name.slice(0, 1)}</span>
              <span><strong>{user.name}</strong><small>{user.title}</small></span>
            </div>
            <label className="mobile-role-switcher">
              <span>当前角色</span>
              <select
                aria-label="移动端切换角色"
                value={user.id}
                onChange={(event) => {
                  const nextUser = USERS.find((item) => item.id === event.target.value);
                  if (nextUser) onSwitchUser(nextUser);
                }}
              >
                {USERS.map((item) => (
                  <option value={item.id} key={item.id}>{roleLabel(item)}</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={onReset}>重置演示数据</button>
            <button className="mobile-account__logout" type="button" onClick={onLogout}>
              退出当前角色
            </button>
          </div>
        </details>
      </nav>
    </div>
  );
}

function roleLabel(user: User) {
  if (user.role === "sales") return "销售";
  if (user.role === "manager") return "销售主管";
  return "CEO";
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
