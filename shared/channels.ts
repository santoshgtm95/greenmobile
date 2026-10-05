/**
 * The IPC allowlist: every channel the renderer may reach, and nothing else.
 *
 * This manifest is the single source of truth for three things that must never
 * drift apart:
 *
 *   electron/ipc/*.ipc.ts   register a handler for each channel
 *   electron/preload.ts     exposes exactly these, and no others
 *   src/lib/api.ts          the typed client the React code calls
 *
 * Adding a capability means adding it here first, which keeps the exposed
 * surface deliberate and reviewable (spec §65).
 */

export const CHANNELS = {
  app: {
    getInfo: 'app:getInfo',
  },
  auth: {
    status: 'auth:status',
    login: 'auth:login',
    logout: 'auth:logout',
    changeOwnPassword: 'auth:changeOwnPassword',
    completeFirstRunSetup: 'auth:completeFirstRunSetup',
  },
  settings: {
    getAll: 'settings:getAll',
    getShop: 'settings:getShop',
    update: 'settings:update',
    chooseLogo: 'settings:chooseLogo',
  },
  products: {
    list: 'products:list',
    get: 'products:get',
    findByCode: 'products:findByCode',
    create: 'products:create',
    update: 'products:update',
    delete: 'products:delete',
    adjustStock: 'products:adjustStock',
  },
  serials: {
    list: 'serials:list',
    findByCode: 'serials:findByCode',
    add: 'serials:add',
    markDefective: 'serials:markDefective',
  },
  categories: {
    list: 'categories:list',
    save: 'categories:save',
  },
  brands: {
    list: 'brands:list',
    save: 'brands:save',
  },
  inventory: {
    history: 'inventory:history',
    lowStock: 'inventory:lowStock',
    summary: 'inventory:summary',
  },
  users: {
    list: 'users:list',
    get: 'users:get',
    create: 'users:create',
    update: 'users:update',
    resetPassword: 'users:resetPassword',
    delete: 'users:delete',
  },
  customers: {
    list: 'customers:list',
    get: 'customers:get',
    create: 'customers:create',
    update: 'customers:update',
    history: 'customers:history',
  },
  expenses: {
    list: 'expenses:list',
    get: 'expenses:get',
    create: 'expenses:create',
    update: 'expenses:update',
    delete: 'expenses:delete',
    summary: 'expenses:summary',
  },
  expenseCategories: {
    list: 'expenseCategories:list',
    save: 'expenseCategories:save',
  },
  banking: {
    overview: 'banking:overview',
    listAccounts: 'banking:listAccounts',
    saveAccount: 'banking:saveAccount',
    deleteAccount: 'banking:deleteAccount',
    listTransactions: 'banking:listTransactions',
    createTransaction: 'banking:createTransaction',
    deleteTransaction: 'banking:deleteTransaction',
    listAdvances: 'banking:listAdvances',
    getAdvance: 'banking:getAdvance',
    openAdvance: 'banking:openAdvance',
    withdrawAdvance: 'banking:withdrawAdvance',
    saveCashCount: 'banking:saveCashCount',
  },
  backup: {
    overview: 'backup:overview',
    create: 'backup:create',
    inspect: 'backup:inspect',
    restore: 'backup:restore',
    delete: 'backup:delete',
    chooseFolder: 'backup:chooseFolder',
    openFolder: 'backup:openFolder',
  },
  data: {
    exportList: 'data:exportList',
    importPreview: 'data:importPreview',
    importCommit: 'data:importCommit',
    importCancel: 'data:importCancel',
    importTemplate: 'data:importTemplate',
  },
  reports: {
    dashboard: 'reports:dashboard',
    sales: 'reports:sales',
    profitAndLoss: 'reports:profitAndLoss',
    build: 'reports:build',
    export: 'reports:export',
    openExportsFolder: 'reports:openExportsFolder',
  },
  services: {
    list: 'services:list',
    get: 'services:get',
    board: 'services:board',
    summary: 'services:summary',
    create: 'services:create',
    update: 'services:update',
    addItem: 'services:addItem',
    removeItem: 'services:removeItem',
    addPayment: 'services:addPayment',
    changeStatus: 'services:changeStatus',
    printDocument: 'services:printDocument',
  },
  print: {
    listPrinters: 'print:listPrinters',
    sale: 'print:sale',
    savePdf: 'print:savePdf',
    openFile: 'print:openFile',
  },
  sales: {
    quote: 'sales:quote',
    create: 'sales:create',
    list: 'sales:list',
    get: 'sales:get',
    cancel: 'sales:cancel',
    refund: 'sales:refund',
  },
} as const satisfies Record<string, Record<string, string>>;

export type ChannelManifest = typeof CHANNELS;
export type Namespace = keyof ChannelManifest;

/** Flat list of channel strings, for the security review and for tests. */
export function allChannels(): string[] {
  return Object.values(CHANNELS)
    .flatMap((namespace) => Object.values(namespace))
    .sort();
}
