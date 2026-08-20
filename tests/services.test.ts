/**
 * Service / repair jobs (spec §21–§23, §51, §52).
 *
 * The rules worth protecting: the status workflow, parts consuming real stock,
 * a total derived from the lines rather than typed in, and a device that cannot
 * be handed back with money still owing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from './helpers/test-db';
import { completeFirstRunSetup } from '../electron/services/auth.service';
import { getSessionUser, setSessionUser, type SessionUser } from '../electron/session';
import { createProduct, getProduct } from '../electron/services/product.service';
import { createCustomer } from '../electron/services/customer.service';
import {
  createServiceOrder,
  updateServiceOrder,
  addServiceItem,
  removeServiceItem,
  addServicePayment,
  changeServiceStatus,
  getServiceOrder,
  listServiceOrders,
  serviceBoardCounts,
  serviceSummary,
  allowedTransitions,
} from '../electron/services/service.service';
import { AppError } from '../shared/errors';
import { businessDay } from '../shared/datetime';
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
});

afterEach(() => {
  setSessionUser(null);
  ctx.cleanup();
});

function intake(overrides: Partial<{ deposit: number; estimate: number; customerId: string }> = {}) {
  return createServiceOrder(
    {
      customerId: overrides.customerId,
      customerName: 'Walk-in Repair',
      customerPhone: '0899999999',
      deviceBrand: 'Samsung',
      deviceModel: 'Galaxy S24',
      imei: '356938035643809',
      serialNumber: undefined,
      problemDescription: 'Screen cracked, touch not responding on the left side',
      initialCondition: 'Body scratched, back cover intact',
      estimatedCost: overrides.estimate ?? 350_000,
      expectedDate: undefined,
      notes: undefined,
      depositAmount: overrides.deposit ?? 0,
      depositMethod: 'CASH',
    },
    actor,
    ctx.db,
  );
}

/** A non-serialized spare part with stock. */
function makePart(stock = 5, cost = 120_000, price = 200_000) {
  return createProduct(
    {
      sku: `PART-${Math.random().toString(36).slice(2, 8)}`,
      barcode: undefined,
      name: 'Galaxy S24 Screen Assembly',
      description: undefined,
      categoryId: undefined,
      brandId: undefined,
      purchasePrice: cost,
      sellingPrice: price,
      taxRate: 0,
      taxRateOverride: false,
      minimumStock: 0,
      unit: 'pcs',
      isSerialized: false,
      warrantyMonths: 0,
      initialStock: stock,
      serials: undefined,
    },
    actor,
    ctx.db,
  );
}

describe('taking a device in (spec §21)', () => {
  it('creates the job with a number and RECEIVED status', () => {
    const { order } = intake();

    expect(order.serviceNumber).toMatch(/^SRV-\d{6}-0001$/);
    expect(order.status).toBe('RECEIVED');
    expect(order.deviceBrand).toBe('Samsung');
    expect(order.imei).toBe('356938035643809');
    expect(order.estimatedCost).toBe(350_000);
    // Nothing itemised yet, so nothing charged yet.
    expect(order.finalCost).toBe(0);
    expect(order.balance).toBe(0);
    expect(order.receivedDay).toBe(businessDay());
  });

  it('records a deposit as a real payment, not just a header number', () => {
    const { order, payments } = intake({ deposit: 100_000 });

    expect(order.depositAmount).toBe(100_000);
    expect(order.amountPaid).toBe(100_000);
    expect(payments).toHaveLength(1);
    expect(payments[0].isDeposit).toBe(1);
    expect(payments[0].amount).toBe(100_000);
  });

  it('snapshots the customer so renaming them does not rewrite the job sheet', () => {
    const customer = createCustomer(
      { name: 'Nok', phone: '0812345678', email: undefined, address: undefined, notes: undefined },
      actor,
      ctx.db,
    );
    const { order } = intake({ customerId: customer.id });
    expect(order.customerName).toBe('Nok');

    ctx.db.prepare(`UPDATE "Customer" SET name='Nok Somchai' WHERE id = ?`).run(customer.id);
    expect(getServiceOrder(order.id, ctx.db).order.customerName).toBe('Nok');
  });

  it('numbers jobs sequentially', () => {
    expect(intake().order.serviceNumber).toMatch(/-0001$/);
    expect(intake().order.serviceNumber).toMatch(/-0002$/);
  });
});

describe('parts and labour (spec §22)', () => {
  it('takes a part out of stock and records it in the ledger', () => {
    const part = makePart(5);
    const { order } = intake();

    const after = addServiceItem(
      {
        serviceOrderId: order.id,
        productId: part.id,
        description: '',
        quantity: 1,
        unitCost: 0,
        sellingPrice: 200_000,
        type: 'PART',
      },
      actor,
      ctx.db,
    );

    // Stock came off the shelf.
    expect(getProduct(part.id, ctx.db).stockQuantity).toBe(4);

    // Description and cost were taken from the product, not from the caller.
    expect(after.items[0].description).toBe('Galaxy S24 Screen Assembly');
    expect(after.items[0].unitCost).toBe(120_000);

    // Totals are derived.
    expect(after.order.finalCost).toBe(200_000);
    expect(after.order.partsCost).toBe(120_000);

    const movement = ctx.db
      .prepare(
        `SELECT transactionType, quantity, reason, referenceType FROM "InventoryTransaction"
          WHERE transactionType = 'SERVICE_USAGE'`,
      )
      .get() as { transactionType: string; quantity: number; reason: string; referenceType: string };
    expect(movement.quantity).toBe(-1);
    expect(movement.referenceType).toBe('SERVICE_ORDER');
    expect(movement.reason).toContain(order.serviceNumber);
  });

  it('adds labour without touching stock', () => {
    const { order } = intake();
    const after = addServiceItem(
      {
        serviceOrderId: order.id,
        productId: undefined,
        description: 'Screen replacement labour',
        quantity: 1,
        unitCost: 0,
        sellingPrice: 150_000,
        type: 'LABOR',
      },
      actor,
      ctx.db,
    );

    expect(after.order.finalCost).toBe(150_000);
    // Labour is not a part, so it does not count as parts cost.
    expect(after.order.partsCost).toBe(0);
    expect(
      (ctx.db.prepare(`SELECT COUNT(*) n FROM "InventoryTransaction" WHERE transactionType='SERVICE_USAGE'`).get() as { n: number }).n,
    ).toBe(0);
  });

  it('sums parts and labour into the final cost', () => {
    const part = makePart(5);
    const { order } = intake();

    addServiceItem(
      { serviceOrderId: order.id, productId: part.id, description: '', quantity: 1, unitCost: 0, sellingPrice: 200_000, type: 'PART' },
      actor,
      ctx.db,
    );
    const after = addServiceItem(
      { serviceOrderId: order.id, productId: undefined, description: 'Labour', quantity: 1, unitCost: 0, sellingPrice: 150_000, type: 'LABOR' },
      actor,
      ctx.db,
    );

    expect(after.order.finalCost).toBe(350_000);
    expect(after.order.partsCost).toBe(120_000);
  });

  it('puts the stock back when a part line is removed', () => {
    const part = makePart(5);
    const { order } = intake();

    const withPart = addServiceItem(
      { serviceOrderId: order.id, productId: part.id, description: '', quantity: 2, unitCost: 0, sellingPrice: 200_000, type: 'PART' },
      actor,
      ctx.db,
    );
    expect(getProduct(part.id, ctx.db).stockQuantity).toBe(3);

    const removed = removeServiceItem(withPart.items[0].id, actor, ctx.db);
    expect(getProduct(part.id, ctx.db).stockQuantity).toBe(5);
    expect(removed.order.finalCost).toBe(0);
    expect(removed.items).toHaveLength(0);
  });

  it('refuses to consume a serialized product as a spare part', () => {
    const phone = createProduct(
      {
        sku: 'PHONE-X',
        barcode: undefined,
        name: 'iPhone 15',
        description: undefined,
        categoryId: undefined,
        brandId: undefined,
        purchasePrice: 2_500_000,
        sellingPrice: 3_000_000,
        taxRate: 0,
        taxRateOverride: false,
        minimumStock: 0,
        unit: 'pcs',
        isSerialized: true,
        warrantyMonths: 12,
        initialStock: 0,
        serials: [{ imei1: '111222333' }],
      },
      actor,
      ctx.db,
    );
    const { order } = intake();

    expect(() =>
      addServiceItem(
        { serviceOrderId: order.id, productId: phone.id, description: '', quantity: 1, unitCost: 0, sellingPrice: 100, type: 'PART' },
        actor,
        ctx.db,
      ),
    ).toThrow(/tracked by IMEI/i);
  });

  it('blocks a part the shop does not have', () => {
    const part = makePart(1);
    const { order } = intake();

    const error = (() => {
      try {
        addServiceItem(
          { serviceOrderId: order.id, productId: part.id, description: '', quantity: 5, unitCost: 0, sellingPrice: 200_000, type: 'PART' },
          actor,
          ctx.db,
        );
      } catch (err) {
        return err as AppError;
      }
      return null;
    })();

    expect(error?.code).toBe('INSUFFICIENT_STOCK');
    // Nothing was half-applied.
    expect(getProduct(part.id, ctx.db).stockQuantity).toBe(1);
    expect(getServiceOrder(order.id, ctx.db).items).toHaveLength(0);
  });
});

describe('status workflow (spec §52)', () => {
  it('follows the workflow and stamps the dates', () => {
    const { order } = intake();

    let current = changeServiceStatus(
      { serviceOrderId: order.id, status: 'DIAGNOSING', note: undefined },
      actor,
      ctx.db,
    );
    expect(current.order.status).toBe('DIAGNOSING');

    current = changeServiceStatus(
      { serviceOrderId: order.id, status: 'REPAIRING', note: 'Customer approved' },
      actor,
      ctx.db,
    );
    expect(current.order.status).toBe('REPAIRING');
    expect(current.order.notes).toContain('Customer approved');

    current = changeServiceStatus(
      { serviceOrderId: order.id, status: 'COMPLETED', note: undefined },
      actor,
      ctx.db,
    );
    expect(current.order.status).toBe('COMPLETED');
    expect(current.order.completedDate).toBeTruthy();

    current = changeServiceStatus(
      { serviceOrderId: order.id, status: 'DELIVERED', note: undefined },
      actor,
      ctx.db,
    );
    expect(current.order.status).toBe('DELIVERED');
    expect(current.order.deliveredDate).toBeTruthy();
  });

  it('refuses to skip from received straight to delivered', () => {
    const { order } = intake();
    const error = (() => {
      try {
        changeServiceStatus({ serviceOrderId: order.id, status: 'DELIVERED', note: undefined }, actor, ctx.db);
      } catch (err) {
        return err as AppError;
      }
      return null;
    })();

    expect(error?.code).toBe('INVALID_STATE');
    expect(error?.message).toMatch(/cannot move straight to Delivered/i);
  });

  it('will not hand the device back with money still owing', () => {
    const { order } = intake();
    addServiceItem(
      { serviceOrderId: order.id, productId: undefined, description: 'Labour', quantity: 1, unitCost: 0, sellingPrice: 150_000, type: 'LABOR' },
      actor,
      ctx.db,
    );

    changeServiceStatus({ serviceOrderId: order.id, status: 'REPAIRING', note: undefined }, actor, ctx.db);
    changeServiceStatus({ serviceOrderId: order.id, status: 'COMPLETED', note: undefined }, actor, ctx.db);

    const error = (() => {
      try {
        changeServiceStatus({ serviceOrderId: order.id, status: 'DELIVERED', note: undefined }, actor, ctx.db);
      } catch (err) {
        return err as AppError;
      }
      return null;
    })();
    expect(error?.message).toMatch(/still owing/i);

    // Take the money, then it goes through.
    addServicePayment(
      { serviceOrderId: order.id, amount: 150_000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined },
      actor,
      ctx.db,
    );
    const delivered = changeServiceStatus(
      { serviceOrderId: order.id, status: 'DELIVERED', note: undefined },
      actor,
      ctx.db,
    );
    expect(delivered.order.status).toBe('DELIVERED');
    expect(delivered.order.balance).toBe(0);
  });

  it('freezes a delivered job', () => {
    const { order } = intake();
    changeServiceStatus({ serviceOrderId: order.id, status: 'REPAIRING', note: undefined }, actor, ctx.db);
    changeServiceStatus({ serviceOrderId: order.id, status: 'COMPLETED', note: undefined }, actor, ctx.db);
    changeServiceStatus({ serviceOrderId: order.id, status: 'DELIVERED', note: undefined }, actor, ctx.db);

    expect(() =>
      addServiceItem(
        { serviceOrderId: order.id, productId: undefined, description: 'Extra', quantity: 1, unitCost: 0, sellingPrice: 100, type: 'LABOR' },
        actor,
        ctx.db,
      ),
    ).toThrow(/delivered/i);

    expect(() =>
      updateServiceOrder(
        {
          id: order.id,
          deviceBrand: 'Samsung',
          deviceModel: 'Changed',
          imei: undefined,
          serialNumber: undefined,
          problemDescription: 'Changed',
          initialCondition: undefined,
          diagnosis: undefined,
          estimatedCost: 0,
          expectedDate: undefined,
          notes: undefined,
        },
        actor,
        ctx.db,
      ),
    ).toThrow(/delivered/i);
  });

  it('allows a cancellation from an early stage and then freezes it', () => {
    const { order } = intake();
    const cancelled = changeServiceStatus(
      { serviceOrderId: order.id, status: 'CANCELLED', note: 'Customer took it elsewhere' },
      actor,
      ctx.db,
    );
    expect(cancelled.order.status).toBe('CANCELLED');
    expect(allowedTransitions('CANCELLED')).toHaveLength(0);

    expect(() =>
      addServicePayment(
        { serviceOrderId: order.id, amount: 1000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined },
        actor,
        ctx.db,
      ),
    ).toThrow(/cancelled/i);
  });

  it('treats setting the same status again as a no-op', () => {
    const { order } = intake();
    expect(() =>
      changeServiceStatus({ serviceOrderId: order.id, status: 'RECEIVED', note: undefined }, actor, ctx.db),
    ).not.toThrow();
  });

  it('records every status change in the audit log', () => {
    const { order } = intake();
    changeServiceStatus({ serviceOrderId: order.id, status: 'DIAGNOSING', note: undefined }, actor, ctx.db);

    const row = ctx.db
      .prepare(
        `SELECT summary FROM "AuditLog" WHERE entityName='ServiceOrder' ORDER BY createdAt DESC LIMIT 1`,
      )
      .get() as { summary: string };
    expect(row.summary).toMatch(/Received → Diagnosing/);
  });
});

describe('payments (spec §23)', () => {
  it('tracks the balance as money comes in', () => {
    const { order } = intake({ deposit: 100_000 });
    addServiceItem(
      { serviceOrderId: order.id, productId: undefined, description: 'Labour', quantity: 1, unitCost: 0, sellingPrice: 350_000, type: 'LABOR' },
      actor,
      ctx.db,
    );

    let current = getServiceOrder(order.id, ctx.db);
    expect(current.order.finalCost).toBe(350_000);
    expect(current.order.amountPaid).toBe(100_000);
    expect(current.order.balance).toBe(250_000);

    current = addServicePayment(
      { serviceOrderId: order.id, amount: 250_000, paymentMethod: 'BANK_TRANSFER', referenceNumber: 'TRX-77', notes: undefined },
      actor,
      ctx.db,
    );
    expect(current.order.balance).toBe(0);
    expect(current.payments).toHaveLength(2);
  });

  it('refuses to take more than is owed', () => {
    const { order } = intake();
    addServiceItem(
      { serviceOrderId: order.id, productId: undefined, description: 'Labour', quantity: 1, unitCost: 0, sellingPrice: 100_000, type: 'LABOR' },
      actor,
      ctx.db,
    );

    const error = (() => {
      try {
        addServicePayment(
          { serviceOrderId: order.id, amount: 500_000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined },
          actor,
          ctx.db,
        );
      } catch (err) {
        return err as AppError;
      }
      return null;
    })();
    expect(error?.code).toBe('VALIDATION');
    expect(error?.fields?.amount).toBeTruthy();
  });

  it('refuses a payment on a job that is already settled', () => {
    const { order } = intake();
    addServiceItem(
      { serviceOrderId: order.id, productId: undefined, description: 'Labour', quantity: 1, unitCost: 0, sellingPrice: 100_000, type: 'LABOR' },
      actor,
      ctx.db,
    );
    addServicePayment(
      { serviceOrderId: order.id, amount: 100_000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined },
      actor,
      ctx.db,
    );

    expect(() =>
      addServicePayment(
        { serviceOrderId: order.id, amount: 1000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined },
        actor,
        ctx.db,
      ),
    ).toThrow(/paid in full/i);
  });
});

describe('searching and the board (spec §51, §92)', () => {
  it('finds a job by service number, phone, IMEI or model', () => {
    const { order } = intake();
    const byNumber = listServiceOrders({ search: order.serviceNumber, openOnly: false, page: 0, pageSize: 50 }, ctx.db);
    expect(byNumber.total).toBe(1);

    expect(listServiceOrders({ search: '0899999999', openOnly: false, page: 0, pageSize: 50 }, ctx.db).total).toBe(1);
    expect(listServiceOrders({ search: '356938035643809', openOnly: false, page: 0, pageSize: 50 }, ctx.db).total).toBe(1);
    expect(listServiceOrders({ search: 'galaxy', openOnly: false, page: 0, pageSize: 50 }, ctx.db).total).toBe(1);
    expect(listServiceOrders({ search: 'nothing-like-this', openOnly: false, page: 0, pageSize: 50 }, ctx.db).total).toBe(0);
  });

  it('separates open jobs from finished ones', () => {
    const first = intake();
    intake();

    changeServiceStatus({ serviceOrderId: first.order.id, status: 'REPAIRING', note: undefined }, actor, ctx.db);
    changeServiceStatus({ serviceOrderId: first.order.id, status: 'COMPLETED', note: undefined }, actor, ctx.db);
    changeServiceStatus({ serviceOrderId: first.order.id, status: 'DELIVERED', note: undefined }, actor, ctx.db);

    expect(listServiceOrders({ openOnly: true, page: 0, pageSize: 50 }, ctx.db).total).toBe(1);
    expect(listServiceOrders({ openOnly: false, page: 0, pageSize: 50 }, ctx.db).total).toBe(2);
    expect(listServiceOrders({ status: 'DELIVERED', openOnly: false, page: 0, pageSize: 50 }, ctx.db).total).toBe(1);
  });

  it('counts jobs per status for the board', () => {
    intake();
    const second = intake();
    changeServiceStatus({ serviceOrderId: second.order.id, status: 'DIAGNOSING', note: undefined }, actor, ctx.db);

    const counts = serviceBoardCounts(ctx.db);
    expect(counts.RECEIVED).toBe(1);
    expect(counts.DIAGNOSING).toBe(1);
  });
});

describe('service summary', () => {
  it('reports revenue, parts cost and profit on delivered jobs', () => {
    const part = makePart(5, 120_000, 200_000);
    const { order } = intake();

    addServiceItem(
      { serviceOrderId: order.id, productId: part.id, description: '', quantity: 1, unitCost: 0, sellingPrice: 200_000, type: 'PART' },
      actor,
      ctx.db,
    );
    addServiceItem(
      { serviceOrderId: order.id, productId: undefined, description: 'Labour', quantity: 1, unitCost: 0, sellingPrice: 150_000, type: 'LABOR' },
      actor,
      ctx.db,
    );
    addServicePayment(
      { serviceOrderId: order.id, amount: 350_000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined },
      actor,
      ctx.db,
    );
    changeServiceStatus({ serviceOrderId: order.id, status: 'REPAIRING', note: undefined }, actor, ctx.db);
    changeServiceStatus({ serviceOrderId: order.id, status: 'COMPLETED', note: undefined }, actor, ctx.db);
    changeServiceStatus({ serviceOrderId: order.id, status: 'DELIVERED', note: undefined }, actor, ctx.db);

    const today = businessDay();
    const summary = serviceSummary({ from: today, to: today }, ctx.db);

    expect(summary.received).toBe(1);
    expect(summary.delivered).toBe(1);
    expect(summary.revenue).toBe(350_000);
    expect(summary.partsCost).toBe(120_000);
    expect(summary.grossProfit).toBe(230_000);
    expect(summary.outstanding).toBe(0);
  });

  it('reports what is still owed across open jobs', () => {
    const { order } = intake();
    addServiceItem(
      { serviceOrderId: order.id, productId: undefined, description: 'Labour', quantity: 1, unitCost: 0, sellingPrice: 300_000, type: 'LABOR' },
      actor,
      ctx.db,
    );
    addServicePayment(
      { serviceOrderId: order.id, amount: 100_000, paymentMethod: 'CASH', referenceNumber: undefined, notes: undefined },
      actor,
      ctx.db,
    );

    const today = businessDay();
    expect(serviceSummary({ from: today, to: today }, ctx.db).outstanding).toBe(200_000);
  });
});
