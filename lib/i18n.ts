export type Locale = "en" | "zh-CN";

const LOCALE_STORAGE_KEY = "quotation-locale-v1";

interface Dictionary {
  language: {
    label: string;
    english: string;
    simplifiedChinese: string;
  };
  test: {
    greeting: string;
  };
  product: {
    name: string;
    workspace: string;
  };
  login: {
    demo: string;
    eyebrow: string;
    title: string;
    description: string;
    rolePicker: string;
    note: string;
  };
  roleSales: {
    label: string;
    eyebrow: string;
    description: string;
    symbol: string;
  };
  roleManager: {
    label: string;
    eyebrow: string;
    description: string;
    symbol: string;
  };
  roleCeo: {
    label: string;
    eyebrow: string;
    description: string;
    symbol: string;
  };
  shell: {
    primaryNavigation: string;
    dashboard: string;
    quoteRecords: string;
    quoteShort: string;
    switchRole: string;
    openUserMenu: string;
    reset: string;
    logout: string;
    demoNotice: string;
    restore: string;
    mobileNavigation: string;
    account: string;
    openMobileAccount: string;
    currentRole: string;
    mobileRoleSwitcher: string;
    logoutCurrent: string;
    resetConfirm: string;
    logoutConfirm: string;
  };
  dashboard: {
    salesEyebrow: string;
    salesTitle: string;
    salesDescription: string;
    newQuote: string;
    quoteOverview: string;
    metricDraft: string;
    metricDraftNote: string;
    metricReturned: string;
    metricReturnedNote: string;
    metricPending: string;
    metricPendingNote: string;
    metricApproved: string;
    metricApprovedNote: string;
    metricAll: string;
    metricAllNote: string;
    myQuotes: string;
    myQuotesDescription: string;
    managerEyebrow: string;
    managerTitle: string;
    managerDescription: string;
    teamOverview: string;
    metricPendingMine: string;
    metricPendingMineNote: string;
    metricRisk: string;
    metricRiskNote: string;
    metricTeam: string;
    metricTeamNote: string;
    teamQueue: string;
    teamQueueDescription: string;
    ceoEyebrow: string;
    ceoTitle: string;
    ceoDescription: string;
    executiveSummary: string;
    finalApprovals: string;
    highDiscountQuotes: string;
    approvedValue: string;
    approvedQuotes: string;
    taxIncludedSummary: string;
    ceoQueue: string;
    ceoQueueDescription: string;
    approvedQuoteTitle: string;
    approvedQuoteDescription: string;
    quoteCount: string;
    emptyTitle: string;
    emptyDescription: string;
    quoteCustomer: string;
    owner: string;
    discount: string;
    taxIncludedTotal: string;
    status: string;
    action: string;
    unknownCustomer: string;
    updatedAt: string;
    viewQuotation: string;
    reviseResubmit: string;
    continueEditing: string;
    viewProgress: string;
    reviewQuote: string;
    executiveApproval: string;
    viewDetails: string;
  };
  status: {
    draft: string;
    pendingManager: string;
    pendingCeo: string;
    returned: string;
    approved: string;
  };
  risk: {
    standard: string;
    elevated: string;
    executive: string;
  };
  modal: {
    close: string;
    acknowledge: string;
  };
  placeholder: {
    withQuote: string;
    generic: string;
    resetTitle: string;
    resetMessage: string;
  };
}

export const translations: Record<Locale, Dictionary> = {
  en: {
    language: {
      label: "Language",
      english: "English",
      simplifiedChinese: "简体中文",
    },
    test: {
      greeting: "Hello, {name}. You have {count} quotations.",
    },
    product: {
      name: "Quotation Approval Center",
      workspace: "QUOTATION WORKSPACE",
    },
    login: {
      demo: "DEMO · SAMPLE DATA",
      eyebrow: "Quotation Control Center",
      title: "Quotation Approval Center",
      description: "Choose a role to explore the complete workflow from sales submission to management approval.",
      rolePicker: "Choose a demo role",
      note: "No password required · Switch roles anytime · All customers and prices are sample data",
    },
    roleSales: {
      label: "Sales Representative",
      eyebrow: "Sales",
      description: "Create and track customer quotations and respond to returned feedback",
      symbol: "S",
    },
    roleManager: {
      label: "Sales Manager",
      eyebrow: "Manager",
      description: "Review the team queue and identify discount risks and next steps",
      symbol: "M",
    },
    roleCeo: {
      label: "Chief Executive Officer",
      eyebrow: "Executive",
      description: "Focus on high-discount quotations and final approval decisions",
      symbol: "E",
    },
    shell: {
      primaryNavigation: "Primary navigation",
      dashboard: "Dashboard",
      quoteRecords: "Quotation records",
      quoteShort: "Quotes",
      switchRole: "Switch role",
      openUserMenu: "Open user menu",
      reset: "Reset sample data",
      logout: "Leave role",
      demoNotice: "Demo environment: customers, buildings, traffic, impressions, and CNY prices are sample data.",
      restore: "Restore initial data",
      mobileNavigation: "Mobile navigation",
      account: "Account",
      openMobileAccount: "Open mobile account menu",
      currentRole: "Current role",
      mobileRoleSwitcher: "Switch role on mobile",
      logoutCurrent: "Leave current role",
      resetConfirm: "Reset all quotations to the initial sample data?",
      logoutConfirm: "Leave the current role and return to role selection?",
    },
    dashboard: {
      salesEyebrow: "Sales workspace",
      salesTitle: "Good morning, {name}",
      salesDescription: "See today's quotation progress and next steps at a glance.",
      newQuote: "New quotation",
      quoteOverview: "Quotation overview",
      metricDraft: "Drafts",
      metricDraftNote: "Complete and submit",
      metricReturned: "Returned",
      metricReturnedNote: "Needs priority attention",
      metricPending: "In approval",
      metricPendingNote: "Awaiting management review",
      metricApproved: "Approved",
      metricApprovedNote: "Ready for formal Quotation",
      metricAll: "All quotations",
      metricAllNote: "Your total quotations",
      myQuotes: "My quotations",
      myQuotesDescription: "Recently updated customer quotations",
      managerEyebrow: "Team approvals",
      managerTitle: "{name}, the team queue is up to date",
      managerDescription: "Prioritize pending reviews and examine the business rationale for high discounts.",
      teamOverview: "Team overview",
      metricPendingMine: "Awaiting my review",
      metricPendingMineNote: "Current manager stage",
      metricRisk: "At-risk quotations",
      metricRiskNote: "Discount above the standard range",
      metricTeam: "Team quotations",
      metricTeamNote: "Chen Chen · This month",
      teamQueue: "Team quotation queue",
      teamQueueDescription: "Find next steps quickly by risk and update time",
      ceoEyebrow: "Executive approvals",
      ceoTitle: "{name}, these quotations need final approval",
      ceoDescription: "Focus only on high-discount quotations that require a CEO decision.",
      executiveSummary: "Executive summary",
      finalApprovals: "Awaiting final approval",
      highDiscountQuotes: "high-discount quotations",
      approvedValue: "Approved value this period",
      approvedQuotes: "approved quotations",
      taxIncludedSummary: "The approval queue is focused by discount risk. All amounts include tax.",
      ceoQueue: "CEO approval queue",
      ceoQueueDescription: "Executive quotations already reviewed by the Sales Manager",
      approvedQuoteTitle: "Approved quotations",
      approvedQuoteDescription: "Approval complete; view and print the formal Quotation",
      quoteCount: "{count} quotations",
      emptyTitle: "No quotations need attention",
      emptyDescription: "New quotations will appear here when they enter this stage.",
      quoteCustomer: "Quotation / Customer",
      owner: "Owner",
      discount: "Discount",
      taxIncludedTotal: "Total incl. tax",
      status: "Status",
      action: "Action",
      unknownCustomer: "Unknown customer",
      updatedAt: "{number} · Updated {date}",
      viewQuotation: "View formal Quotation",
      reviseResubmit: "Revise and resubmit",
      continueEditing: "Continue editing",
      viewProgress: "View progress",
      reviewQuote: "Review quotation",
      executiveApproval: "Approve quotation",
      viewDetails: "View details",
    },
    status: {
      draft: "Draft",
      pendingManager: "Awaiting Sales Manager",
      pendingCeo: "Awaiting CEO",
      returned: "Returned",
      approved: "Approved",
    },
    risk: {
      standard: "Standard",
      elevated: "Attention",
      executive: "High risk",
    },
    modal: {
      close: "Close dialog",
      acknowledge: "Got it",
    },
    placeholder: {
      withQuote: "The {label} flow for {number} will be available in a later prototype stage.",
      generic: "The {label} flow will be available in a later prototype stage.",
      resetTitle: "Sample data reset",
      resetMessage: "All quotations have been restored to their initial sample state.",
    },
  },
  "zh-CN": {
    language: {
      label: "语言",
      english: "English",
      simplifiedChinese: "简体中文",
    },
    test: {
      greeting: "你好，{name}。你有 {count} 份报价。",
    },
    product: {
      name: "报价审批中心",
      workspace: "报价工作台",
    },
    login: {
      demo: "DEMO · 模拟数据",
      eyebrow: "报价控制中心",
      title: "报价审批中心",
      description: "选择角色进入工作台，体验从销售提交到管理层审批的完整协作视角。",
      rolePicker: "选择演示角色",
      note: "无需密码 · 角色可随时切换 · 所有客户与价格均为演示数据",
    },
    roleSales: {
      label: "销售代表",
      eyebrow: "销售",
      description: "创建与跟进客户报价，处理退回意见",
      symbol: "销",
    },
    roleManager: {
      label: "销售主管",
      eyebrow: "主管",
      description: "查看团队队列，识别折扣风险与待办",
      symbol: "管",
    },
    roleCeo: {
      label: "首席执行官",
      eyebrow: "管理层",
      description: "聚焦高折扣报价与最终审批事项",
      symbol: "审",
    },
    shell: {
      primaryNavigation: "主要导航",
      dashboard: "工作台",
      quoteRecords: "报价记录",
      quoteShort: "报价",
      switchRole: "切换角色",
      openUserMenu: "打开用户菜单",
      reset: "重置演示数据",
      logout: "退出角色",
      demoNotice: "当前为演示环境：客户、楼宇、流量、曝光及人民币价格均为模拟数据。",
      restore: "恢复初始数据",
      mobileNavigation: "移动端导航",
      account: "账户",
      openMobileAccount: "打开移动端账户菜单",
      currentRole: "当前角色",
      mobileRoleSwitcher: "移动端切换角色",
      logoutCurrent: "退出当前角色",
      resetConfirm: "确定将所有报价恢复为初始演示数据吗？",
      logoutConfirm: "确定退出当前角色并返回角色选择吗？",
    },
    dashboard: {
      salesEyebrow: "销售工作台",
      salesTitle: "早上好，{name}",
      salesDescription: "今天的报价进度与待处理事项一目了然。",
      newQuote: "新建报价",
      quoteOverview: "报价概览",
      metricDraft: "草稿",
      metricDraftNote: "继续完善后提交",
      metricReturned: "已退回",
      metricReturnedNote: "需要优先处理",
      metricPending: "审批中",
      metricPendingNote: "等待管理层审批",
      metricApproved: "已批准",
      metricApprovedNote: "可生成正式报价",
      metricAll: "全部报价",
      metricAllNote: "本人报价总数",
      myQuotes: "我的报价",
      myQuotesDescription: "最近更新的客户报价",
      managerEyebrow: "团队审批",
      managerTitle: "{name}，团队队列已更新",
      managerDescription: "优先处理待审批项目，并关注高折扣报价的商业依据。",
      teamOverview: "团队概览",
      metricPendingMine: "待我审批",
      metricPendingMineNote: "当前主管节点",
      metricRisk: "风险报价",
      metricRiskNote: "折扣超过标准区间",
      metricTeam: "团队报价",
      metricTeamNote: "陈晨 · 本月累计",
      teamQueue: "团队报价队列",
      teamQueueDescription: "按风险与更新时间快速定位待办",
      ceoEyebrow: "管理层审批",
      ceoTitle: "{name}，这里是最终审批事项",
      ceoDescription: "仅呈现需要 CEO 决策的高折扣报价，减少无关信息干扰。",
      executiveSummary: "执行摘要",
      finalApprovals: "待最终审批",
      highDiscountQuotes: "份高折扣报价",
      approvedValue: "本期已批准价值",
      approvedQuotes: "份已批准报价",
      taxIncludedSummary: "审批队列已按折扣风险聚焦，所有金额均含税。",
      ceoQueue: "CEO 审批队列",
      ceoQueueDescription: "仅显示已通过销售主管审核的执行级报价",
      approvedQuoteTitle: "已批准报价",
      approvedQuoteDescription: "已完成审批，可查看并打印正式报价",
      quoteCount: "{count} 份",
      emptyTitle: "当前没有待处理报价",
      emptyDescription: "新的报价进入该节点后会显示在这里。",
      quoteCustomer: "报价 / 客户",
      owner: "负责人",
      discount: "折扣",
      taxIncludedTotal: "含税总额",
      status: "状态",
      action: "操作",
      unknownCustomer: "未知客户",
      updatedAt: "{number} · 更新于 {date}",
      viewQuotation: "查看正式报价",
      reviseResubmit: "修改并重新提交",
      continueEditing: "继续编辑",
      viewProgress: "查看进度",
      reviewQuote: "审核报价",
      executiveApproval: "执行审批",
      viewDetails: "查看详情",
    },
    status: {
      draft: "草稿",
      pendingManager: "待主管审批",
      pendingCeo: "待 CEO 审批",
      returned: "已退回",
      approved: "已批准",
    },
    risk: {
      standard: "标准",
      elevated: "关注",
      executive: "高风险",
    },
    modal: {
      close: "关闭弹窗",
      acknowledge: "知道了",
    },
    placeholder: {
      withQuote: "{number} 的“{label}”流程将在后续原型阶段开放。",
      generic: "“{label}”流程将在后续原型阶段开放。",
      resetTitle: "演示数据已重置",
      resetMessage: "所有报价已恢复为初始演示状态。",
    },
  },
};

export type TranslationKey = {
  [Section in keyof Dictionary]: {
    [Key in keyof Dictionary[Section]]: `${Section & string}.${Key & string}`;
  }[keyof Dictionary[Section]];
}[keyof Dictionary];

export type TranslationVariables = Record<string, string | number>;

export function translate(
  locale: Locale,
  key: TranslationKey,
  variables: TranslationVariables = {},
): string {
  const [section, entry] = key.split(".") as [keyof Dictionary, string];
  const template = (translations[locale][section] as Record<string, string>)[entry];

  return template.replace(/\{([\w.-]+)\}/g, (placeholder, variable: string) => (
    Object.prototype.hasOwnProperty.call(variables, variable)
      ? String(variables[variable])
      : placeholder
  ));
}

export function formatMoney(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CNY",
  }).format(value);
}

export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatDate(locale: Locale, value: Date | number | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale).format(date);
}

export function loadLocale(): Locale {
  const storage = getStorage();
  if (!storage) return "en";

  try {
    const stored = storage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : "en";
  } catch {
    return "en";
  }
}

export function saveLocale(locale: Locale): void {
  try {
    getStorage()?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Locale persistence is best-effort when browser storage is unavailable.
  }
}

function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "zh-CN";
}

function getStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
