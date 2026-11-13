/** Purchase invoices: arrivals go into stock, returns leave it, money owed follows. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from './helpers/test-db';
import { completeFirstRunSetup } from '../electron/services/auth.service';
import { getSessionUser, setSessionUser, type SessionUser } from '../electron/session';
import { createProduct, getProduct } from '../electron/services/product.service';
import { saveCashCount, cashInHand } from '../electron/services/banking.service';
import {
  saveSupplier,
  listSuppliers,
  createPurchaseInvoice,
  updatePurchaseInvoice,
  deletePurchaseInvoice,
  receivePurchaseItems,
  returnPurchaseItem,
  paySupplier,
  listPurchaseInvoices,
  deletePurchaseItem,
  deleteSupplierPayment,
} from '../electron/services/purchase.service';
import { AppError } from '../shared/errors';
import type { FirstRunSetupInput } from '../shared/validation';

let ctx: TestDatabase;
let actor: SessionUser;

const SETUP: FirstRunSetupInput = {
  shopName: 'Green Mobile',
  shopAddress: undefined,
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
  saveCashCount({ amount: 1_000_000, notes: 'Float' }, actor, ctx.db);
});

afterEach(() => {
  setSessionUser(null);
  ctx.cleanup();
});

function product(sku: string, isSerialized = false) {
  return createProduct(
    {
      sku,
      name: `Product ${sku}`,
      purchasePrice: 1000,
      sellingPrice: 1500,
      taxRate: 0,
      taxRateOverride: false,
      minimumStock: 0,
      unit: 'pcs',
      isSerialized,
      warrantyMonths: 0,
      initialStock: 0,
    },
    actor,
    ctx.db,
  );
}

const cash = () => cashInHand(ctx.db).amount;

describe('purchase invoices', () => {
  it('receives, returns for replacement and refund, and tracks what is owed', () => {
    const supplier = saveSupplier({ name: 'Acme', address: undefined, phone: '0912', isActive: true }, actor, ctx.db);
    const cable = product('CBL');
    const phone = product('PHN', true);

    let invoice = createPurchaseInvoice(
      {
        invoiceNo: 'INV-1',
        supplierId: supplier.id,
        invoiceAt: '2026-11-13T10:00',
        paymentMethod: 'COD',
        items: [
          { productId: cable.id, quantity: 10, unitCost: 1000 },
          { productId: phone.id, quantity: 2, unitCost: 50000 },
        ],
      },
      actor,
      ctx.db,
    );
    expect(invoice.total).toBe(110000);
    expect(invoice.pendingQty).toBe(12);
    const [cableLine, phoneLine] = invoice.items;

    // Serialized lines need one IMEI per unit.
    expect(() =>
      receivePurchaseItems({ invoiceId: invoice.id, items: [{ itemId: phoneLine.id, quantity: 2, serials: ['111'] }] }, actor, ctx.db),
    ).toThrow(AppError);

    invoice = receivePurchaseItems(
      {
        invoiceId: invoice.id,
        items: [
          { itemId: cableLine.id, quantity: 10 },
          { itemId: phoneLine.id, quantity: 2, serials: ['111', '222'] },
        ],
      },
      actor,
      ctx.db,
    );
    expect(getProduct(cable.id, ctx.db).stockQuantity).toBe(10);
    expect(getProduct(phone.id, ctx.db).stockQuantity).toBe(2);
    expect(invoice.pendingQty).toBe(0);

    // Lines are fixed once something arrived.
    expect(() =>
      updatePurchaseInvoice(
        { id: invoice.id, invoiceNo: 'INV-1', supplierId: supplier.id, invoiceAt: '2026-11-13T10:00', paymentMethod: 'COD', items: [{ productId: cable.id, quantity: 1, unitCost: 1 }] },
        actor,
        ctx.db,
      ),
    ).toThrow(AppError);

    // Two damaged cables go back to be replaced: out of stock, awaited again, still owed.
    invoice = returnPurchaseItem(
      { itemId: cableLine.id, quantity: 2, outcome: 'REPLACE', arrived: true, reason: 'Broken', refundAmount: 0 },
      actor,
      ctx.db,
    );
    expect(getProduct(cable.id, ctx.db).stockQuantity).toBe(8);
    expect(invoice.pendingQty).toBe(2);
    expect(invoice.total).toBe(110000);

    // Pay in full from cash.
    const before = cash();
    invoice = paySupplier({ invoiceId: invoice.id, amount: 110000, paidAt: '2026-11-13T12:00' }, actor, ctx.db);
    expect(invoice.remaining).toBe(0);
    expect(() => paySupplier({ invoiceId: invoice.id, amount: 1, paidAt: '2026-11-13T12:00' }, actor, ctx.db)).toThrow(AppError);

    // A dead phone goes back for money.
    invoice = returnPurchaseItem(
      { itemId: phoneLine.id, quantity: 1, serials: ['222'], outcome: 'REFUND', arrived: true, reason: 'Dead', refundAmount: 50000 },
      actor,
      ctx.db,
    );
    expect(getProduct(phone.id, ctx.db).stockQuantity).toBe(1);
    expect(invoice.total).toBe(60000);
    expect(invoice.paid).toBe(60000);
    expect(invoice.remaining).toBe(0);
    expect(cash()).toBe(before - 110000 + 50000);

    const acme = listSuppliers(false, ctx.db).find((s) => s.id === supplier.id)!;
    expect(acme).toMatchObject({ invoiceCount: 1, total: 60000, paid: 60000, remaining: 0 });
    expect(listPurchaseInvoices({ status: 'WAITING', page: 0, pageSize: 50 }, ctx.db).total).toBe(1);

    // Paid or delivered invoices cannot be deleted.
    expect(() => deletePurchaseInvoice(invoice.id, 'oops', actor, ctx.db)).toThrow(AppError);
  });

  it('returns units before delivery, removes untouched lines and deletes payments', () => {
    const supplier = saveSupplier({ name: 'Acme', address: undefined, phone: undefined, isActive: true }, actor, ctx.db);
    const cable = product('CBL');
    const case_ = product('CASE');
    let invoice = createPurchaseInvoice(
      {
        supplierId: supplier.id,
        invoiceAt: '2026-11-13T10:00',
        paymentMethod: 'COD',
        items: [
          { productId: cable.id, quantity: 5, unitCost: 1000 },
          { productId: case_.id, quantity: 2, unitCost: 300 },
        ],
      },
      actor,
      ctx.db,
    );
    const [cableLine, caseLine] = invoice.items;

    // Damaged on arrival: 1 refunded, 2 sent back for replacement, none touch stock.
    invoice = returnPurchaseItem({ itemId: cableLine.id, quantity: 1, outcome: 'REFUND', arrived: false, reason: 'Broken', refundAmount: 0 }, actor, ctx.db);
    invoice = returnPurchaseItem({ itemId: cableLine.id, quantity: 2, outcome: 'REPLACE', arrived: false, reason: 'Broken', refundAmount: 0 }, actor, ctx.db);
    expect(getProduct(cable.id, ctx.db).stockQuantity).toBe(0);
    expect(invoice.items[0]).toMatchObject({ pendingQty: 4, refundedQty: 1, replacedQty: 2, receivedQty: 0 });
    expect(() =>
      returnPurchaseItem({ itemId: cableLine.id, quantity: 5, outcome: 'REFUND', arrived: false, reason: 'x', refundAmount: 0 }, actor, ctx.db),
    ).toThrow(AppError);

    // A touched line stays; an untouched one can go.
    expect(() => deletePurchaseItem(cableLine.id, 'oops', actor, ctx.db)).toThrow(AppError);
    invoice = deletePurchaseItem(caseLine.id, 'Not ordered', actor, ctx.db);
    expect(invoice.items).toHaveLength(1);
    expect(invoice.total).toBe(4000);

    // Deleting a payment puts the money back.
    const before = cash();
    invoice = paySupplier({ invoiceId: invoice.id, amount: 1500, paidAt: '2026-11-13T12:00' }, actor, ctx.db);
    invoice = deleteSupplierPayment(invoice.payments[0].id, 'Wrong amount', actor, ctx.db);
    expect(invoice.paid).toBe(0);
    expect(cash()).toBe(before);
  });

  it('creates a new product with a new brand on its first delivery, and numbers the invoice', () => {
    const supplier = saveSupplier({ name: 'Acme', address: undefined, phone: undefined, isActive: true }, actor, ctx.db);
    const newProduct = { name: 'Case X', sku: 'CASE-X', brandName: 'Zeta', sellingPrice: 900, description: 'Blue' };
    let invoice = createPurchaseInvoice(
      {
        supplierId: supplier.id,
        invoiceAt: '2026-11-13T10:00',
        paymentMethod: 'BANK',
        items: [{ newProduct, quantity: 5, unitCost: 400 }],
      },
      actor,
      ctx.db,
    );
    expect(invoice.invoiceNo).toMatch(/^PI-\d{6}-0001$/);
    expect(invoice.items[0]).toMatchObject({ productId: null, productName: 'Case X', sku: 'CASE-X' });
    expect(invoice.items[0].newProduct?.brandId).toBeTruthy();

    // The same SKU cannot be ordered as new twice.
    expect(() =>
      createPurchaseInvoice(
        { supplierId: supplier.id, invoiceAt: '2026-11-13T10:00', paymentMethod: 'COD', items: [{ newProduct, quantity: 1, unitCost: 1 }] },
        actor,
        ctx.db,
      ),
    ).toThrow(AppError);

    invoice = receivePurchaseItems({ invoiceId: invoice.id, items: [{ itemId: invoice.items[0].id, quantity: 3 }] }, actor, ctx.db);
    const created = getProduct(invoice.items[0].productId!, ctx.db);
    expect(created).toMatchObject({ name: 'Case X', sku: 'CASE-X', brandName: 'Zeta', purchasePrice: 400, sellingPrice: 900, stockQuantity: 3, description: 'Blue' });
    expect(created.barcode).toBeTruthy();

    // A later order of the same product at new prices updates it on delivery.
    const reorder = createPurchaseInvoice(
      {
        supplierId: supplier.id,
        invoiceAt: '2026-11-13T11:00',
        paymentMethod: 'COD',
        items: [{ productId: created.id, quantity: 1, unitCost: 450, sellingPrice: 990 }],
      },
      actor,
      ctx.db,
    );
    expect(reorder.items[0]).toMatchObject({ sellingPrice: 990, brandName: 'Zeta', barcode: created.barcode });
    expect(getProduct(created.id, ctx.db).sellingPrice).toBe(900);
    receivePurchaseItems({ invoiceId: reorder.id, items: [{ itemId: reorder.items[0].id, quantity: 1 }] }, actor, ctx.db);
    expect(getProduct(created.id, ctx.db)).toMatchObject({ purchasePrice: 450, sellingPrice: 990, stockQuantity: 4 });

    // The rest arrives against the same product.
    receivePurchaseItems({ invoiceId: invoice.id, items: [{ itemId: invoice.items[0].id, quantity: 2 }] }, actor, ctx.db);
    expect(getProduct(created.id, ctx.db).stockQuantity).toBe(6);
  });
});
