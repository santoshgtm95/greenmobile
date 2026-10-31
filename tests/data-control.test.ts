/**
 * Settings › Data Control wipes one module and leaves every other module's
 * data exactly as it was.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from './helpers/test-db';
import { completeFirstRunSetup } from '../electron/services/auth.service';
import { getSessionUser, setSessionUser, type SessionUser } from '../electron/session';
import {
  cashInHand,
  getShopBankAccount,
  saveBankAccount,
  saveCashCount,
  saveShopBankAccount,
} from '../electron/services/banking.service';
import { createExpense, deleteExpense, listExpenseCategories } from '../electron/services/expense.service';
import { createProduct } from '../electron/services/product.service';
import { createSale } from '../electron/services/sale.service';
import { createServiceOrder } from '../electron/services/service.service';
import { purgeModule } from '../electron/services/data-control.service';
import { businessDay } from '../shared/datetime';
import { zPurgeModule, type FirstRunSetupInput } from '../shared/validation';

let ctx: TestDatabase;
let actor: SessionUser;
let shopAccount: string;
let expenseId: string;

const SETUP: FirstRunSetupInput = {
  shopName: 'Green Mobile',
  shopAddress: '',
  shopPhone: undefined,
  shopEmail: undefined,
  fullName: 'Owner',
  username: 'owner',
  password: 'owner-pass',
  confirmPassword: 'owner-pass',
  currency: 'THB',
  taxEnabled: false,
  taxRate: 0,
  taxMode: 'EXCLUSIVE',
  receiptWidth: '80mm',
  backupLocation: undefined,
};

const count = (table: string) =>
  (ctx.db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;

/** One of everything: a product, a sale, a repair job, an expense and banking. */
beforeEach(() => {
  ctx = createTestDatabase();
  setSessionUser(null);
  completeFirstRunSetup(SETUP, ctx.db);
  actor = getSessionUser()!;

  const kbz = saveBankAccount({ name: 'Kanbawza', key: 'Kpay', description: undefined, isActive: true }, actor, ctx.db);
  shopAccount = saveShopBankAccount(
    { bankAccountId: kbz.id, accountNumber: '001', accountName: 'Green Mobile', balance: 500_000, isActive: true },
    actor,
    ctx.db,
  ).id;
  saveCashCount({ amount: 1_000_000, notes: 'Till' }, actor, ctx.db);

  const product = createProduct(
    {
      sku: 'CABLE', barcode: undefined, name: 'Cable', description: undefined, categoryId: undefined,
      brandId: undefined, purchasePrice: 8_000, sellingPrice: 10_000, taxRate: 0, taxRateOverride: false,
      minimumStock: 0, unit: 'pcs', isSerialized: false, warrantyMonths: 0, initialStock: 5, serials: undefined,
    },
    actor,
    ctx.db,
  );
  createSale(
    {
      customerId: undefined,
      items: [{ productId: product.id, quantity: 1, productSerialId: undefined }],
      discountAmount: 0,
      payments: [{ amount: 10_000, paymentMethod: 'BANK_TRANSFER', shopAccountId: shopAccount, referenceNumber: 'T', notes: undefined }],
      notes: undefined,
    },
    actor,
    ctx.db,
  );
  createServiceOrder(
    {
      customerId: undefined, customerName: 'Walk-in', customerPhone: '0899999999', deviceBrand: 'Samsung',
      deviceModel: 'A15', imei: undefined, serialNumber: undefined, problemDescription: 'Screen',
      initialCondition: undefined, estimatedCost: 100_000, expectedDate: undefined, notes: undefined,
      depositAmount: 20_000, depositMethod: 'CASH',
    },
    actor,
    ctx.db,
  );
  expenseId = createExpense(
    {
      categoryId: listExpenseCategories(false, ctx.db)[0].id, expenseDay: businessDay(), description: 'Rent',
      amount: 50_000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined,
    },
    actor,
    ctx.db,
  ).id;
});

afterEach(() => {
  setSessionUser(null);
  ctx.cleanup();
});

describe('data control', () => {
  it('expenses: removes expenses only', () => {
    const cash = cashInHand(ctx.db).amount;
    purgeModule('EXPENSES', actor, ctx.db);
    expect(count('Expense')).toBe(0);
    expect(count('ExpenseCategory')).toBeGreaterThan(0);
    expect([count('Sale'), count('Product'), count('ServiceOrder')]).toEqual([1, 1, 1]);
    expect(cashInHand(ctx.db).amount).toBe(cash);
  });

  it('sales: removes invoices and payments, keeps products, stock and money', () => {
    const balance = getShopBankAccount(shopAccount, ctx.db).balance;
    purgeModule('SALES', actor, ctx.db);
    expect([count('Sale'), count('SaleItem'), count('Payment')]).toEqual([0, 0, 0]);
    expect(count('Product')).toBe(1);
    expect((ctx.db.prepare(`SELECT stockQuantity FROM "Product"`).get() as { stockQuantity: number }).stockQuantity).toBe(4);
    expect(getShopBankAccount(shopAccount, ctx.db).balance).toBe(balance);
  });

  it('products: refused while a sale uses them, then removed with stock history', () => {
    expect(() => purgeModule('PRODUCTS', actor, ctx.db)).toThrow(/Delete Sales and Services/);
    expect(count('Product')).toBe(1);

    purgeModule('SALES', actor, ctx.db);
    purgeModule('PRODUCTS', actor, ctx.db);
    expect([count('Product'), count('InventoryTransaction')]).toEqual([0, 0]);
    expect([count('Expense'), count('ServiceOrder')]).toEqual([1, 1]);
  });

  it('services: removes jobs with their payments', () => {
    purgeModule('SERVICES', actor, ctx.db);
    expect([count('ServiceOrder'), count('ServicePayment')]).toEqual([0, 0]);
    expect([count('Sale'), count('Expense'), count('Product')]).toEqual([1, 1, 1]);
  });

  it('banking: clears every movement and balance, keeps accounts, unlinks other modules', () => {
    purgeModule('BANKING', actor, ctx.db);
    expect([count('CashCount'), count('ShopAccountEntry'), count('BankTransaction')]).toEqual([0, 0, 0]);
    expect(count('ShopBankAccount')).toBe(1);
    expect(getShopBankAccount(shopAccount, ctx.db).balance).toBe(0);
    expect(cashInHand(ctx.db).recorded).toBe(false);
    expect([count('Sale'), count('Expense'), count('ServiceOrder'), count('Product')]).toEqual([1, 1, 1, 1]);

    // Deleting an old expense afterwards must not put money back into the cleared ledger.
    deleteExpense(expenseId, 'Test', actor, ctx.db);
    expect(count('CashCount')).toBe(0);
  });

  it('only deletes when the confirmation word is sent', () => {
    expect(zPurgeModule.safeParse({ module: 'SALES', confirm: 'delete' }).success).toBe(false);
    expect(zPurgeModule.safeParse({ module: 'SALES', confirm: 'DELETE' }).success).toBe(true);
  });
});
