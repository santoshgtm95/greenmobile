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
        paymentMethod: 'COD', discount: 0,
        items: [
          { productId: cable.id, freeQty: 0, quantity: 10, unitCost: 1000 },
          { productId: phone.id, freeQty: 0, quantity: 2, unitCost: 50000 },
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
        { id: invoice.id, invoiceNo: 'INV-1', supplierId: supplier.id, invoiceAt: '2026-11-13T10:00', paymentMethod: 'COD', discount: 0, items: [{ productId: cable.id, freeQty: 0, quantity: 1, unitCost: 1 }] },
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
        paymentMethod: 'COD', discount: 0,
        items: [
          { productId: cable.id, freeQty: 0, quantity: 5, unitCost: 1000 },
          { productId: case_.id, freeQty: 0, quantity: 2, unitCost: 300 },
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
        discount: 0,
        items: [{ newProduct, freeQty: 0, quantity: 5, unitCost: 400 }],
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
        { supplierId: supplier.id, invoiceAt: '2026-11-13T10:00', paymentMethod: 'COD', discount: 0, items: [{ newProduct, freeQty: 0, quantity: 1, unitCost: 1 }] },
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
        paymentMethod: 'COD', discount: 0,
        items: [{ productId: created.id, freeQty: 0, quantity: 1, unitCost: 450, sellingPrice: 990 }],
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

  it('does not charge free units and takes the discount off the total', () => {
    const supplier = saveSupplier({ name: 'Acme', address: undefined, phone: undefined, isActive: true }, actor, ctx.db);
    const cable = product('CBL');
    const input = {
      supplierId: supplier.id,
      invoiceAt: '2026-11-13T10:00',
      paymentMethod: 'COD' as const,
      discount: 500,
      // Buy 10, get 2 free.
      items: [{ productId: cable.id, quantity: 12, freeQty: 2, unitCost: 1000 }],
    };
    let invoice = createPurchaseInvoice(input, actor, ctx.db);
    expect(invoice).toMatchObject({ subtotal: 10000, discount: 500, total: 9500, remaining: 9500, pendingQty: 12 });

    invoice = receivePurchaseItems({ invoiceId: invoice.id, items: [{ itemId: invoice.items[0].id, quantity: 12 }] }, actor, ctx.db);
    expect(getProduct(cable.id, ctx.db)).toMatchObject({ stockQuantity: 12, supplierName: 'Acme' });

    expect(() => createPurchaseInvoice({ ...input, discount: 10001 }, actor, ctx.db)).toThrow(AppError);
  });

  it('orders a colour on a line and adds the delivered units to it', () => {
    const supplier = saveSupplier({ name: 'Acme', address: undefined, phone: undefined, isActive: true }, actor, ctx.db);
    const case_ = createProduct(
      {
        sku: 'CASE-C',
        name: 'Case',
        purchasePrice: 1000,
        sellingPrice: 1500,
        taxRate: 0,
        taxRateOverride: false,
        minimumStock: 0,
        unit: 'pcs',
        isSerialized: false,
        warrantyMonths: 0,
        initialStock: 0,
        colors: [{ name: 'Red', quantity: 0 }, { name: 'Blue', quantity: 0 }],
      },
      actor,
      ctx.db,
    );
    const order = (color: string) =>
      createPurchaseInvoice(
        {
          supplierId: supplier.id,
          invoiceAt: '2026-11-13T10:00',
          paymentMethod: 'COD',
          discount: 0,
          items: [{ productId: case_.id, freeQty: 0, quantity: 3, unitCost: 1000, color }],
        },
        actor,
        ctx.db,
      );
    expect(() => order('Green')).toThrow(AppError);

    let invoice = order('blue');
    expect(invoice.items[0].color).toBe('Blue');
    invoice = receivePurchaseItems({ invoiceId: invoice.id, items: [{ itemId: invoice.items[0].id, quantity: 3 }] }, actor, ctx.db);
    expect(getProduct(case_.id, ctx.db).colors).toEqual([{ name: 'Red', quantity: 0 }, { name: 'Blue', quantity: 3 }]);

    // One broken case goes back: off stock and off its colour.
    returnPurchaseItem(
      { itemId: invoice.items[0].id, quantity: 1, outcome: 'REPLACE', arrived: true, reason: 'Cracked', refundAmount: 0 },
      actor,
      ctx.db,
    );
    expect(getProduct(case_.id, ctx.db).colors[1]).toEqual({ name: 'Blue', quantity: 2 });
  });

  it('generates P- codes for new products left without a SKU, skipping ones on order', () => {
    const supplier = saveSupplier({ name: 'Acme', address: undefined, phone: undefined, isActive: true }, actor, ctx.db);
    const draft = (name: string, sku = '') => ({ newProduct: { name, sku, sellingPrice: 900 }, freeQty: 0, quantity: 1, unitCost: 400 });
    const first = createPurchaseInvoice(
      {
        supplierId: supplier.id,
        invoiceAt: '2026-11-13T10:00',
        paymentMethod: 'COD',
        discount: 0,
        // A typed P- code on the same invoice is never handed out again.
        items: [draft('A'), draft('B', 'P-00002'), draft('C')],
      },
      actor,
      ctx.db,
    );
    expect(first.items.map((i) => i.sku)).toEqual(['P-00001', 'P-00002', 'P-00003']);

    // Codes on an undelivered invoice are taken, and so is the next one in Stocks.
    const second = createPurchaseInvoice(
      { supplierId: supplier.id, invoiceAt: '2026-11-13T10:00', paymentMethod: 'COD', discount: 0, items: [draft('D')] },
      actor,
      ctx.db,
    );
    expect(second.items[0].sku).toBe('P-00004');
  });

  it('orders a new product by colour and creates it with those colours on delivery', () => {
    const supplier = saveSupplier({ name: 'Acme', address: undefined, phone: undefined, isActive: true }, actor, ctx.db);
    const newProduct = {
      name: 'Case Y',
      sku: 'CASE-Y',
      sellingPrice: 900,
      colors: [{ name: 'Red', quantity: 6 }, { name: 'Blue', quantity: 4 }],
    };
    const order = (colors: typeof newProduct.colors) =>
      createPurchaseInvoice(
        {
          supplierId: supplier.id,
          invoiceAt: '2026-11-13T10:00',
          paymentMethod: 'COD',
          discount: 0,
          items: [{ newProduct: { ...newProduct, colors }, freeQty: 2, quantity: 10, unitCost: 400 }],
        },
        actor,
        ctx.db,
      );
    // The colours cannot add up to more than the units ordered.
    expect(() => order([{ name: 'Red', quantity: 11 }])).toThrow();

    let invoice = order(newProduct.colors);
    expect(invoice.items[0].newProduct?.colors).toEqual(newProduct.colors);
    const itemId = invoice.items[0].id;
    invoice = receivePurchaseItems(
      {
        invoiceId: invoice.id,
        items: [
          { itemId, quantity: 6, color: 'Red' },
          { itemId, quantity: 3, color: 'Blue' },
        ],
      },
      actor,
      ctx.db,
    );
    const created = getProduct(invoice.items[0].productId!, ctx.db);
    expect(created).toMatchObject({ stockQuantity: 9, colors: [{ name: 'Red', quantity: 6 }, { name: 'Blue', quantity: 3 }] });
    expect(invoice.items[0].colors).toEqual(['Red', 'Blue']);
  });

  it('receives phones by colour, adding a colour the product does not have yet', () => {
    const supplier = saveSupplier({ name: 'Acme', address: undefined, phone: undefined, isActive: true }, actor, ctx.db);
    const phone = product('PH', true);
    let invoice = createPurchaseInvoice(
      {
        supplierId: supplier.id,
        invoiceAt: '2026-11-13T10:00',
        paymentMethod: 'COD',
        discount: 0,
        items: [{ productId: phone.id, freeQty: 0, quantity: 3, unitCost: 1000 }],
      },
      actor,
      ctx.db,
    );
    const itemId = invoice.items[0].id;
    // One entry per colour for the same line; together they may not exceed what is awaited.
    expect(() =>
      receivePurchaseItems(
        {
          invoiceId: invoice.id,
          items: [
            { itemId, quantity: 2, serials: ['B1', 'B2'], color: 'Black' },
            { itemId, quantity: 2, serials: ['W1', 'W2'], color: 'White' },
          ],
        },
        actor,
        ctx.db,
      ),
    ).toThrow(AppError);

    invoice = receivePurchaseItems(
      {
        invoiceId: invoice.id,
        items: [
          { itemId, quantity: 2, serials: ['B1', 'B2'], color: 'Black' },
          { itemId, quantity: 1, serials: ['W1'], color: 'White' },
        ],
      },
      actor,
      ctx.db,
    );
    expect(invoice.pendingQty).toBe(0);
    expect(invoice.items[0].colors).toEqual(['Black', 'White']);
    expect(getProduct(phone.id, ctx.db)).toMatchObject({
      stockQuantity: 3,
      colors: [{ name: 'Black', quantity: 2 }, { name: 'White', quantity: 1 }],
    });
  });
});
