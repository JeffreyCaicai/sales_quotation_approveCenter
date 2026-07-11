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
  validation: {
    customerRequired: string;
    brandRequired: string;
    placementModeRequired: string;
    placementRequired: string;
    weeksPositiveInteger: string;
    spotsPositiveInteger: string;
    bonusNonnegativeInteger: string;
    discountRange: string;
    basePriceFiniteNonnegative: string;
    taxRateFiniteNonnegative: string;
    trafficNonnegativeInteger: string;
    impressionsNonnegativeInteger: string;
    customerOwned: string;
    brandBelongsToCustomer: string;
    resourceModeMismatch: string;
    basePriceMismatch: string;
    returnReasonRequired: string;
  };
  wizard: {
    back: string;
    eyebrow: string;
    newTitle: string;
    editTitle: string;
    description: string;
    saveDraft: string;
    stepsLabel: string;
    stepProgress: string;
    stepCustomer: string;
    stepMode: string;
    stepResources: string;
    stepParameters: string;
    stepDiscount: string;
    stepReview: string;
    customerTitle: string;
    customerHelp: string;
    modeTitle: string;
    modeHelp: string;
    resourcesTitle: string;
    resourcesHelp: string;
    parametersTitle: string;
    parametersHelp: string;
    discountTitle: string;
    discountStepHelp: string;
    reviewTitle: string;
    reviewHelp: string;
    customer: string;
    brand: string;
    selectBrand: string;
    selectCustomerFirst: string;
    placementMode: string;
    buildingMode: string;
    buildingModeDescription: string;
    buildingModeMeta: string;
    packageMode: string;
    packageModeDescription: string;
    packageModeMeta: string;
    chooseModeFirst: string;
    resources: string;
    searchBuildings: string;
    searchPlaceholder: string;
    packageComparison: string;
    fourWeekRateCard: string;
    dailyTraffic: string;
    monthlyImpressions: string;
    fourWeeksSuffix: string;
    noBuildings: string;
    weeks: string;
    spots: string;
    bonus: string;
    weekUnit: string;
    occurrenceUnit: string;
    calculationNote: string;
    calculationHelp: string;
    customerDiscount: string;
    discountHelp: string;
    currentApprovalPath: string;
    approvalManager: string;
    approvalElevated: string;
    approvalExecutive: string;
    approvalStandardHelp: string;
    approvalElevatedHelp: string;
    approvalExecutiveHelp: string;
    completeInformation: string;
    parameters: string;
    approvalPath: string;
    notSelected: string;
    reviewNotice: string;
    cancel: string;
    previous: string;
    next: string;
    resubmit: string;
    submitManager: string;
    liveSummary: string;
    livePricing: string;
    demo: string;
    basePrice: string;
    discountDeduction: string;
    netPrice: string;
    simulatedTax: string;
    totalWithTax: string;
    demoNotice: string;
  };
  approval: {
    back: string;
    eyebrow: string;
    title: string;
    version: string;
    clientAndBrand: string;
    commercialSubject: string;
    customer: string;
    brand: string;
    owner: string;
    parameters: string;
    unknownBrand: string;
    resources: string;
    versionAndHistory: string;
    versionHelp: string;
    discountRisk: string;
    riskStandard: string;
    riskElevated: string;
    riskExecutive: string;
    pricingSummary: string;
    calculationDetails: string;
    basePrice: string;
    discountDeduction: string;
    netPrice: string;
    simulatedTax: string;
    totalWithTax: string;
    demoNotice: string;
    actions: string;
    approve: string;
    return: string;
    readOnly: string;
    returnTitle: string;
    approveTitle: string;
    close: string;
    returnReason: string;
    required: string;
    returnPlaceholder: string;
    returnHelp: string;
    approveToCeo: string;
    approveFinal: string;
    approvalRecordNotice: string;
    cancel: string;
    confirmReturn: string;
    confirmApprove: string;
    actionSubmitted: string;
    actionResubmitted: string;
    actionApproved: string;
    actionReturned: string;
    roleSales: string;
    roleManager: string;
    roleCeo: string;
  };
  progress: {
    eyebrow: string;
    title: string;
    currentVersion: string;
    readOnly: string;
    salesActionNeeded: string;
    priorReturn: string;
    latestReturnReason: string;
    currentProgress: string;
    waitingCeo: string;
    waitingManager: string;
    approved: string;
    readOnlyHelp: string;
    editHelp: string;
    reviseResubmit: string;
    backToWorkspace: string;
    backToQuotation: string;
  };
  history: {
    empty: string;
    versionHistory: string;
    immutableHelp: string;
    versionCount: string;
    commercialSnapshot: string;
    commercialSummary: string;
    clientBrand: string;
    resources: string;
    buildingMode: string;
    packageMode: string;
    parameters: string;
    audienceMetrics: string;
    dailyTraffic: string;
    monthlyImpressions: string;
    discount: string;
    netPrice: string;
    totalWithTax: string;
    approvalTimeline: string;
  };
  quotation: {
    toolbar: string;
    back: string;
    viewHistory: string;
    print: string;
    restrictedEyebrow: string;
    restrictedTitle: string;
    restrictedHelp: string;
    workspace: string;
    formalDocument: string;
    title: string;
    subtitle: string;
    reference: string;
    quoteNumber: string;
    issueDate: string;
    version: string;
    currency: string;
    currencyIdr: string;
    clientAndBrand: string;
    customer: string;
    brand: string;
    salesOwner: string;
    campaignPeriod: string;
    periodValue: string;
    resourcesAndItems: string;
    item: string;
    typeRegion: string;
    period: string;
    campaignAmount: string;
    building: string;
    package: string;
    deliveryMetrics: string;
    dailyTraffic: string;
    monthlyImpressions: string;
    occurrenceUnit: string;
    priceDetails: string;
    basePrice: string;
    discountDeduction: string;
    netPrice: string;
    simulatedTax: string;
    totalWithTax: string;
    terms: string;
    termValidity: string;
    termRateCard: string;
    termCurrencyTax: string;
    termDemo: string;
    appendix: string;
    buildingColumn: string;
    regionType: string;
    approvalRecord: string;
    approvalAction: string;
    approver: string;
    timeComment: string;
    approved: string;
    approvedNotice: string;
    demoFooter: string;
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
  commercial: {
    spot: string;
    bonus: string;
    rateCard: string;
  };
  modal: {
    close: string;
    acknowledge: string;
  };
  outcome: {
    draftSavedTitle: string;
    returnedDraftSavedMessage: string;
    draftSavedMessage: string;
    resubmittedTitle: string;
    submittedTitle: string;
    submittedMessage: string;
    sentToCeoTitle: string;
    approvedTitle: string;
    sentToCeoMessage: string;
    approvedMessage: string;
    returnedTitle: string;
    returnedMessage: string;
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
      demoNotice: "Demo environment: customers, buildings, traffic, impressions, and IDR prices are sample data. Demo conversion: CNY 1 = IDR 2,662.",
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
      metricTeamNote: "{name} · This month",
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
    validation: {
      customerRequired: "Select a customer.", brandRequired: "Select a brand.", placementModeRequired: "Select a placement mode.",
      placementRequired: "Select at least one building or one sales package.", weeksPositiveInteger: "Campaign weeks must be a positive integer.",
      spotsPositiveInteger: "Spot quantity must be a positive integer.", bonusNonnegativeInteger: "Bonus must be a nonnegative integer.",
      discountRange: "Discount must be between 0% and 100%.", basePriceFiniteNonnegative: "Base price must be a finite nonnegative number.",
      taxRateFiniteNonnegative: "The simulated tax rate must be a finite nonnegative number.", trafficNonnegativeInteger: "Daily traffic must be a nonnegative integer.",
      impressionsNonnegativeInteger: "Monthly impressions must be a nonnegative integer.", customerOwned: "Select a customer assigned to the current salesperson.",
      brandBelongsToCustomer: "Select a brand belonging to this customer.", resourceModeMismatch: "The selected resources do not match the placement mode.",
      basePriceMismatch: "The base price does not match the selected resources.", returnReasonRequired: "Enter a reason for returning the quotation.",
    },
    wizard: {
      back: "Back to dashboard", eyebrow: "Quotation Builder", newTitle: "New quotation", editTitle: "Edit quotation",
      description: "Complete the customer, resource, and commercial terms step by step.", saveDraft: "Save draft", stepsLabel: "Quotation creation steps",
      stepProgress: "Step {current} of {total}", stepCustomer: "Customer & brand", stepMode: "Placement mode", stepResources: "Resources",
      stepParameters: "Campaign parameters", stepDiscount: "Discount approval", stepReview: "Review & submit",
      customerTitle: "Select customer and brand", customerHelp: "Only customers assigned to the current Sales PIC are shown.",
      modeTitle: "Select placement mode", modeHelp: "Combine individual buildings or use a predefined sales package.",
      resourcesTitle: "Select placement resources", resourcesHelp: "Rate Card, traffic, and impressions are prototype sample data.",
      parametersTitle: "Set campaign parameters", parametersHelp: "The base price scales proportionally from the four-week Rate Card.",
      discountTitle: "Set discount", discountStepHelp: "The approval path updates as the discount changes.",
      reviewTitle: "Review and submit", reviewHelp: "Every quotation goes to the Sales Manager first.", customer: "Customer", brand: "Brand",
      selectBrand: "Select a brand", selectCustomerFirst: "Select a customer first", placementMode: "Placement mode",
      buildingMode: "Choose buildings", buildingModeDescription: "Select buildings individually for the customer's target audience.", buildingModeMeta: "Flexible · Multiple selection",
      packageMode: "Predefined sales package", packageModeDescription: "Compare configured area mixes and audience reach.", packageModeMeta: "Fast quote · Single selection",
      chooseModeFirst: "Return to the previous step and select a placement mode.", resources: "Placement resources", searchBuildings: "Search buildings",
      searchPlaceholder: "Search by building name, area, or type", packageComparison: "Compare sales packages", fourWeekRateCard: "Prices are four-week Rate Card values",
      dailyTraffic: "Daily traffic", monthlyImpressions: "Monthly impressions", fourWeeksSuffix: " / 4 weeks", noBuildings: "No matching buildings. Adjust your search.",
      weeks: "Campaign period", spots: "Spot quantity", bonus: "Bonus", weekUnit: "weeks", occurrenceUnit: "times", calculationNote: "Calculation note",
      calculationHelp: "Rate Card uses a four-week pricing unit. Spot and Bonus confirm scheduling and do not change the sample base price.",
      customerDiscount: "Customer discount", discountHelp: "Enter 0–100; the value is the percentage deducted from Rate Card.", currentApprovalPath: "Current approval path",
      approvalManager: "Sales Manager approval", approvalElevated: "Elevated discount · Sales Manager approval", approvalExecutive: "Sales Manager → CEO",
      approvalStandardHelp: "After submission, the Sales Manager can complete approval.", approvalElevatedHelp: "Confirm the business rationale before submitting this elevated discount.",
      approvalExecutiveHelp: "Above 70%, the quotation goes to the CEO after Sales Manager approval.", completeInformation: "Complete the following information first",
      parameters: "Campaign parameters", approvalPath: "Approval path", notSelected: "Not selected", reviewNotice: "Submission locks this version and sends it to the Sales Manager. Discounts above 70% then proceed to the CEO.",
      cancel: "Cancel", previous: "Previous", next: "Next", resubmit: "Resubmit for approval", submitManager: "Submit to Sales Manager",
      liveSummary: "Live quotation summary", livePricing: "Live pricing", demo: "Sample", basePrice: "Rate Card base price",
      discountDeduction: "Discount ({discount}%)", netPrice: "Net price after discount", simulatedTax: "Simulated tax ({tax}%)", totalWithTax: "Total incl. tax",
      demoNotice: "IDR prices, traffic, impressions, and the 6% tax rate are sample values.",
    },
    approval: {
      back: "Back to dashboard", eyebrow: "Approval Review", title: "Quotation approval details", version: "Version V{version}",
      clientAndBrand: "Customer & brand", commercialSubject: "Commercial quotation party", customer: "Customer", brand: "Brand", owner: "Owner",
      parameters: "Campaign parameters", unknownBrand: "Unknown brand", resources: "Placement resources", versionAndHistory: "Versions & approval record",
      versionHelp: "Review locked commercial snapshots and the approval timeline by version.", discountRisk: "Discount risk",
      riskStandard: "Within the standard discount range; the Sales Manager can complete approval.",
      riskElevated: "Above the standard range. Review the business rationale; the Sales Manager can complete approval.",
      riskExecutive: "Above 70%; final CEO approval is required after the Sales Manager.", pricingSummary: "Pricing Summary", calculationDetails: "Calculation details",
      basePrice: "Rate Card original price", discountDeduction: "Discount deduction ({discount}%)", netPrice: "Net price after discount",
      simulatedTax: "Simulated tax ({tax}%)", totalWithTax: "Total incl. tax", demoNotice: "IDR amounts and the tax rate are prototype sample data.",
      actions: "Approval actions", approve: "Approve quotation", return: "Return for revision", readOnly: "This quotation is not at your approval stage and is read-only.",
      returnTitle: "Return quotation for revision", approveTitle: "Confirm quotation approval", close: "Close dialog", returnReason: "Reason for return", required: "Required",
      returnPlaceholder: "Explain what Sales needs to revise or add", returnHelp: "This reason will be recorded in the approval timeline and shared with Sales.",
      approveToCeo: "send it to the CEO for final approval", approveFinal: "complete final approval for this version", approvalRecordNotice: "Approval will {outcome}. This action is recorded in the approval history.",
      cancel: "Cancel", confirmReturn: "Confirm return", confirmApprove: "Confirm approval", actionSubmitted: "Submitted for approval", actionResubmitted: "Resubmitted",
      actionApproved: "Quotation approved", actionReturned: "Returned for revision", roleSales: "Sales", roleManager: "Sales Manager", roleCeo: "CEO",
    },
    progress: {
      eyebrow: "Quote Progress", title: "Quotation progress & versions", currentVersion: "Current V{version}", readOnly: "Read-only details",
      salesActionNeeded: "Sales action required", priorReturn: "Previous return feedback", latestReturnReason: "Latest return reason", currentProgress: "Current approval progress",
      waitingCeo: "Awaiting final CEO approval", waitingManager: "Awaiting Sales Manager approval", approved: "Quotation approved", readOnlyHelp: "The quotation is in a read-only approval flow. Locked commercial terms and every approval event appear below.",
      editHelp: "Review the return feedback and original version terms before editing.", reviseResubmit: "Revise and resubmit", backToWorkspace: "Back to dashboard", backToQuotation: "Back to formal Quotation",
    },
    history: {
      empty: "This draft has not been submitted, so there is no locked version history.", versionHistory: "Version history",
      immutableHelp: "Each submission locks a commercial snapshot; later edits never overwrite earlier versions.", versionCount: "{count} versions",
      commercialSnapshot: "Commercial Snapshot", commercialSummary: "V{version} commercial summary", clientBrand: "Customer / Brand", resources: "Placement resources",
      buildingMode: "Selected buildings", packageMode: "Sales package", parameters: "Campaign parameters", audienceMetrics: "Audience metrics",
      dailyTraffic: "{value} daily traffic", monthlyImpressions: "{value} monthly impressions", discount: "Discount", netPrice: "Net price {amount}",
      totalWithTax: "Total incl. tax", approvalTimeline: "Approval timeline",
    },
    quotation: {
      toolbar: "Formal quotation actions", back: "Back to dashboard", viewHistory: "View version history", print: "Print / Export PDF",
      restrictedEyebrow: "Approval is not complete", restrictedTitle: "Formal quotation unavailable", restrictedHelp: "Only approved quotations can generate, display, or print the formal Quotation.",
      workspace: "QUOTATION WORKSPACE", formalDocument: "Formal commercial document · Sample data", title: "QUOTATION", subtitle: "Quotation",
      reference: "Quotation information", quoteNumber: "Quotation number", issueDate: "Issue date", version: "Quotation version", currency: "Currency", currencyIdr: "IDR · Indonesian rupiah",
      clientAndBrand: "Customer & brand", customer: "Customer", brand: "Brand", salesOwner: "Sales owner", campaignPeriod: "Campaign period", periodValue: "{weeks} consecutive weeks from schedule confirmation",
      resourcesAndItems: "Placement resources & quotation items", item: "Item", typeRegion: "Type / Area", period: "Period", campaignAmount: "Campaign amount", building: "Building", package: "Sales package",
      deliveryMetrics: "Delivery and audience metrics", dailyTraffic: "Daily traffic", monthlyImpressions: "Monthly impressions", occurrenceUnit: "times",
      priceDetails: "Price details", basePrice: "Rate Card base price", discountDeduction: "Discount deduction ({discount}%)", netPrice: "Net price after discount",
      simulatedTax: "Simulated tax ({tax}%)", totalWithTax: "Total incl. tax", terms: "Quotation terms",
      termValidity: "This quotation is valid for 15 calendar days from its issue date. Final scheduling is subject to written confirmation by both parties.",
      termRateCard: "Rate Card uses a four-week pricing unit; Spot and Bonus confirm scheduling.", termCurrencyTax: "All amounts are in IDR and include {tax}% simulated tax. Demo conversion: CNY 1 = IDR 2,662.",
      termDemo: "Customers, buildings, traffic, impressions, prices, and tax rates in this document are sample data.", appendix: "Building detail appendix", buildingColumn: "Building", regionType: "Area / Type",
      approvalRecord: "Approval record", approvalAction: "Approval action", approver: "Approver", timeComment: "Time / Comment", approved: "APPROVED",
      approvedNotice: "This quotation has completed all required approvals.", demoFooter: "Quotation Approval Center · Sample data",
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
    commercial: {
      spot: "Spot",
      bonus: "Bonus",
      rateCard: "Rate Card",
    },
    modal: {
      close: "Close dialog",
      acknowledge: "Got it",
    },
    outcome: {
      draftSavedTitle: "Draft saved",
      returnedDraftSavedMessage: "Changes to {number} were saved. You can continue editing before resubmitting.",
      draftSavedMessage: "{number} was saved to My quotations.",
      resubmittedTitle: "Quotation resubmitted",
      submittedTitle: "Quotation submitted",
      submittedMessage: "{number} is awaiting Sales Manager approval.",
      sentToCeoTitle: "Sent for CEO approval",
      approvedTitle: "Quotation approved",
      sentToCeoMessage: "{number} passed Sales Manager review and is now awaiting final CEO approval.",
      approvedMessage: "{number} received final approval.",
      returnedTitle: "Quotation returned",
      returnedMessage: "{number} was returned to Sales for revision, and the reason was added to the approval record.",
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
      demoNotice: "当前为演示环境：客户、楼宇、流量、曝光及印尼盾价格均为模拟数据。演示换算率：1 人民币 = 2,662 印尼盾。",
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
      metricTeamNote: "{name} · 本月累计",
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
    validation: {
      customerRequired: "请选择客户", brandRequired: "请选择品牌", placementModeRequired: "请选择投放方式", placementRequired: "请至少选择一栋楼宇或一个销售包",
      weeksPositiveInteger: "投放周期必须为正整数", spotsPositiveInteger: "Spot 数量必须为正整数", bonusNonnegativeInteger: "Bonus 必须为非负整数",
      discountRange: "折扣必须在 0%–100% 之间", basePriceFiniteNonnegative: "报价基础价格必须为有限非负数", taxRateFiniteNonnegative: "模拟税率必须为有限非负数",
      trafficNonnegativeInteger: "日均流量必须为非负整数", impressionsNonnegativeInteger: "月曝光必须为非负整数", customerOwned: "请选择当前销售负责的客户",
      brandBelongsToCustomer: "请选择该客户旗下的品牌", resourceModeMismatch: "所选资源与投放方式不匹配", basePriceMismatch: "报价基础价格与所选资源不一致",
      returnReasonRequired: "请填写退回原因",
    },
    wizard: {
      back: "返回工作台", eyebrow: "报价创建", newTitle: "新建报价", editTitle: "编辑报价", description: "按步骤完成客户、资源与商业条件配置。", saveDraft: "保存草稿",
      stepsLabel: "报价创建步骤", stepProgress: "步骤 {current} / {total}", stepCustomer: "客户与品牌", stepMode: "投放方式", stepResources: "资源选择", stepParameters: "投放参数",
      stepDiscount: "折扣审批", stepReview: "确认提交", customerTitle: "选择客户与品牌", customerHelp: "仅显示当前 Sales PIC 负责的客户。", modeTitle: "选择投放方式",
      modeHelp: "按单栋楼宇灵活组合，或使用预设销售包。", resourcesTitle: "选择投放资源", resourcesHelp: "Rate Card、流量和曝光均为原型模拟数据。",
      parametersTitle: "设置投放参数", parametersHelp: "基础价格按四周 Rate Card 随周期等比例计算。", discountTitle: "设置折扣", discountStepHelp: "审批路径会随折扣实时变化。",
      reviewTitle: "确认并提交", reviewHelp: "核对信息后提交；所有报价均先进入销售主管审批。", customer: "客户", brand: "品牌", selectBrand: "请选择品牌",
      selectCustomerFirst: "请先选择客户", placementMode: "投放方式", buildingMode: "定点挑楼", buildingModeDescription: "按客户目标逐栋选择，可组合多个楼宇。", buildingModeMeta: "灵活配置 · 多选",
      packageMode: "预设销售包", packageModeDescription: "比较已配置的区域组合与人群覆盖。", packageModeMeta: "快速报价 · 单选", chooseModeFirst: "请返回上一步选择投放方式。",
      resources: "投放资源", searchBuildings: "搜索楼宇", searchPlaceholder: "搜索楼宇名称、区域或类型", packageComparison: "销售包对比", fourWeekRateCard: "价格均为四周 Rate Card",
      dailyTraffic: "日均流量", monthlyImpressions: "月曝光", fourWeeksSuffix: " / 4 周", noBuildings: "没有匹配的楼宇，请调整搜索关键词。", weeks: "投放周期", spots: "Spot 数量",
      bonus: "Bonus", weekUnit: "周", occurrenceUnit: "次", calculationNote: "计算说明", calculationHelp: "Rate Card 以 4 周为计价单位；Spot 与 Bonus 用于排期确认，暂不改变模拟基础价格。",
      customerDiscount: "客户折扣", discountHelp: "输入 0–100，数值表示从 Rate Card 扣减的比例。", currentApprovalPath: "当前审批路径", approvalManager: "销售主管审批",
      approvalElevated: "较高折扣 · 销售主管审批", approvalExecutive: "销售主管 → CEO", approvalStandardHelp: "报价提交后由销售主管完成审批。",
      approvalElevatedHelp: "折扣处于关注区间，请在提交前确认商业依据。", approvalExecutiveHelp: "折扣高于 70%，销售主管通过后将进入 CEO 最终审批。",
      completeInformation: "请先完善以下信息", parameters: "投放参数", approvalPath: "审批路径", notSelected: "未选择", reviewNotice: "提交后报价将锁定当前版本并进入销售主管审批。高于 70% 的折扣经主管通过后再流转 CEO。",
      cancel: "取消", previous: "上一步", next: "下一步", resubmit: "重新提交审批", submitManager: "提交销售主管审批", liveSummary: "实时报价摘要", livePricing: "实时价格",
      demo: "模拟", basePrice: "Rate Card 基础价", discountDeduction: "折扣（{discount}%）", netPrice: "折后净价", simulatedTax: "模拟税费（{tax}%）", totalWithTax: "含税总额",
      demoNotice: "印尼盾价格、流量、曝光与 6% 税率均为演示模拟值。",
    },
    approval: {
      back: "返回工作台", eyebrow: "审批审核", title: "报价审批详情", version: "版本 V{version}", clientAndBrand: "客户与品牌", commercialSubject: "本次商业报价主体", customer: "客户",
      brand: "品牌", owner: "负责人", parameters: "投放参数", unknownBrand: "未知品牌", resources: "投放资源", versionAndHistory: "版本与审批记录", versionHelp: "按版本核对商业快照与审批时间线",
      discountRisk: "折扣风险", riskStandard: "处于标准折扣区间，主管可完成最终审批。", riskElevated: "高于标准区间，请重点核对商业依据；主管可最终批准。",
      riskExecutive: "高于 70%，主管批准后仍需 CEO 最终审批。", pricingSummary: "价格摘要", calculationDetails: "计算明细", basePrice: "Rate Card 原价",
      discountDeduction: "折扣减免 ({discount}%)", netPrice: "折后净价", simulatedTax: "模拟税费 ({tax}%)", totalWithTax: "含税总额", demoNotice: "印尼盾金额与税率均为原型模拟数据。",
      actions: "审批操作", approve: "批准报价", return: "退回修改", readOnly: "当前报价不在你的审批节点，仅供查看。", returnTitle: "退回报价修改", approveTitle: "确认批准报价",
      close: "关闭弹窗", returnReason: "退回原因", required: "必填", returnPlaceholder: "说明需要销售修改或补充的内容", returnHelp: "该原因会写入审批时间线并同步给销售。",
      approveToCeo: "流转至 CEO 最终审批", approveFinal: "完成本版本的最终审批", approvalRecordNotice: "批准后将{outcome}。此操作会写入审批记录。", cancel: "取消",
      confirmReturn: "确认退回", confirmApprove: "确认批准", actionSubmitted: "提交审批", actionResubmitted: "重新提交", actionApproved: "批准报价", actionReturned: "退回修改",
      roleSales: "销售", roleManager: "销售主管", roleCeo: "CEO",
    },
    progress: {
      eyebrow: "报价进度", title: "报价进度与版本", currentVersion: "当前 V{version}", readOnly: "只读详情", salesActionNeeded: "需要销售处理", priorReturn: "上一轮退回意见",
      latestReturnReason: "最新退回原因", currentProgress: "当前审批进度", waitingCeo: "等待 CEO 最终审批", waitingManager: "等待销售主管审批", approved: "报价已批准",
      readOnlyHelp: "报价当前处于只读审批流程。下方记录展示已锁定的商业条件与全部审批事件。", editHelp: "请先确认退回意见与原版本条件，再进入编辑流程。",
      reviseResubmit: "修改并重新提交", backToWorkspace: "返回工作台", backToQuotation: "返回正式报价",
    },
    history: {
      empty: "该草稿尚未提交，暂无锁定版本记录。", versionHistory: "版本记录", immutableHelp: "每次提交锁定一份商业快照，后续修改不会覆盖旧版本。",
      versionCount: "{count} 个版本", commercialSnapshot: "商业快照", commercialSummary: "V{version} 商业摘要", clientBrand: "客户 / 品牌", resources: "投放资源",
      buildingMode: "定点挑楼", packageMode: "销售包", parameters: "投放参数", audienceMetrics: "受众指标", dailyTraffic: "{value} 日均流量",
      monthlyImpressions: "{value} 月曝光", discount: "折扣", netPrice: "折后净价 {amount}", totalWithTax: "含税总额", approvalTimeline: "审批时间线",
    },
    quotation: {
      toolbar: "正式报价操作", back: "返回工作台", viewHistory: "查看版本记录", print: "打印 / 导出 PDF", restrictedEyebrow: "报价尚未完成审批",
      restrictedTitle: "正式报价暂不可用", restrictedHelp: "只有状态为“已批准”的报价可以生成、查看或打印正式 Quotation。", workspace: "报价工作台",
      formalDocument: "正式商业文件 · 模拟数据", title: "QUOTATION", subtitle: "报价单", reference: "报价信息", quoteNumber: "报价编号", issueDate: "报价日期",
      version: "报价版本", currency: "币种", currencyIdr: "印尼盾 IDR", clientAndBrand: "客户与品牌", customer: "客户", brand: "品牌", salesOwner: "销售负责人",
      campaignPeriod: "投放周期", periodValue: "自排期确认日起连续 {weeks} 周", resourcesAndItems: "投放资源与报价项目", item: "项目", typeRegion: "类型 / 区域", period: "周期",
      campaignAmount: "投放金额", building: "楼宇", package: "销售包", deliveryMetrics: "投放与受众指标", dailyTraffic: "日均流量", monthlyImpressions: "月曝光", occurrenceUnit: "次",
      priceDetails: "价格明细", basePrice: "Rate Card 基础价", discountDeduction: "折扣减免（{discount}%）", netPrice: "折后净价", simulatedTax: "模拟税费（{tax}%）",
      totalWithTax: "含税总额", terms: "报价条款", termValidity: "本报价自报价日期起 15 个自然日内有效，最终排期以双方书面确认为准。",
      termRateCard: "Rate Card 以 4 周为计价单位；Spot 与 Bonus 用于排期确认。", termCurrencyTax: "所有金额均以印尼盾计价，并包含 {tax}% 模拟税费。演示换算率：1 人民币 = 2,662 印尼盾。",
      termDemo: "本文件中的客户、楼宇、流量、曝光、价格与税率均为演示模拟数据。", appendix: "楼宇明细附录", buildingColumn: "楼宇", regionType: "区域 / 类型",
      approvalRecord: "审批记录", approvalAction: "审批动作", approver: "审批人", timeComment: "时间 / 意见", approved: "APPROVED", approvedNotice: "本报价已完成所需审批流程",
      demoFooter: "报价审批中心 · 模拟数据",
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
    commercial: {
      spot: "Spot",
      bonus: "Bonus",
      rateCard: "Rate Card",
    },
    modal: {
      close: "关闭弹窗",
      acknowledge: "知道了",
    },
    outcome: {
      draftSavedTitle: "草稿已保存",
      returnedDraftSavedMessage: "{number} 的修改已保存，可继续完善后重新提交。",
      draftSavedMessage: "{number} 已保存到“我的报价”。",
      resubmittedTitle: "报价已重新提交",
      submittedTitle: "报价已提交",
      submittedMessage: "{number} 已进入销售主管审批。",
      sentToCeoTitle: "已提交 CEO 审批",
      approvedTitle: "报价已批准",
      sentToCeoMessage: "{number} 已完成主管审批，现进入 CEO 最终审批。",
      approvedMessage: "{number} 已完成最终审批。",
      returnedTitle: "报价已退回",
      returnedMessage: "{number} 已退回销售修改，原因已写入审批记录。",
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
  return new Intl.NumberFormat(locale === "en" ? "en-ID" : locale, {
    style: "currency",
    currency: "IDR",
    currencyDisplay: "symbol",
    maximumFractionDigits: 0,
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
