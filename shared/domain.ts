/**
 * Domain vocabulary shared by the main process and the renderer.
 *
 * SQLite has no enum type, so these values live in TEXT columns. These unions
 * plus the Zod schemas in shared/validation.ts are what actually enforce them,
 * at the IPC trust boundary.
 */

// -----------------------------------------------------------------------------
// Users
// -----------------------------------------------------------------------------

export const USER_ROLES = ["ADMIN", "MANAGER", "CASHIER"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Administrator",
  MANAGER: "Manager",
  CASHIER: "Cashier",
};

/**
 * Every capability the application gates on. Checked in the main process on
 * every IPC call — the renderer's copy is only used to hide controls.
 */
export const PERMISSIONS = [
  "pos.sell",
  "pos.discount",
  "sales.view",
  "sales.cancel",
  "sales.refund",
  "products.view",
  "products.manage",
  "products.import",
  "inventory.view",
  "inventory.adjust",
  "customers.view",
  "customers.manage",
  "services.view",
  "services.manage",
  "expenses.view",
  "expenses.manage",
  "expenses.delete",
  "banking.view",
  "banking.manage",
  "banking.delete",
  "reports.view",
  "users.view",
  "users.manage",
  "settings.view",
  "settings.manage",
  "backup.manage",
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Role capabilities.
 *
 * CASHIER  — can run the till and look things up, cannot change money history.
 * MANAGER  — full shop operation including refunds and stock, but not users,
 *            settings, backups or the audit log.
 * ADMIN    — everything.
 */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  CASHIER: [
    "pos.sell",
    "sales.view",
    "products.view",
    "inventory.view",
    "customers.view",
    "customers.manage",
    "services.view",
    "services.manage",
  ],
  MANAGER: [
    "pos.sell",
    "pos.discount",
    "sales.view",
    "sales.cancel",
    "sales.refund",
    "products.view",
    "products.manage",
    "products.import",
    "inventory.view",
    "inventory.adjust",
    "customers.view",
    "customers.manage",
    "services.view",
    "services.manage",
    "expenses.view",
    "expenses.manage",
    "banking.view",
    "banking.manage",
    "reports.view",
    "users.view",
    "settings.view",
  ],
  ADMIN: PERMISSIONS,
};

export function roleHasPermission(
  role: UserRole,
  permission: Permission,
): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

// -----------------------------------------------------------------------------
// Payments
// -----------------------------------------------------------------------------

export const PAYMENT_METHODS = [
  "CASH",
  "BANK_TRANSFER",
  "CREDIT_CARD",
  "DEBIT_CARD",
  "MOBILE_PAYMENT",
  "OTHER",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank Transfer",
  CREDIT_CARD: "Credit Card",
  DEBIT_CARD: "Debit Card",
  MOBILE_PAYMENT: "Mobile Payment",
  OTHER: "Other",
};

/** Methods that should prompt for a reference number. */
export function requiresReference(method: PaymentMethod): boolean {
  return method !== "CASH";
}

export const PAYMENT_STATUSES = ["UNPAID", "PARTIAL", "PAID"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: "Unpaid",
  PARTIAL: "Partially Paid",
  PAID: "Paid",
};

// -----------------------------------------------------------------------------
// Banking
// -----------------------------------------------------------------------------

/**
 * Which way the money went, from the shop's point of view.
 *
 * TRANSFER always leaves one of the shop's own accounts and RECEIVE always
 * arrives into one — the service refuses anything else, because a movement that
 * touches none of the shop's accounts would count towards the headline totals
 * while changing no balance.
 */
export const BANK_TRANSACTION_TYPES = ["TRANSFER", "RECEIVE"] as const;
export type BankTransactionType = (typeof BANK_TRANSACTION_TYPES)[number];

export const BANK_TRANSACTION_TYPE_LABELS: Record<BankTransactionType, string> =
  {
    TRANSFER: "Account Transfer (Cash In)",
    RECEIVE: "Account Receive (Cash Out)",
  };

/**
 * Which way the fee on a movement went.
 *
 * An agent shop is on both sides of this at different times: it earns a
 * commission for handling a customer's transfer (RECEIVE), and it is charged by
 * the wallet for moving its own money (PAY). The fee is recorded either way so
 * the figure is not silently assumed.
 */
export const BANK_FEE_DIRECTIONS = ["RECEIVE", "PAY"] as const;
export type BankFeeDirection = (typeof BANK_FEE_DIRECTIONS)[number];

export const BANK_FEE_DIRECTION_LABELS: Record<BankFeeDirection, string> = {
  RECEIVE: "Received",
  PAY: "Pay",
};

/**
 * Money a customer leaves with the shop to collect later — all at once or in
 * parts.
 *
 * Not a separate ledger: the deposit is an ordinary RECEIVE and each withdrawal
 * an ordinary TRANSFER, so every step carries its own accounts, amount and fee,
 * and the money shows in the account balances exactly where it really is. The
 * role is what ties the steps together, and what is still owed is worked out
 * from them rather than stored, so it cannot drift from the movements.
 */
export const BANK_ADVANCE_ROLES = ["DEPOSIT", "WITHDRAWAL"] as const;
export type BankAdvanceRole = (typeof BANK_ADVANCE_ROLES)[number];

export const BANK_ADVANCE_ROLE_LABELS: Record<BankAdvanceRole, string> = {
  DEPOSIT: "Advance deposit",
  WITHDRAWAL: "Advance withdrawal",
};

/** Derived from what is left, never stored: OPEN while anything remains. */
export const BANK_ADVANCE_STATUSES = ["OPEN", "SETTLED"] as const;
export type BankAdvanceStatus = (typeof BANK_ADVANCE_STATUSES)[number];

export const BANK_ADVANCE_STATUS_LABELS: Record<BankAdvanceStatus, string> = {
  OPEN: "Open",
  SETTLED: "Settled",
};

// -----------------------------------------------------------------------------
// Sales
// -----------------------------------------------------------------------------

export const SALE_STATUSES = [
  "COMPLETED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partially Refunded",
};

/** Statuses that still count as revenue in reports. */
export const REVENUE_SALE_STATUSES: readonly SaleStatus[] = [
  "COMPLETED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
];

// -----------------------------------------------------------------------------
// Inventory
// -----------------------------------------------------------------------------

export const SERIAL_STATUSES = [
  "AVAILABLE",
  "SOLD",
  "RETURNED",
  "DEFECTIVE",
  "RESERVED",
] as const;
export type SerialStatus = (typeof SERIAL_STATUSES)[number];

export const SERIAL_STATUS_LABELS: Record<SerialStatus, string> = {
  AVAILABLE: "Available",
  SOLD: "Sold",
  RETURNED: "Returned",
  DEFECTIVE: "Defective",
  RESERVED: "Reserved",
};

/** Only these serials may be added to a cart. */
export const SELLABLE_SERIAL_STATUSES: readonly SerialStatus[] = ["AVAILABLE"];

export const INVENTORY_TRANSACTION_TYPES = [
  "PURCHASE",
  "SALE",
  "SALE_RETURN",
  "ADJUSTMENT",
  "DAMAGE",
  "SERVICE_USAGE",
] as const;
export type InventoryTransactionType =
  (typeof INVENTORY_TRANSACTION_TYPES)[number];

export const INVENTORY_TRANSACTION_LABELS: Record<
  InventoryTransactionType,
  string
> = {
  PURCHASE: "Purchase / Stock In",
  SALE: "Sale",
  SALE_RETURN: "Sale Return",
  ADJUSTMENT: "Adjustment",
  DAMAGE: "Damage / Loss",
  SERVICE_USAGE: "Used in Service",
};

export const REFERENCE_TYPES = [
  "SALE",
  "SALE_RETURN",
  "SERVICE_ORDER",
  "ADJUSTMENT",
  "PURCHASE",
  "IMPORT",
] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];

// -----------------------------------------------------------------------------
// Service / repair
// -----------------------------------------------------------------------------

export const SERVICE_STATUSES = [
  "RECEIVED",
  "DIAGNOSING",
  "WAITING_APPROVAL",
  "REPAIRING",
  "WAITING_PARTS",
  "COMPLETED",
  "DELIVERED",
  "CANCELLED",
] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  RECEIVED: "Received",
  DIAGNOSING: "Diagnosing",
  WAITING_APPROVAL: "Waiting Approval",
  REPAIRING: "Repairing",
  WAITING_PARTS: "Waiting Parts",
  COMPLETED: "Completed",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

/** Which statuses a job may move to next. Keeps the workflow honest. */
export const SERVICE_STATUS_TRANSITIONS: Record<
  ServiceStatus,
  readonly ServiceStatus[]
> = {
  RECEIVED: ["DIAGNOSING", "REPAIRING", "CANCELLED"],
  DIAGNOSING: ["WAITING_APPROVAL", "REPAIRING", "WAITING_PARTS", "CANCELLED"],
  WAITING_APPROVAL: ["REPAIRING", "WAITING_PARTS", "CANCELLED"],
  WAITING_PARTS: ["REPAIRING", "CANCELLED"],
  REPAIRING: ["COMPLETED", "WAITING_PARTS", "CANCELLED"],
  COMPLETED: ["DELIVERED", "REPAIRING"],
  DELIVERED: [],
  CANCELLED: [],
};

/** Statuses shown as columns on the service dashboard. */
export const SERVICE_BOARD_STATUSES: readonly ServiceStatus[] = [
  "RECEIVED",
  "DIAGNOSING",
  "WAITING_APPROVAL",
  "WAITING_PARTS",
  "REPAIRING",
  "COMPLETED",
  "DELIVERED",
];

export const SERVICE_ITEM_TYPES = ["PART", "LABOR", "OTHER"] as const;
export type ServiceItemType = (typeof SERVICE_ITEM_TYPES)[number];

export const SERVICE_ITEM_TYPE_LABELS: Record<ServiceItemType, string> = {
  PART: "Part",
  LABOR: "Labour",
  OTHER: "Other",
};

// -----------------------------------------------------------------------------
// Returns
// -----------------------------------------------------------------------------

export const RETURN_STATUSES = ["COMPLETED", "CANCELLED"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

// -----------------------------------------------------------------------------
// Audit
// -----------------------------------------------------------------------------

export const AUDIT_ACTIONS = [
  "LOGIN",
  "LOGIN_FAILED",
  "LOGOUT",
  "CREATE",
  "UPDATE",
  "DELETE",
  "CANCEL",
  "REFUND",
  "ADJUST_STOCK",
  "RESET_PASSWORD",
  "BACKUP",
  "RESTORE",
  "IMPORT",
  "EXPORT",
  "SETTINGS_UPDATE",
  "MIGRATION",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// -----------------------------------------------------------------------------
// Misc
// -----------------------------------------------------------------------------

export const PRODUCT_UNITS = [
  "pcs",
  "box",
  "set",
  "pack",
  "pair",
  "metre",
] as const;

export const RECEIPT_WIDTHS = ["58mm", "80mm"] as const;
export type ReceiptWidth = (typeof RECEIPT_WIDTHS)[number];

export const TAX_MODES = ["EXCLUSIVE", "INCLUSIVE"] as const;
export type TaxMode = (typeof TAX_MODES)[number];

export const AUTO_BACKUP_FREQUENCIES = ["DISABLED", "DAILY", "WEEKLY"] as const;
export type AutoBackupFrequency = (typeof AUTO_BACKUP_FREQUENCIES)[number];
