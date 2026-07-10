import { USERS } from "@/lib/mock-data";
import type { Role, User } from "@/lib/types";

const ROLE_CONTENT: Record<Role, { label: string; eyebrow: string; description: string; symbol: string }> = {
  sales: {
    label: "销售",
    eyebrow: "Sales",
    description: "创建与跟进客户报价，处理退回意见",
    symbol: "销",
  },
  manager: {
    label: "销售主管",
    eyebrow: "Manager",
    description: "查看团队队列，识别折扣风险与待办",
    symbol: "管",
  },
  ceo: {
    label: "CEO",
    eyebrow: "Executive",
    description: "聚焦高折扣报价与最终审批事项",
    symbol: "审",
  },
};

export function LoginScreen({ onLogin }: { onLogin: (user: User) => void }) {
  return (
    <main className="login-screen">
      <header className="login-header">
        <ProductMark />
        <span className="demo-chip">DEMO · 模拟数据</span>
      </header>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-intro">
          <p className="eyebrow">Quotation Control Center</p>
          <h1 id="login-title">报价审批中心</h1>
          <p>选择角色进入工作台，体验从销售提交到管理层审批的完整协作视角。</p>
        </div>

        <div className="role-grid" aria-label="选择演示角色">
          {USERS.map((user) => {
            const content = ROLE_CONTENT[user.role];
            return (
              <button className="role-card" type="button" key={user.id} onClick={() => onLogin(user)}>
                <span className={`role-card__symbol role-card__symbol--${user.role}`} aria-hidden="true">
                  {content.symbol}
                </span>
                <span className="role-card__copy">
                  <span className="role-card__eyebrow">{content.eyebrow}</span>
                  <strong>{content.label}</strong>
                  <span>{content.description}</span>
                </span>
                <span className="role-card__arrow" aria-hidden="true">→</span>
              </button>
            );
          })}
        </div>

        <p className="login-note">
          无需密码 · 角色可随时切换 · 所有客户与价格均为演示数据
        </p>
      </section>
    </main>
  );
}

export function ProductMark() {
  return (
    <div className="product-mark" aria-label="报价审批中心">
      <span className="product-mark__icon" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="product-mark__text">
        <strong>报价审批中心</strong>
        <small>QUOTATION WORKSPACE</small>
      </span>
    </div>
  );
}
