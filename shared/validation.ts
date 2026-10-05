/**
 * Zod schemas for every IPC payload.
 *
 * These are the trust boundary (spec §65, §73): the main process parses each
 * payload here before a handler sees it, so renderer input is never taken at
 * face value. The same schemas back the React forms, which keeps client-side
 * messages and server-side rules identical by construction.
 */
import { z } from 'zod';
import {
  USER_ROLES,
  PAYMENT_METHODS,
  INVENTORY_TRANSACTION_TYPES,
  SERVICE_STATUSES,
  SERVICE_ITEM_TYPES,
  SALE_STATUSES,
  SERIAL_STATUSES,
  BANK_ADVANCE_STATUSES,
  BANK_FEE_DIRECTIONS,
  BANK_TRANSACTION_TYPES,
} from './domain';
import { DATE_PRESETS, LOCAL_DATE_TIME_PATTERN } from './datetime';
import { SETTING_KEYS, isStorableLogo, settingValueLimit, type SettingKey } from './settings';
import { MAX_MINOR } from './money';

// -----------------------------------------------------------------------------
// Primitives
// -----------------------------------------------------------------------------

export const zEmpty = z.void().or(z.undefined()).or(z.null());

/** Accepts undefined so `api.x.list()` with no argument validates. */
export const zNoPayload = z.undefined().or(z.null()).or(z.object({}).strict());

export const zId = z.string().min(1, 'Required').max(64);

export const zName = z.string().trim().min(1, 'Required').max(200);

/**
 * Optional free text.
 *
 * A blank form field arrives as '' and is normalised to undefined so the
 * database stores NULL rather than an empty string. The trailing .optional()
 * matters: without it the transform leaves the object key REQUIRED (with an
 * undefined value), which makes every call site pass `notes: undefined`.
 */
export const zOptionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => (v === '' ? undefined : v))
  .optional();

export const zShortText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v === '' ? undefined : v))
  .optional();

/** Money in minor units. Never a decimal across the bridge. */
export const zMinor = z
  .number()
  .int('Must be a whole number of minor units')
  .min(0, 'Cannot be negative')
  .max(MAX_MINOR, 'Amount is too large');

export const zSignedMinor = z.number().int().min(-MAX_MINOR).max(MAX_MINOR);

/** Basis points: 0–100%. */
export const zBasisPoints = z.number().int().min(0).max(10_000);

export const zQuantity = z.number().int('Must be a whole number').min(1, 'Must be at least 1').max(100_000);

export const zStock = z.number().int().min(0, 'Cannot be negative').max(10_000_000);

export const zBusinessDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker');

export const zPhone = z
  .string()
  .trim()
  .max(40)
  .regex(/^[0-9+\-()\s]*$/, 'Digits, spaces and + - ( ) only')
  .optional()
  .transform((v) => (v === '' ? undefined : v))
  .optional();

export const zEmail = z
  .string()
  .trim()
  .max(200)
  .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address')
  .optional()
  .transform((v) => (v === '' ? undefined : v))
  .optional();

/** IMEI / serial: alphanumeric, no spaces, so scans stay comparable. */
export const zSerial = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and hyphens only');

export const zPassword = z
  .string()
  .min(6, 'Use at least 6 characters')
  .max(200, 'Password is too long');

export const zUsername = z
  .string()
  .trim()
  .min(3, 'Use at least 3 characters')
  .max(40)
  .regex(/^[A-Za-z0-9._-]+$/, 'Letters, numbers, dot, underscore and hyphen only');

export const zPaymentMethod = z.enum(PAYMENT_METHODS);
export const zUserRole = z.enum(USER_ROLES);
export const zSerialStatus = z.enum(SERIAL_STATUSES);
export const zSaleStatus = z.enum(SALE_STATUSES);
export const zServiceStatus = z.enum(SERVICE_STATUSES);
export const zServiceItemType = z.enum(SERVICE_ITEM_TYPES);
export const zInventoryTransactionType = z.enum(INVENTORY_TRANSACTION_TYPES);

// -----------------------------------------------------------------------------
// Paging / searching
// -----------------------------------------------------------------------------

export const zPaging = z.object({
  search: zShortText,
  page: z.number().int().min(0).max(100_000).default(0),
  pageSize: z.number().int().min(1).max(200).default(50),
});

export const zDateRange = z.object({
  preset: z.enum(DATE_PRESETS).default('THIS_MONTH'),
  from: zBusinessDay.optional(),
  to: zBusinessDay.optional(),
});

// -----------------------------------------------------------------------------
// Authentication (spec §29, §30, §88, §89)
// -----------------------------------------------------------------------------

export const zLogin = z.object({
  username: z.string().trim().min(1, 'Enter your username').max(40),
  password: z.string().min(1, 'Enter your password').max(200),
});

export const zChangeOwnPassword = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: zPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

/** Spec §88 / §89 — the first-run wizard. */
export const zFirstRunSetup = z
  .object({
    shopName: zName,
    shopAddress: zOptionalText,
    shopPhone: zPhone,
    shopEmail: zEmail,
    fullName: zName,
    username: zUsername,
    password: zPassword,
    confirmPassword: z.string(),
    currency: z.string().trim().min(2).max(8),
    taxEnabled: z.boolean().default(false),
    taxRate: zBasisPoints.default(0),
    taxMode: z.enum(['EXCLUSIVE', 'INCLUSIVE']).default('EXCLUSIVE'),
    receiptWidth: z.enum(['58mm', '80mm']).default('80mm'),
    backupLocation: zOptionalText,
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

// -----------------------------------------------------------------------------
// Users (spec §30)
// -----------------------------------------------------------------------------

export const zCreateUser = z
  .object({
    username: zUsername,
    fullName: zName,
    phone: zPhone,
    role: zUserRole,
    password: zPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const zUpdateUser = z.object({
  id: zId,
  fullName: zName,
  phone: zPhone,
  role: zUserRole,
  isActive: z.boolean(),
});

/** Resetting another user's password requires the admin's own password. */
export const zResetPassword = z
  .object({
    userId: zId,
    adminPassword: z.string().min(1, 'Enter your own password to confirm'),
    newPassword: zPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

// -----------------------------------------------------------------------------
// Settings (spec §58)
// -----------------------------------------------------------------------------

/**
 * Settings are validated PER KEY, not by one cap over all of them.
 *
 * A single generous limit is what made this schema unable to store a shop logo
 * (an inlined image needs six figures) while simultaneously letting every other
 * key hold 20,000 characters of anything. Now each key gets the room it actually
 * needs, and `shopLogo` additionally has to look like an inlined image — it ends
 * up inside an `<img src>` on a printed invoice, so the shape is refused here
 * rather than escaped downstream.
 */
export const zUpdateSettings = z.object({
  /*
    partialRecord, not record.

    z.record with an enum key demands EVERY key be present, which made this
    channel accept only a complete settings map. Nothing typed caught it, because
    the one caller that sent a subset (the backup schedule) declared its argument
    as a loose Record<string, string> — so saving a backup frequency was rejected
    at the boundary with a "required" complaint about all thirty-odd other keys.

    partialRecord still rejects an unknown key and a non-string value, which is
    what this schema is actually for.
  */
  values: z.partialRecord(z.enum(SETTING_KEYS), z.string()).superRefine((values, ctx) => {
    for (const [key, value] of Object.entries(values) as Array<[SettingKey, string | undefined]>) {
      if (value === undefined) continue;
      const limit = settingValueLimit(key);
      if (value.length > limit) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `That is too long — the most this setting can hold is ${limit} characters.`,
        });
      }
      if (key === 'shopLogo' && !isStorableLogo(value)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'A logo must be a PNG, JPEG or WebP image chosen with the Choose Image button.',
        });
      }
    }
  }),
});

// -----------------------------------------------------------------------------
// Products (spec §10, §40, §73)
// -----------------------------------------------------------------------------

export const zSerialEntry = z.object({
  serialNumber: zSerial.optional(),
  imei1: zSerial.optional(),
  imei2: zSerial.optional(),
  purchasePrice: zMinor.optional(),
  sellingPrice: zMinor.optional(),
  notes: zShortText,
});

const productFields = {
  sku: z.string().trim().min(1, 'SKU is required').max(60),
  barcode: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => (v === '' ? undefined : v))
    // The trailing .optional() is what makes the KEY optional; without it every
    // caller has to write `barcode: undefined`. See zOptionalText above.
    .optional(),
  name: zName,
  description: zOptionalText,
  categoryId: zId.optional(),
  brandId: zId.optional(),
  purchasePrice: zMinor,
  sellingPrice: zMinor,
  taxRate: zBasisPoints.default(0),
  taxRateOverride: z.boolean().default(false),
  minimumStock: zStock.default(0),
  unit: z.string().trim().min(1).max(20).default('pcs'),
  isSerialized: z.boolean().default(false),
  warrantyMonths: z.number().int().min(0).max(120).default(0),
};

export const zCreateProduct = z.object({
  ...productFields,
  initialStock: zStock.default(0),
  serials: z.array(zSerialEntry).max(500).optional(),
});

export const zUpdateProduct = z.object({
  id: zId,
  ...productFields,
  isActive: z.boolean().default(true),
});

export const zProductListQuery = z.object({
  search: zShortText,
  categoryId: zId.optional(),
  brandId: zId.optional(),
  lowStockOnly: z.boolean().default(false),
  includeInactive: z.boolean().default(false),
  page: z.number().int().min(0).max(100_000).default(0),
  pageSize: z.number().int().min(1).max(200).default(50),
});

/**
 * Stock adjustment (spec §20).
 * SET records the level found on the shelf; CHANGE records a delta.
 */
export const zAdjustStock = z.object({
  productId: zId,
  mode: z.enum(['SET', 'CHANGE']),
  quantity: z.number().int().min(-1_000_000).max(1_000_000),
  transactionType: z.enum(['PURCHASE', 'ADJUSTMENT', 'DAMAGE', 'SERVICE_USAGE']),
  reason: z.string().trim().min(1, 'Give a reason for this adjustment').max(300),
  unitCost: zMinor.optional(),
});

export const zAddSerials = z.object({
  productId: zId,
  serials: z.array(zSerialEntry).min(1, 'Add at least one IMEI or serial number').max(500),
});

export const zMarkSerialDefective = z.object({
  serialId: zId,
  reason: z.string().trim().min(1, 'Give a reason').max(300),
});

export const zSaveLookup = z.object({
  id: zId.optional(),
  name: zName,
  description: zOptionalText,
  isActive: z.boolean().default(true),
});

export const zLookupQuery = z.object({
  includeInactive: z.boolean().default(false),
});

export const zInventoryQuery = z.object({
  productId: zId.optional(),
  from: zBusinessDay.optional(),
  to: zBusinessDay.optional(),
  type: zInventoryTransactionType.optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

// -----------------------------------------------------------------------------
// Customers (spec §14, §73)
// -----------------------------------------------------------------------------

export const zCreateCustomer = z.object({
  name: zName,
  phone: zPhone,
  email: zEmail,
  address: zOptionalText,
  notes: zOptionalText,
});

export const zUpdateCustomer = z.object({
  id: zId,
  name: zName,
  phone: zPhone,
  email: zEmail,
  address: zOptionalText,
  notes: zOptionalText,
  isActive: z.boolean().default(true),
});

export const zCustomerListQuery = zPaging.extend({
  includeInactive: z.boolean().default(false),
});

// -----------------------------------------------------------------------------
// Sales (spec §15, §36, §68, §73)
// -----------------------------------------------------------------------------

/**
 * Note what is NOT here: no unit price, no line total, no grand total. The
 * renderer says what is being bought; the main process decides what it costs.
 */
export const zSaleItem = z.object({
  productId: zId,
  quantity: zQuantity,
  productSerialId: zId.optional(),
});

export const zSalePayment = z.object({
  amount: zMinor,
  paymentMethod: zPaymentMethod,
  referenceNumber: zShortText,
  notes: zShortText,
});

export const zCreateSale = z.object({
  customerId: zId.optional(),
  items: z.array(zSaleItem).min(1, 'Add at least one item').max(200),
  discountAmount: zMinor.default(0),
  payments: z.array(zSalePayment).max(10).default([]),
  notes: zOptionalText,
});

export const zSaleListQuery = z.object({
  search: zShortText,
  from: zBusinessDay.optional(),
  to: zBusinessDay.optional(),
  status: zSaleStatus.optional(),
  cashierId: zId.optional(),
  customerId: zId.optional(),
  paymentMethod: zPaymentMethod.optional(),
  page: z.number().int().min(0).max(100_000).default(0),
  pageSize: z.number().int().min(1).max(200).default(50),
});

export const zCancelSale = z.object({
  saleId: zId,
  reason: z.string().trim().min(1, 'Give a reason for cancelling').max(300),
});

export const zRefundSale = z.object({
  saleId: zId,
  items: z
    .array(
      z.object({
        saleItemId: zId,
        quantity: zQuantity,
        isDefective: z.boolean().default(false),
      }),
    )
    .min(1, 'Select at least one item to refund'),
  reason: z.string().trim().min(1, 'Give a reason for the refund').max(300),
  refundMethod: zPaymentMethod.default('CASH'),
  notes: zOptionalText,
});

// -----------------------------------------------------------------------------
// Expenses (spec §19, §43, §73)
// -----------------------------------------------------------------------------

const expenseFields = {
  categoryId: zId,
  /** The business day the money was spent, from the date picker. */
  expenseDay: zBusinessDay,
  description: z.string().trim().min(1, 'Describe what this was for').max(300),
  amount: zMinor.refine((v) => v > 0, 'Amount must be more than zero'),
  paymentMethod: zPaymentMethod,
  referenceNumber: zShortText,
  notes: zOptionalText,
};

export const zCreateExpense = z.object(expenseFields);
export const zUpdateExpense = z.object({ id: zId, ...expenseFields });

export const zDeleteExpense = z.object({
  id: zId,
  reason: z.string().trim().min(1, 'Give a reason for deleting this expense').max(300),
});

export const zExpenseListQuery = z.object({
  search: zShortText,
  from: zBusinessDay.optional(),
  to: zBusinessDay.optional(),
  categoryId: zId.optional(),
  paymentMethod: zPaymentMethod.optional(),
  includeDeleted: z.boolean().default(false),
  page: z.number().int().min(0).max(100_000).default(0),
  pageSize: z.number().int().min(1).max(200).default(50),
});

export const zDayRange = z.object({
  from: zBusinessDay,
  to: zBusinessDay,
});

// -----------------------------------------------------------------------------
// Banking — accounts, transfers and receipts, cash in hand
// -----------------------------------------------------------------------------

/**
 * The short handle for an account, e.g. "Kpay".
 *
 * No spaces, so it reads as one token in a table column and in an exported
 * spreadsheet. It is accepted on create and IGNORED on update — see
 * banking.service.ts, which refuses an attempt to change it outright.
 */
export const zAccountKey = z
  .string()
  .trim()
  .min(2, 'Use at least 2 characters')
  .max(24, 'Keep the key short')
  .regex(/^[A-Za-z0-9._-]+$/, 'Letters, numbers, dot, underscore and hyphen only');

/**
 * The account or wallet number a movement went to or came from.
 *
 * Belongs to the TRANSACTION, not to the registered bank: one wallet — "Kpay" —
 * serves a different account number on almost every payment, so a number stored
 * against the bank could only ever record one of them.
 *
 * Loose on purpose: bank numbers, wallet numbers and IBANs are formatted
 * differently everywhere, and rejecting a shop's real number because it carries a
 * dash or a space would be worse than accepting a typo. Required, and otherwise
 * taken as typed.
 */
export const zAccountNumber = z
  .string()
  .trim()
  .min(1, 'Enter the account or wallet number')
  .max(40, 'That is longer than any account number');

/** The name on that account. Required for the same reason as the number. */
export const zAccountHolder = z
  .string()
  .trim()
  .min(1, 'Enter the name on the account')
  .max(200);

export const zSaveBankAccount = z.object({
  id: zId.optional(),
  name: zName,
  key: zAccountKey,
  description: zOptionalText,
  isActive: z.boolean().default(true),
});

export const zBankTransactionType = z.enum(BANK_TRANSACTION_TYPES);

/**
 * Everything one movement of money carries, whatever it is part of.
 *
 * Shared by an ordinary transaction, the deposit that opens a customer advance,
 * and every withdrawal from one — so the three forms cannot drift apart on what
 * an account number may look like or how a fee is sent.
 */
const bankMovementFields = {
  /** Local wall-clock date and time from the picker: "2026-08-18T14:30". */
  transactionAt: z
    .string()
    .trim()
    .regex(LOCAL_DATE_TIME_PATTERN, 'Use the date and time picker'),
  fromAccountId: zId.optional(),
  fromAccountNumber: zAccountNumber,
  fromName: zAccountHolder,
  toAccountId: zId.optional(),
  toAccountNumber: zAccountNumber,
  toName: zAccountHolder,
  amount: zMinor.refine((v) => v > 0, 'Amount must be more than zero'),
  /**
   * The fee on this movement as basis points of the amount: 50 == 0.5%.
   *
   * zBasisPoints is already capped at 10,000, which is 100% — the ceiling the
   * form offers. Note what is NOT here: the fee in money. The renderer shows a
   * running figure while the user types, but the stored one is worked out in
   * the main process from the amount and this rate, for the same reason a
   * cart never sends a price (§68).
   */
  feeBasisPoints: zBasisPoints.default(0),
  feeDirection: z.enum(BANK_FEE_DIRECTIONS).default('RECEIVE'),
  notes: zOptionalText,
};

const OWN_ACCOUNT_LEFT = {
  message: 'Choose which of your accounts the money left',
  path: ['fromAccountId'],
};
const OWN_ACCOUNT_ARRIVED = {
  message: 'Choose which of your accounts the money arrived in',
  path: ['toAccountId'],
};

export const zCreateBankTransaction = z
  .object({ type: zBankTransactionType, ...bankMovementFields })
  // The shop's own account is on the side the money moved, so that per-account
  // balances and the headline totals can never tell different stories. The main
  // process checks this too; here it puts the message on the right field.
  .refine((v) => v.type !== 'TRANSFER' || Boolean(v.fromAccountId), OWN_ACCOUNT_LEFT)
  .refine((v) => v.type !== 'RECEIVE' || Boolean(v.toAccountId), OWN_ACCOUNT_ARRIVED);
// Both sides may be the SAME account. A shop moving money within one wallet, or
// correcting a figure inside it, is a real movement worth recording; it nets to
// zero against that account's balance, which is the honest result.

/**
 * Opens a customer advance: the customer's money arriving in one of the shop's
 * accounts, to be collected later. Always a RECEIVE, so there is no type here
 * for the renderer to get wrong.
 */
export const zOpenBankAdvance = z
  .object(bankMovementFields)
  .refine((v) => Boolean(v.toAccountId), OWN_ACCOUNT_ARRIVED);

/**
 * Pays some or all of an advance back out. Always a TRANSFER out of one of the
 * shop's accounts.
 *
 * Whether the amount fits in what is left is NOT checked here: that figure is
 * only true inside the database transaction that writes the withdrawal, and a
 * check made against a number read earlier is how two withdrawals both fit.
 */
export const zWithdrawBankAdvance = z
  .object({ advanceId: zId, ...bankMovementFields })
  .refine((v) => Boolean(v.fromAccountId), OWN_ACCOUNT_LEFT);

export const zBankAdvanceListQuery = z.object({
  search: zShortText,
  /** Omitted for every advance, open or settled. */
  status: z.enum(BANK_ADVANCE_STATUSES).optional(),
  page: z.number().int().min(0).max(100_000).default(0),
  pageSize: z.number().int().min(1).max(200).default(50),
});

export const zDeleteBankTransaction = z.object({
  id: zId,
  reason: z.string().trim().min(1, 'Give a reason for deleting this transaction').max(300),
});

export const zBankTransactionListQuery = z.object({
  search: zShortText,
  from: zBusinessDay.optional(),
  to: zBusinessDay.optional(),
  type: zBankTransactionType.optional(),
  /** Matches either side of the movement. */
  accountId: zId.optional(),
  includeDeleted: z.boolean().default(false),
  page: z.number().int().min(0).max(100_000).default(0),
  pageSize: z.number().int().min(1).max(200).default(50),
});

export const zSaveCashCount = z.object({
  amount: zMinor,
  notes: zShortText,
});

// -----------------------------------------------------------------------------
// Service / repair (spec §21–§23, §51, §52)
// -----------------------------------------------------------------------------

const deviceFields = {
  deviceBrand: z.string().trim().min(1, 'Which brand is it?').max(80),
  deviceModel: z.string().trim().min(1, 'Which model is it?').max(120),
  imei: zSerial.optional(),
  serialNumber: zSerial.optional(),
  problemDescription: z.string().trim().min(1, 'Describe the fault the customer reported').max(2000),
  initialCondition: zOptionalText,
  estimatedCost: zMinor.default(0),
  /** ISO instant from the date picker. */
  expectedDate: z.string().max(40).optional(),
  notes: zOptionalText,
};

export const zCreateServiceOrder = z.object({
  ...deviceFields,
  customerId: zId.optional(),
  /** Used when the device is taken in without creating a customer record. */
  customerName: z.string().trim().max(200).optional(),
  customerPhone: zPhone,
  depositAmount: zMinor.default(0),
  depositMethod: zPaymentMethod.default('CASH'),
});

export const zUpdateServiceOrder = z.object({
  id: zId,
  ...deviceFields,
  diagnosis: zOptionalText,
});

export const zServiceListQuery = z.object({
  search: zShortText,
  status: zServiceStatus.optional(),
  /** Everything not yet delivered or cancelled. */
  openOnly: z.boolean().default(false),
  customerId: zId.optional(),
  from: zBusinessDay.optional(),
  to: zBusinessDay.optional(),
  page: z.number().int().min(0).max(100_000).default(0),
  pageSize: z.number().int().min(1).max(200).default(50),
});

export const zAddServiceItem = z.object({
  serviceOrderId: zId,
  /** Set to draw a spare part from stock; omit for labour or an outside cost. */
  productId: zId.optional(),
  description: z.string().trim().max(300).default(''),
  quantity: zQuantity.default(1),
  /** Ignored when productId is set — the product's cost is used instead. */
  unitCost: zMinor.default(0),
  sellingPrice: zMinor,
  type: zServiceItemType,
});

export const zAddServicePayment = z.object({
  serviceOrderId: zId,
  amount: zMinor.refine((v) => v > 0, 'Amount must be more than zero'),
  paymentMethod: zPaymentMethod,
  referenceNumber: zShortText,
  notes: zShortText,
});

export const zChangeServiceStatus = z.object({
  serviceOrderId: zId,
  status: zServiceStatus,
  note: zShortText,
});

export const zServiceOrderId = z.object({ serviceOrderId: zId });

export const zSaleId = z.object({ saleId: zId });
export const zIdOnly = z.object({ id: zId });
export const zCodeLookup = z.object({ code: z.string().trim().min(1).max(64) });

/**
 * Product import preview.
 *
 * The whole payload is optional, and that is the normal case: the Import dialog
 * calls this with no argument at all, because the user picks the file in the
 * native open dialog the handler puts up. Only the build's smoke test names a
 * path directly, to keep an automated run from stopping on a modal window. Both
 * shapes have to validate, so this is `nullish` for the same reason zNoPayload
 * tolerates null: an absent argument must not read as a bad one.
 */
export const zImportPreview = z
  .object({ path: z.string().min(1).max(4096).optional() })
  .nullish();

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * Two type families per schema, because several fields transform ('' → undefined,
 * defaults applied):
 *
 *   *FormValues  z.input  — what a React Hook Form field set holds while typing
 *   *Payload     z.output — what the schema produces, and therefore what crosses
 *                           the bridge and what a service receives
 *
 * Keeping them distinct is what lets `useForm<FormValues, unknown, Payload>`
 * type handleSubmit correctly instead of silently widening to FieldValues.
 */
export type LoginInput = z.output<typeof zLogin>;

export type FirstRunSetupFormValues = z.input<typeof zFirstRunSetup>;
export type FirstRunSetupInput = z.output<typeof zFirstRunSetup>;

export type ChangeOwnPasswordInput = z.output<typeof zChangeOwnPassword>;

export type CreateUserFormValues = z.input<typeof zCreateUser>;
export type CreateUserInput = z.output<typeof zCreateUser>;

export type UpdateUserFormValues = z.input<typeof zUpdateUser>;
export type UpdateUserInput = z.output<typeof zUpdateUser>;

export type ResetPasswordFormValues = z.input<typeof zResetPassword>;
export type ResetPasswordInput = z.output<typeof zResetPassword>;
export type UpdateSettingsInput = z.output<typeof zUpdateSettings>;

export type PagingFormValues = z.input<typeof zPaging>;
export type PagingInput = z.output<typeof zPaging>;

export type DateRangeFormValues = z.input<typeof zDateRange>;
export type DateRangeInput = z.output<typeof zDateRange>;

export type SerialEntry = z.output<typeof zSerialEntry>;

export type CreateProductFormValues = z.input<typeof zCreateProduct>;
export type CreateProductInput = z.output<typeof zCreateProduct>;

export type UpdateProductFormValues = z.input<typeof zUpdateProduct>;
export type UpdateProductInput = z.output<typeof zUpdateProduct>;

export type ProductListFormValues = z.input<typeof zProductListQuery>;
export type ProductListQuery = z.output<typeof zProductListQuery>;

export type AdjustStockFormValues = z.input<typeof zAdjustStock>;
export type AdjustStockInput = z.output<typeof zAdjustStock>;

export type AddSerialsFormValues = z.input<typeof zAddSerials>;
export type AddSerialsInput = z.output<typeof zAddSerials>;

export type MarkSerialDefectiveInput = z.output<typeof zMarkSerialDefective>;

export type SaveLookupFormValues = z.input<typeof zSaveLookup>;
export type SaveLookupInput = z.output<typeof zSaveLookup>;
export type LookupQueryInput = z.output<typeof zLookupQuery>;
export type InventoryQueryInput = z.output<typeof zInventoryQuery>;

export type CreateCustomerFormValues = z.input<typeof zCreateCustomer>;
export type CreateCustomerInput = z.output<typeof zCreateCustomer>;

export type UpdateCustomerFormValues = z.input<typeof zUpdateCustomer>;
export type UpdateCustomerInput = z.output<typeof zUpdateCustomer>;

export type CustomerListQuery = z.output<typeof zCustomerListQuery>;

export type SaleItemInput = z.output<typeof zSaleItem>;
export type SalePaymentInput = z.output<typeof zSalePayment>;

export type CreateSaleFormValues = z.input<typeof zCreateSale>;
export type CreateSaleInput = z.output<typeof zCreateSale>;

export type SaleListQuery = z.output<typeof zSaleListQuery>;
export type CancelSaleInput = z.output<typeof zCancelSale>;
export type RefundSaleInput = z.output<typeof zRefundSale>;

export type CreateExpenseFormValues = z.input<typeof zCreateExpense>;
export type CreateExpenseInput = z.output<typeof zCreateExpense>;

export type UpdateExpenseFormValues = z.input<typeof zUpdateExpense>;
export type UpdateExpenseInput = z.output<typeof zUpdateExpense>;

export type DeleteExpenseInput = z.output<typeof zDeleteExpense>;
export type ExpenseListQuery = z.output<typeof zExpenseListQuery>;
export type DayRangeInput = z.output<typeof zDayRange>;

export type SaveBankAccountFormValues = z.input<typeof zSaveBankAccount>;
export type SaveBankAccountInput = z.output<typeof zSaveBankAccount>;

export type CreateBankTransactionFormValues = z.input<typeof zCreateBankTransaction>;
export type CreateBankTransactionInput = z.output<typeof zCreateBankTransaction>;

export type DeleteBankTransactionInput = z.output<typeof zDeleteBankTransaction>;
export type BankTransactionListQuery = z.output<typeof zBankTransactionListQuery>;

export type OpenBankAdvanceInput = z.output<typeof zOpenBankAdvance>;
export type WithdrawBankAdvanceInput = z.output<typeof zWithdrawBankAdvance>;
export type BankAdvanceListQuery = z.output<typeof zBankAdvanceListQuery>;
export type BankAdvanceListQueryInput = z.input<typeof zBankAdvanceListQuery>;

export type SaveCashCountFormValues = z.input<typeof zSaveCashCount>;
export type SaveCashCountInput = z.output<typeof zSaveCashCount>;

export type CreateServiceOrderFormValues = z.input<typeof zCreateServiceOrder>;
export type CreateServiceOrderInput = z.output<typeof zCreateServiceOrder>;

export type UpdateServiceOrderFormValues = z.input<typeof zUpdateServiceOrder>;
export type UpdateServiceOrderInput = z.output<typeof zUpdateServiceOrder>;

export type ServiceListQuery = z.output<typeof zServiceListQuery>;

export type AddServiceItemFormValues = z.input<typeof zAddServiceItem>;
export type AddServiceItemInput = z.output<typeof zAddServiceItem>;

export type AddServicePaymentInput = z.output<typeof zAddServicePayment>;
export type ChangeServiceStatusInput = z.output<typeof zChangeServiceStatus>;
