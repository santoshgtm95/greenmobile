/**
 * Expenses, product purchases, POS sales and service payments move real money:
 * cash in hand, or the registered shop account chosen for a non-cash payment.
 * Each movement must change the right balance and appear in that history.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from './helpers/test-db';
import { completeFirstRunSetup } from '../electron/services/auth.service';
import { getSessionUser, setSessionUser, type SessionUser } from '../electron/session';
import {
  cashInHand,
  getShopBankAccount,
  getShopBankAccountHistory,
  listCashHistory,
  saveBankAccount,
  saveCashCount,
  saveShopBankAccount,
} from '../electron/services/banking.service';
import {
  createExpense,
  deleteExpense,
  listExpenseCategories,
  updateExpense,
} from '../electron/services/expense.service';
import { createProduct } from '../electron/services/product.service';
import { cancelSale, createSale, refundSale } from '../electron/services/sale.service';
import { addServiceItem, addServicePayment, createServiceOrder } from '../electron/services/service.service';
import { businessDay } from '../shared/datetime';
import { zCreateExpense, zSalePayment, type FirstRunSetupInput } from '../shared/validation';

let ctx: TestDatabase;
let actor: SessionUser;
let shopAccount: string;
let rent: string;

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

beforeEach(() => {
  ctx = createTestDatabase();
  setSessionUser(null);
  completeFirstRunSetup(SETUP, ctx.db);
  actor = getSessionUser()!;
  const kbz = saveBankAccount({ name: 'Kanbawza', key: 'Kpay', description: undefined, isActive: true }, actor, ctx.db);
  shopAccount = saveShopBankAccount(
    { bankAccountId: kbz.id, accountNumber: '001-22-3333', accountName: 'Green Mobile', balance: OPENING, isActive: true },
    actor,
    ctx.db,
  ).id;
  rent = listExpenseCategories(false, ctx.db).find((c) => c.name === 'Rent')!.id;
  saveCashCount({ amount: 1_000_000, notes: 'Till' }, actor, ctx.db);
});

afterEach(() => {
  setSessionUser(null);
  ctx.cleanup();
});

const cash = () => cashInHand(ctx.db).amount;
// The account starts with OPENING in it, so expenses can be paid from it; read as the change since.
const OPENING = 1_000_000;
const bank = () => getShopBankAccount(shopAccount, ctx.db).balance - OPENING;

function product(stock: number, purchaseShopAccountId?: string) {
  return createProduct(
    {
      sku: `SKU-${Math.random().toString(36).slice(2, 8)}`,
      barcode: undefined,
      name: 'USB-C Cable',
      description: undefined,
      categoryId: undefined,
      brandId: undefined,
      purchasePrice: 8_000,
      sellingPrice: 10_000,
      taxRate: 0,
      taxRateOverride: false,
      minimumStock: 0,
      unit: 'pcs',
      isSerialized: false,
      warrantyMonths: 0,
      initialStock: stock,
      serials: undefined,
      purchaseShopAccountId,
    },
    actor,
    ctx.db,
  );
}

describe('expenses', () => {
  it('cash comes out of cash in hand, bank out of the chosen account', () => {
    createExpense(
      { categoryId: rent, expenseDay: businessDay(), description: 'Rent', amount: 300_000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined },
      actor,
      ctx.db,
    );
    createExpense(
      { categoryId: rent, expenseDay: businessDay(), description: 'Power', amount: 50_000, paymentMethod: 'BANK_TRANSFER', shopAccountId: shopAccount, referenceNumber: 'TX1', notes: undefined },
      actor,
      ctx.db,
    );
    expect(cash()).toBe(700_000);
    expect(bank()).toBe(-50_000);
    expect(listCashHistory({ page: 0, pageSize: 10 }, ctx.db).rows[0].source).toBe('Expense');
    const history = getShopBankAccountHistory({ id: shopAccount }, ctx.db);
    expect(history.transactions.map((i) => [i.typeLabel, i.outAmount])).toEqual([['Expense', 50_000]]);
  });

  it('an edit moves the difference; a delete puts it all back', () => {
    const expense = createExpense(
      { categoryId: rent, expenseDay: businessDay(), description: 'Rent', amount: 300_000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined },
      actor,
      ctx.db,
    );
    // Now paid by bank, and less.
    updateExpense(
      { id: expense.id, categoryId: rent, expenseDay: businessDay(), description: 'Rent', amount: 200_000, paymentMethod: 'BANK_TRANSFER', shopAccountId: shopAccount, referenceNumber: undefined, notes: undefined },
      actor,
      ctx.db,
    );
    expect(cash()).toBe(1_000_000);
    expect(bank()).toBe(-200_000);

    deleteExpense(expense.id, 'Entered twice', actor, ctx.db);
    expect(bank()).toBe(0);
  });

  it('leaves expenses from before the upgrade alone when deleted', () => {
    const expense = createExpense(
      { categoryId: rent, expenseDay: businessDay(), description: 'Old', amount: 100_000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined },
      actor,
      ctx.db,
    );
    ctx.db.prepare(`UPDATE "Expense" SET moneyLinked = 0 WHERE id = ?`).run(expense.id);
    const before = cash();
    deleteExpense(expense.id, 'Old record', actor, ctx.db);
    expect(cash()).toBe(before);
  });

  it('refuses a bank expense without an account', () => {
    expect(
      zCreateExpense.safeParse({ categoryId: rent, expenseDay: businessDay(), description: 'x', amount: 1, paymentMethod: 'BANK_TRANSFER' }).success,
    ).toBe(false);
  });

  it('refuses to pay more than cash in hand or the account holds', () => {
    const spend = (amount: number, shopAccountId?: string) => () =>
      createExpense(
        { categoryId: rent, expenseDay: businessDay(), description: 'Too much', amount, paymentMethod: shopAccountId ? 'BANK_TRANSFER' : 'CASH', shopAccountId, referenceNumber: shopAccountId && 'TX', notes: undefined },
        actor,
        ctx.db,
      );
    expect(spend(1_000_001)).toThrow(/Not enough in cash in hand/);
    expect(spend(OPENING + 1, shopAccount)).toThrow(/Not enough in Kanbawza 001-22-3333/);
    expect([cash(), bank()]).toEqual([1_000_000, 0]);
    // Exactly what is there is fine.
    spend(1_000_000)();
    expect(cash()).toBe(0);
  });
});

describe('product purchases', () => {
  it('pays for the opening stock from cash or the chosen account', () => {
    product(3); // 3 × 8,000 in cash
    product(2, shopAccount); // 2 × 8,000 from the bank
    product(0, shopAccount); // nothing bought, nothing paid
    expect(cash()).toBe(1_000_000 - 24_000);
    expect(bank()).toBe(-16_000);
  });
});

describe('POS sales', () => {
  it('puts cash (less change) in the drawer and the rest in its account; cancelling takes it back out', () => {
    const p = product(10);
    const startCash = cash();
    const { sale } = createSale(
      {
        customerId: undefined,
        items: [{ productId: p.id, quantity: 2, productSerialId: undefined }], // 20,000
        discountAmount: 0,
        payments: [
          { amount: 15_000, paymentMethod: 'MOBILE_PAYMENT', shopAccountId: shopAccount, referenceNumber: 'KPAY-1', notes: undefined },
          { amount: 10_000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined }, // 5,000 change
        ],
        notes: undefined,
      },
      actor,
      ctx.db,
    );
    expect(cash()).toBe(startCash + 5_000);
    expect(bank()).toBe(15_000);

    cancelSale(sale.id, 'Wrong items', actor, ctx.db);
    expect(cash()).toBe(startCash);
    expect(bank()).toBe(0);
  });

  it('pays a refund out of the chosen account', () => {
    const p = product(10);
    const { sale, items } = createSale(
      {
        customerId: undefined,
        items: [{ productId: p.id, quantity: 1, productSerialId: undefined }],
        discountAmount: 0,
        payments: [{ amount: 10_000, paymentMethod: 'BANK_TRANSFER', shopAccountId: shopAccount, referenceNumber: 'TX', notes: undefined }],
        notes: undefined,
      },
      actor,
      ctx.db,
    );
    refundSale(
      { saleId: sale.id, items: [{ saleItemId: items[0].id, quantity: 1, isDefective: false }], reason: 'Changed mind', refundMethod: 'BANK_TRANSFER', shopAccountId: shopAccount, notes: undefined },
      actor,
      ctx.db,
    );
    expect(bank()).toBe(0);
  });

  it('refuses a non-cash payment without an account', () => {
    expect(zSalePayment.safeParse({ amount: 1, paymentMethod: 'CREDIT_CARD' }).success).toBe(false);
    expect(zSalePayment.safeParse({ amount: 1, paymentMethod: 'CASH' }).success).toBe(true);
  });
});

describe('service payments', () => {
  it('puts the deposit and later payments where they were paid', () => {
    const detail = createServiceOrder(
      {
        customerId: undefined,
        customerName: 'Walk-in',
        customerPhone: '0899999999',
        deviceBrand: 'Samsung',
        deviceModel: 'A15',
        imei: undefined,
        serialNumber: undefined,
        problemDescription: 'Screen',
        initialCondition: undefined,
        estimatedCost: 100_000,
        expectedDate: undefined,
        notes: undefined,
        depositAmount: 50_000,
        depositMethod: 'BANK_TRANSFER',
        depositShopAccountId: shopAccount,
      },
      actor,
      ctx.db,
    );
    expect(bank()).toBe(50_000);

    addServiceItem(
      { serviceOrderId: detail.order.id, productId: undefined, description: 'Labour', quantity: 1, unitCost: 0, sellingPrice: 100_000, type: 'LABOR' },
      actor,
      ctx.db,
    );
    const startCash = cash();
    addServicePayment(
      { serviceOrderId: detail.order.id, amount: 50_000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined },
      actor,
      ctx.db,
    );
    expect(cash()).toBe(startCash + 50_000);
    expect(listCashHistory({ page: 0, pageSize: 1 }, ctx.db).rows[0].source).toBe('Service payment');
  });
});
