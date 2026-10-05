/**
 * The complete contract between the React renderer and the Electron main
 * process. This is the single source of truth for both sides:
 *
 *   electron/preload.ts   exposes the channels in shared/channels.ts
 *   src/lib/api.ts        implements this interface over them
 *
 * Adding a capability means adding it to shared/channels.ts and here, which
 * keeps the exposed surface deliberate and reviewable.
 */
import type {
  BankAdvanceRole,
  BankAdvanceStatus,
  BankFeeDirection,
  BankTransactionType,
  Permission,
  SerialStatus,
  ServiceItemType,
  ServiceStatus,
  UserRole,
} from './domain';
import type { SettingKey, ShopSettings } from './settings';
import type { ExportFormat, Report, ReportKind } from './report';
import type {
  BackupFile,
  BackupInspection,
  BackupOverview,
  RestoreResult,
} from './backup';
import type { ImportPreview, ImportResult } from './import';
import type {
  AddSerialsInput,
  AdjustStockInput,
  CancelSaleInput,
  CreateExpenseInput,
  DayRangeInput,
  DeleteExpenseInput,
  ExpenseListQuery,
  UpdateExpenseInput,
  BankTransactionListQuery,
  BankAdvanceListQueryInput,
  CreateBankTransactionInput,
  DeleteBankTransactionInput,
  OpenBankAdvanceInput,
  WithdrawBankAdvanceInput,
  SaveBankAccountInput,
  SaveCashCountInput,
  AddServiceItemInput,
  AddServicePaymentInput,
  ChangeServiceStatusInput,
  CreateServiceOrderInput,
  ServiceListQuery,
  UpdateServiceOrderInput,
  ChangeOwnPasswordInput,
  CreateCustomerInput,
  CreateUserInput,
  UpdateUserInput,
  ResetPasswordInput,
  CreateProductInput,
  CreateSaleInput,
  CustomerListQuery,
  FirstRunSetupInput,
  InventoryQueryInput,
  LoginInput,
  LookupQueryInput,
  MarkSerialDefectiveInput,
  ProductListQuery,
  RefundSaleInput,
  SaleListQuery,
  SaveLookupInput,
  UpdateCustomerInput,
  UpdateProductInput,
  UpdateSettingsInput,
} from './validation';

// -----------------------------------------------------------------------------
// Shapes returned across the bridge
// -----------------------------------------------------------------------------

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
}

export interface AuthStatus {
  user: SessionUser | null;
  permissions: Permission[];
  /** True until the first-run wizard has created an administrator. */
  requiresFirstRunSetup: boolean;
}

export interface AppInfo {
  version: string;
  isPackaged: boolean;
  userDataDir: string;
  databaseFile: string;
  schemaVersion: number;
  requiresFirstRunSetup: boolean;
}

/** Booleans arrive as SQLite 0/1. */
export type SqliteBool = 0 | 1;

export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  /** Minor units. */
  purchasePrice: number;
  sellingPrice: number;
  /** Basis points. */
  taxRate: number;
  taxRateOverride: SqliteBool;
  stockQuantity: number;
  minimumStock: number;
  unit: string;
  isSerialized: SqliteBool;
  warrantyMonths: number;
  isActive: SqliteBool;
  availableSerials: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductSerial {
  id: string;
  productId: string;
  serialNumber: string | null;
  imei1: string | null;
  imei2: string | null;
  purchasePrice: number;
  sellingPrice: number | null;
  status: SerialStatus;
  warrantyStartDate: string | null;
  warrantyEndDate: string | null;
  notes: string | null;
}

export interface Lookup {
  id: string;
  name: string;
  description: string | null;
  isActive: SqliteBool;
  productCount: number;
}

export interface StaffUser {
  id: string;
  username: string;
  fullName: string;
  phone: string | null;
  role: UserRole;
  isActive: SqliteBool;
  lastLoginAt: string | null;
  createdAt: string;
  /** Sales rung up by this account. */
  salesCount: number;
  /** Repair jobs taken in by this account. */
  serviceCount: number;
}

export interface Customer {
  id: string;
  customerCode: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: SqliteBool;
  totalOrders: number;
  totalSpent: number;
  lastPurchaseAt: string | null;
  createdAt: string;
}

export interface Sale {
  id: string;
  invoiceNumber: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  saleDate: string;
  saleDay: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  grandTotal: number;
  amountPaid: number;
  changeAmount: number;
  costTotal: number;
  refundedAmount: number;
  paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
  status: 'COMPLETED' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  notes: string | null;
  createdBy: string;
  cashierName: string | null;
  createdAt: string;
}

export interface SaleItem {
  id: string;
  saleId: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  returnedQuantity: number;
  /** Comma-separated IMEIs / serials sold on this line. */
  serials: string | null;
}

export interface SalePayment {
  id: string;
  amount: number;
  paymentMethod: string;
  referenceNumber: string | null;
  paymentDate: string;
  notes: string | null;
}

export interface SaleDetail {
  sale: Sale;
  items: SaleItem[];
  payments: SalePayment[];
}

/** Authoritative running total for the cart, computed by the main process. */
export interface SaleQuote {
  lines: Array<{
    productId: string;
    productSerialId: string | null;
    productName: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    discountAmount: number;
    taxAmount: number;
    totalAmount: number;
  }>;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  grandTotal: number;
}

export interface InventoryMovement {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  transactionType: string;
  quantity: number;
  previousStock: number;
  newStock: number;
  unitCost: number;
  referenceType: string | null;
  referenceId: string | null;
  reason: string;
  createdAt: string;
  createdByName: string | null;
}

export interface StockSummary {
  products: number;
  productsInStock: number;
  unitsHeld: number;
  /** Minor units. */
  stockValueAtCost: number;
  potentialRevenue: number;
  lowStockCount: number;
  outOfStockCount: number;
  availableSerials: number;
}

export interface LowStockItem {
  id: string;
  sku: string;
  name: string;
  stockQuantity: number;
  minimumStock: number;
  categoryName: string | null;
}

export interface CustomerPurchase {
  saleId: string;
  invoiceNumber: string;
  saleDate: string;
  saleDay: string;
  grandTotal: number;
  refundedAmount: number;
  status: string;
  paymentStatus: string;
  itemCount: number;
  productSummary: string;
  serials: string | null;
  paymentMethods: string | null;
}

export interface CustomerServiceJob {
  id: string;
  serviceNumber: string;
  deviceBrand: string;
  deviceModel: string;
  imei: string | null;
  status: string;
  finalCost: number;
  receivedDate: string;
  completedDate: string | null;
}

export interface Expense {
  id: string;
  expenseNumber: string;
  categoryId: string;
  categoryName: string;
  expenseDate: string;
  expenseDay: string;
  description: string;
  /** Minor units. */
  amount: number;
  paymentMethod: string;
  referenceNumber: string | null;
  notes: string | null;
  isDeleted: SqliteBool;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  description: string | null;
  isActive: SqliteBool;
  expenseCount: number;
  totalAmount: number;
}

export interface ExpenseSummary {
  total: number;
  count: number;
  byCategory: Array<{ categoryId: string; categoryName: string; total: number; count: number }>;
  byDay: Array<{ day: string; total: number }>;
  byPaymentMethod: Array<{ paymentMethod: string; total: number; count: number }>;
}

export interface BankAccount {
  id: string;
  name: string;
  /** Short handle, e.g. "Kpay". Never changes once the account exists. */
  key: string;
  description: string | null;
  isActive: SqliteBool;
  /** Movements recorded against this account, deleted ones excluded. */
  transactionCount: number;
  /** True while the account has never been used, which is the only time it can be deleted. */
  canDelete: boolean;
}

export interface BankTransaction {
  id: string;
  transactionNumber: string;
  type: BankTransactionType;
  transactionDate: string;
  transactionDay: string;
  fromAccountId: string | null;
  /** The registered bank's own name and key. */
  fromAccountName: string | null;
  fromAccountKey: string | null;
  /** The specific number and holder typed on this movement. */
  fromAccountNumber: string | null;
  fromName: string | null;
  toAccountId: string | null;
  toAccountName: string | null;
  toAccountKey: string | null;
  toAccountNumber: string | null;
  toName: string | null;
  /** Minor units. */
  amount: number;
  /** The fee rate as basis points of the amount: 50 == 0.5%. */
  feeBasisPoints: number;
  /** What that rate came to, in minor units. Calculated in the main process. */
  feeAmount: number;
  /** Whether the shop earned the fee or was charged it. */
  feeDirection: BankFeeDirection;
  /** DEPOSIT or WITHDRAWAL when this movement is part of a customer advance. */
  advanceRole: BankAdvanceRole | null;
  /** On a withdrawal, the deposit it draws down. */
  advanceDepositId: string | null;
  notes: string | null;
  isDeleted: SqliteBool;
  deletedReason: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
}

/**
 * A customer advance: the deposit that opened it, plus what has happened since.
 *
 * It is the deposit row itself, so its number, accounts and fee are the
 * deposit's. The customer is the From side. `remaining` is the deposit's AMOUNT
 * less its withdrawals' amounts — fees are the shop's own and never change what
 * a customer is owed.
 */
export interface BankAdvance extends BankTransaction {
  withdrawn: number;
  remaining: number;
  withdrawalCount: number;
  lastWithdrawalDate: string | null;
  status: BankAdvanceStatus;
}

export interface BankAdvanceDetail {
  advance: BankAdvance;
  /** Oldest first — the order they happened in. */
  withdrawals: BankTransaction[];
}

/** One row of the per-account strip at the top of the Banking screen. */
export interface BankAccountPosition {
  accountId: string;
  name: string;
  key: string;
  isActive: SqliteBool;
  /** Received into this account within the filtered period. */
  received: number;
  /** Transferred out of this account within the filtered period. */
  transferred: number;
  /** received − transferred, for the period on screen. */
  net: number;
  /** received − transferred across the whole history, i.e. what is left in it. */
  balance: number;
  count: number;
}

export interface CashInHand {
  /** Minor units. Zero when the shop has never recorded a count. */
  amount: number;
  countedAt: string | null;
  countedByName: string | null;
  notes: string | null;
  /** False until the first count is saved, so the screen can say "not recorded". */
  recorded: boolean;
}

export interface BankingOverview {
  accounts: BankAccountPosition[];
  /** Every account's period figures added up. */
  totals: {
    received: number;
    transferred: number;
    net: number;
    /** Fees the shop earned over the period, and fees it was charged. */
    feeReceived: number;
    feePaid: number;
    /**
     * net + feeReceived - feePaid: what the shop is up once fees are counted.
     * Not the sum of the list's Actual column, which adds money in to money out.
     */
    netAfterFees: number;
    count: number;
  };
  /** All accounts' balances added up — the money the shop holds in banks. */
  bankBalance: number;
  cashInHand: CashInHand;
  range: { from: string; to: string };
}

export interface ServiceOrder {
  id: string;
  serviceNumber: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  deviceBrand: string;
  deviceModel: string;
  imei: string | null;
  serialNumber: string | null;
  problemDescription: string;
  initialCondition: string | null;
  diagnosis: string | null;
  /** Minor units. */
  estimatedCost: number;
  /** Minor units. Derived from the lines, never typed in. */
  finalCost: number;
  depositAmount: number;
  partsCost: number;
  status: ServiceStatus;
  receivedDate: string;
  receivedDay: string;
  expectedDate: string | null;
  completedDate: string | null;
  deliveredDate: string | null;
  notes: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  /** Derived: everything taken so far, including the deposit. */
  amountPaid: number;
  /** Derived: finalCost - amountPaid, never negative. */
  balance: number;
}

export interface ServiceItem {
  id: string;
  serviceOrderId: string;
  productId: string | null;
  productName: string | null;
  description: string;
  quantity: number;
  unitCost: number;
  sellingPrice: number;
  total: number;
  type: ServiceItemType;
  createdAt: string;
}

export interface ServicePayment {
  id: string;
  amount: number;
  paymentMethod: string;
  referenceNumber: string | null;
  paymentDate: string;
  isDeposit: SqliteBool;
  notes: string | null;
  createdByName: string | null;
}

export interface ServiceOrderDetail {
  order: ServiceOrder;
  items: ServiceItem[];
  payments: ServicePayment[];
}

export interface ServiceSummary {
  received: number;
  delivered: number;
  revenue: number;
  partsCost: number;
  grossProfit: number;
  outstanding: number;
  byStatus: Array<{ status: string; count: number }>;
}

export interface SalesSummary {
  transactions: number;
  itemsSold: number;
  /** Minor units, excluding tax, before discount. */
  grossSales: number;
  discounts: number;
  tax: number;
  /** grossSales - discounts. Tax is not revenue. */
  netSales: number;
  /** From the unit cost frozen at the time of sale. */
  cogs: number;
  grossProfit: number;
  refunds: number;
}

export interface ProfitAndLoss {
  range: { from: string; to: string };
  goods: { netSales: number; cogs: number; grossProfit: number };
  services: { revenue: number; partsCost: number; grossProfit: number };
  totalGrossProfit: number;
  expenses: number;
  netProfit: number;
  /** Collected on behalf of the tax authority; not income. */
  taxCollected: number;
}

export interface Dashboard {
  range: { from: string; to: string };
  /**
   * The window the by-day charts cover — widened to at least a week when the
   * selected period is shorter, so a trend chart always has a trend to draw.
   */
  trendRange: { from: string; to: string };
  currency: string;
  cards: {
    transactions: number;
    itemsSold: number;
    revenue: number;
    expenses: number;
    grossProfit: number;
    netProfit: number;
    serviceRevenue: number;
    outstandingServiceBalance: number;
    lowStockCount: number;
  };
  charts: {
    salesByDay: Array<{
      day: string;
      transactions: number;
      netSales: number;
      cogs: number;
      grossProfit: number;
    }>;
    revenueVsExpenses: Array<{ day: string; revenue: number; expenses: number }>;
    topProducts: Array<{
      productId: string;
      productName: string;
      sku: string;
      quantity: number;
      netSales: number;
      grossProfit: number;
    }>;
    salesByCategory: Array<{ categoryName: string; quantity: number; netSales: number }>;
    paymentMethods: Array<{ paymentMethod: string; count: number; total: number }>;
  };
  recent: {
    sales: Array<{
      id: string;
      invoiceNumber: string;
      customerName: string;
      grandTotal: number;
      status: string;
      saleDate: string;
      cashierName: string | null;
    }>;
    expenses: Array<{
      id: string;
      expenseNumber: string;
      categoryName: string;
      description: string;
      amount: number;
      expenseDay: string;
    }>;
    services: Array<{
      id: string;
      serviceNumber: string;
      customerName: string;
      deviceBrand: string;
      deviceModel: string;
      status: string;
      finalCost: number;
      receivedDate: string;
    }>;
  };
  lowStock: LowStockItem[];
}

export interface PrinterInfo {
  /** Name as the OS understands it — pass this back as deviceName. */
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
}

export type DocumentFormat = 'A4' | 'RECEIPT';

/** What the main process made of the image file the user picked. */
export interface ChosenLogo {
  /** A PNG data URI, already downscaled. Ready to store as `shopLogo`. */
  dataUri: string;
  /** Pixel size after downscaling. */
  width: number;
  height: number;
  /** Length of the stored value, so the screen can show what it costs. */
  bytes: number;
  /** The file it came from, for the confirmation line. */
  fileName: string;
}

export interface Page<T> {
  rows: T[];
  total: number;
}

// -----------------------------------------------------------------------------
// The bridge
// -----------------------------------------------------------------------------

export interface PosApi {
  app: {
    getInfo(): Promise<AppInfo>;
  };
  auth: {
    status(): Promise<AuthStatus>;
    login(input: LoginInput): Promise<AuthStatus>;
    logout(): Promise<void>;
    changeOwnPassword(input: ChangeOwnPasswordInput): Promise<void>;
    completeFirstRunSetup(input: FirstRunSetupInput): Promise<AuthStatus>;
  };
  settings: {
    getAll(): Promise<Partial<Record<SettingKey, string>>>;
    getShop(): Promise<ShopSettings>;
    update(input: UpdateSettingsInput): Promise<ShopSettings>;
    /**
     * Opens a file dialog, reads the chosen image and returns it downscaled as a
     * data URI. Stores nothing — the screen previews it and saves it like any
     * other setting. Null means the user cancelled.
     */
    chooseLogo(): Promise<ChosenLogo | null>;
  };
  products: {
    list(query: ProductListQuery): Promise<Page<Product>>;
    get(input: { id: string }): Promise<Product>;
    /** Barcode or SKU. Resolves to null when nothing matches. */
    findByCode(input: { code: string }): Promise<Product | null>;
    create(input: CreateProductInput): Promise<Product>;
    update(input: UpdateProductInput): Promise<Product>;
    delete(input: { id: string }): Promise<{ deactivated: boolean }>;
    adjustStock(input: AdjustStockInput): Promise<Product>;
  };
  serials: {
    list(input: { productId: string; status?: SerialStatus }): Promise<ProductSerial[]>;
    findByCode(input: { code: string }): Promise<ProductSerial | null>;
    add(input: AddSerialsInput): Promise<Product>;
    markDefective(input: MarkSerialDefectiveInput): Promise<void>;
  };
  categories: {
    list(input: LookupQueryInput): Promise<Lookup[]>;
    save(input: SaveLookupInput): Promise<Lookup>;
  };
  brands: {
    list(input: LookupQueryInput): Promise<Lookup[]>;
    save(input: SaveLookupInput): Promise<Lookup>;
  };
  inventory: {
    history(query: InventoryQueryInput): Promise<Page<InventoryMovement>>;
    lowStock(): Promise<LowStockItem[]>;
    /** Headline stock figures. Needs inventory.view, not reports.view. */
    summary(): Promise<StockSummary>;
  };
  users: {
    /**
     * The staff list. `activeAdmins` comes with it so the screen can disable the
     * changes that would lock the shop out of its own administration; the main
     * process refuses them regardless.
     */
    list(input: LookupQueryInput): Promise<{ rows: StaffUser[]; activeAdmins: number }>;
    get(input: { id: string }): Promise<StaffUser>;
    create(input: CreateUserInput): Promise<StaffUser>;
    /** Name, phone, role and active state. Not the password. */
    update(input: UpdateUserInput): Promise<StaffUser>;
    /** Requires the administrator's own password (spec §30). */
    resetPassword(input: ResetPasswordInput): Promise<{ reset: true }>;
    /** Deactivates instead when the account is named in trading history. */
    delete(input: { id: string }): Promise<{ deactivated: boolean }>;
  };
  customers: {
    list(query: CustomerListQuery): Promise<Page<Customer>>;
    get(input: { id: string }): Promise<Customer>;
    create(input: CreateCustomerInput): Promise<Customer>;
    update(input: UpdateCustomerInput): Promise<Customer>;
    history(input: { id: string }): Promise<{
      customer: Customer;
      purchases: CustomerPurchase[];
      services: CustomerServiceJob[];
    }>;
  };
  expenses: {
    list(query: ExpenseListQuery): Promise<Page<Expense> & { totalAmount: number }>;
    get(input: { id: string }): Promise<Expense>;
    create(input: CreateExpenseInput): Promise<Expense>;
    update(input: UpdateExpenseInput): Promise<Expense>;
    delete(input: DeleteExpenseInput): Promise<void>;
    summary(range: DayRangeInput): Promise<ExpenseSummary>;
  };
  expenseCategories: {
    list(input: LookupQueryInput): Promise<ExpenseCategory[]>;
    save(input: SaveLookupInput): Promise<ExpenseCategory>;
  };
  banking: {
    /** Per-account figures for the period, plus all-time balances and cash in hand. */
    overview(range: DayRangeInput): Promise<BankingOverview>;
    listAccounts(input: LookupQueryInput): Promise<BankAccount[]>;
    /** Creates or renames an account. The key is only ever taken on create. */
    saveAccount(input: SaveBankAccountInput): Promise<BankAccount>;
    /** Refused once the account has been used — deactivate it instead. */
    deleteAccount(input: { id: string }): Promise<{ deleted: true }>;
    /**
     * transferTotal / receiveTotal are the listed rows split BY TYPE, so they add
     * up to the value on screen. The overview's received / transferred are money
     * in and out of each account, which is a different question.
     */
    listTransactions(
      query: BankTransactionListQuery,
    ): Promise<Page<BankTransaction> & { transferTotal: number; receiveTotal: number }>;
    createTransaction(input: CreateBankTransactionInput): Promise<BankTransaction>;
    /**
     * Administrators only. Soft delete, so past balances stay explainable.
     * Refused for an advance deposit while withdrawals still draw on it.
     */
    deleteTransaction(input: DeleteBankTransactionInput): Promise<void>;
    /**
     * heldTotal and openCount cover EVERY open advance, whatever the search —
     * they answer how much of the money in the accounts belongs to customers.
     */
    listAdvances(query: BankAdvanceListQueryInput): Promise<{
      rows: BankAdvance[];
      total: number;
      heldTotal: number;
      openCount: number;
    }>;
    getAdvance(input: { id: string }): Promise<BankAdvanceDetail>;
    /** A customer's money arriving, to collect later. Always a receive. */
    openAdvance(input: OpenBankAdvanceInput): Promise<BankAdvance>;
    /** Refused if the amount is more than is left, or the advance is settled. */
    withdrawAdvance(input: WithdrawBankAdvanceInput): Promise<BankAdvanceDetail>;
    /** Records a counted cash-in-hand figure. */
    saveCashCount(input: SaveCashCountInput): Promise<CashInHand>;
  };
  backup: {
    /** Folders, retention settings and every backup file found (spec §53). */
    overview(): Promise<BackupOverview>;
    create(input: { chooseLocation?: boolean }): Promise<
      { created: true; file: BackupFile } | { created: false; file: null }
    >;
    /** Reads a candidate without touching the live database (spec §55). */
    inspect(input: { path: string }): Promise<BackupInspection>;
    /**
     * Replaces the live database. Always takes a safety backup first, and
     * always signs the current user out — call auth.status() afterwards.
     */
    restore(input: { path: string }): Promise<RestoreResult>;
    delete(input: { path: string }): Promise<{ deleted: true }>;
    chooseFolder(): Promise<{ chosen: boolean; path: string | null; writable: boolean }>;
    openFolder(): Promise<{ opened: boolean; path: string }>;
  };
  data: {
    /** Exports a list screen with its own filters applied (spec §56). */
    exportList(
      input: {
        format: ExportFormat;
        chooseLocation?: boolean;
        deviceName?: string;
      } & (
        | { dataset: 'PRODUCT_LIST'; query: ProductListQuery }
        | { dataset: 'CUSTOMER_LIST'; query: CustomerListQuery }
        | { dataset: 'SALE_LIST'; query: SaleListQuery }
        | { dataset: 'EXPENSE_LIST'; query: ExpenseListQuery }
        | { dataset: 'BANK_TRANSACTION_LIST'; query: BankTransactionListQuery }
        | { dataset: 'INVENTORY_LIST'; query?: Record<string, never> }
      ),
    ): Promise<{ saved: boolean; path: string | null }>;
    /**
     * Reads a spreadsheet and reports what importing it would do (spec §57).
     * Writes nothing. Null means the user cancelled the file dialog.
     */
    importPreview(input?: { path?: string }): Promise<ImportPreview | null>;
    importCommit(input: { importId: string }): Promise<ImportResult>;
    importCancel(input: { importId: string }): Promise<{ cancelled: true }>;
    importTemplate(): Promise<{ saved: boolean; path: string | null }>;
  };
  reports: {
    /** Everything the dashboard shows, for any date range (spec §72). */
    dashboard(range: DayRangeInput): Promise<Dashboard>;
    sales(range: DayRangeInput): Promise<SalesSummary>;
    profitAndLoss(range: DayRangeInput): Promise<ProfitAndLoss>;
    /** Builds any of the eight reports as data (spec §46). */
    build(input: { kind: ReportKind; from: string; to: string }): Promise<Report>;
    /** Renders a report to Excel, CSV, PDF or a printer (spec §90). */
    export(input: {
      kind: ReportKind;
      from: string;
      to: string;
      format: ExportFormat;
      chooseLocation?: boolean;
      deviceName?: string;
    }): Promise<{ saved: boolean; path: string | null }>;
    openExportsFolder(): Promise<{ opened: boolean; path: string }>;
  };
  services: {
    list(query: ServiceListQuery): Promise<Page<ServiceOrder>>;
    get(input: { serviceOrderId: string }): Promise<ServiceOrderDetail>;
    /** Job counts per status, for the board columns. */
    board(): Promise<Record<string, number>>;
    summary(range: DayRangeInput): Promise<ServiceSummary>;
    create(input: CreateServiceOrderInput): Promise<ServiceOrderDetail>;
    update(input: UpdateServiceOrderInput): Promise<ServiceOrderDetail>;
    addItem(input: AddServiceItemInput): Promise<ServiceOrderDetail>;
    removeItem(input: { id: string }): Promise<ServiceOrderDetail>;
    addPayment(input: AddServicePaymentInput): Promise<ServiceOrderDetail>;
    changeStatus(input: ChangeServiceStatusInput): Promise<ServiceOrderDetail>;
    printDocument(input: {
      serviceOrderId: string;
      kind?: 'JOB_SHEET' | 'COMPLETION';
      deviceName?: string;
      silent?: boolean;
      reprint?: boolean;
      asPdf?: boolean;
    }): Promise<{ printed: boolean; path: string | null }>;
  };
  print: {
    listPrinters(): Promise<PrinterInfo[]>;
    /** Prints or reprints a sale. Builds the document from the stored sale. */
    sale(input: {
      saleId: string;
      format?: DocumentFormat;
      deviceName?: string;
      silent?: boolean;
      reprint?: boolean;
      copies?: number;
    }): Promise<{ invoiceNumber: string }>;
    savePdf(input: {
      saleId: string;
      format?: DocumentFormat;
      chooseLocation?: boolean;
    }): Promise<{ saved: boolean; path: string | null }>;
    openFile(input: { path: string }): Promise<{ opened: boolean }>;
  };
  sales: {
    /** Prices the cart without writing anything. */
    quote(input: CreateSaleInput): Promise<SaleQuote>;
    create(input: CreateSaleInput): Promise<SaleDetail>;
    list(query: SaleListQuery): Promise<Page<Sale>>;
    get(input: { saleId: string }): Promise<SaleDetail>;
    cancel(input: CancelSaleInput): Promise<SaleDetail>;
    refund(input: RefundSaleInput): Promise<{
      sale: SaleDetail;
      returnNumber: string;
      refundAmount: number;
    }>;
  };
}
