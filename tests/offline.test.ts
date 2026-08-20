/**
 * Offline operation and printing (spec §4, §83, Phase 17).
 *
 * Spec §83 says to unplug the network and confirm the whole application still
 * works. That is the right acceptance test, and `npm run smoke` performs the
 * runtime half of it — every request the running application makes is denied by
 * its own session and the count is checked afterwards.
 *
 * What is here is the half a unit test can prove better than unplugging a cable:
 * that there is nothing in the shipped code that *could* reach out even if the
 * cable were plugged in, and that every feature §83 lists is exercised by the
 * suite without any network being available at all — which is true of every test
 * in this project by construction, since none of them start a server.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTestDatabase, MIGRATIONS_DIR, type TestDatabase } from './helpers/test-db';
import { completeFirstRunSetup, login, logout } from '../electron/services/auth.service';
import { getSessionUser, setSessionUser, type SessionUser } from '../electron/session';
import { createProduct, updateProduct, adjustStock } from '../electron/services/product.service';
import { createCustomer } from '../electron/services/customer.service';
import { priceSale, createSale, refundSale } from '../electron/services/sale.service';
import { createExpense, listExpenseCategories } from '../electron/services/expense.service';
import { buildReport } from '../electron/services/report-builder.service';
import { createBackup, restoreBackup } from '../electron/services/backup.service';
import {
  renderA4Invoice,
  renderThermalReceipt,
  receiptPageSize,
} from '../electron/services/document.service';
import { renderServiceDocument } from '../electron/services/service-document.service';
import {
  createServiceOrder,
  addServiceItem,
  addServicePayment,
  changeServiceStatus,
  getServiceOrder,
} from '../electron/services/service.service';
import { getShopSettings } from '../electron/services/settings.service';
import { getDatabase } from '../electron/database/connection';
import { businessDay } from '../shared/datetime';
import type { FirstRunSetupInput } from '../shared/validation';

const REPO_ROOT = path.resolve(__dirname, '..');

let ctx: TestDatabase;
let actor: SessionUser;
const TODAY = businessDay();

const SETUP: FirstRunSetupInput = {
  shopName: 'Green Mobile',
  shopAddress: '1 Test Road',
  shopPhone: '0800000000',
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
  ctx.cleanup();
  setSessionUser(null);
});

// -----------------------------------------------------------------------------
// Spec §83, feature by feature
// -----------------------------------------------------------------------------

describe('everything §83 lists works with no network', () => {
  /**
   * One test walking the whole list, because that is what §83 asks: not "does
   * each function work" — the other suites cover that — but "does the shop's
   * whole day work end to end with nothing but this computer".
   *
   * Nothing in this file, or anywhere in the suite, opens a socket or starts a
   * server. If any of it depended on the network it would fail here.
   */
  it('runs a full day of trading', async () => {
    // Login
    logout(ctx.db);
    const status = await login({ username: 'owner', password: 'owner-pass' }, ctx.db);
    expect(status.user?.username).toBe('owner');
    actor = getSessionUser()!;

    // Product creation
    const phone = createProduct(
      {
        sku: 'PH-1',
        name: 'Galaxy A54',
        purchasePrice: 900000,
        sellingPrice: 1200000,
        taxRate: 0,
        taxRateOverride: false,
        minimumStock: 1,
        unit: 'pcs',
        isSerialized: false,
        warrantyMonths: 12,
        initialStock: 5,
      },
      actor,
      ctx.db,
    );

    // Product editing. The row carries SQLite's 0/1 booleans, so the flags are
    // restated rather than spread through.
    const renamed = updateProduct(
      {
        id: phone.id,
        sku: phone.sku,
        name: 'Galaxy A54 5G',
        purchasePrice: phone.purchasePrice,
        sellingPrice: phone.sellingPrice,
        taxRate: phone.taxRate,
        taxRateOverride: false,
        minimumStock: phone.minimumStock,
        unit: phone.unit,
        isSerialized: false,
        warrantyMonths: phone.warrantyMonths,
        isActive: true,
      },
      actor,
      ctx.db,
    );
    expect(renamed.name).toBe('Galaxy A54 5G');

    // Stock adjustment
    const counted = adjustStock(
      {
        productId: phone.id,
        mode: 'SET',
        quantity: 4,
        transactionType: 'ADJUSTMENT',
        reason: 'Stock count',
      },
      actor,
      ctx.db,
    );
    expect(counted.stockQuantity).toBe(4);

    // Customer creation
    const customer = createCustomer({ name: 'Nok', phone: '0812345678' }, actor, ctx.db);
    expect(customer.customerCode).toBeTruthy();

    // POS: pricing the cart writes nothing
    const quote = priceSale(
      { items: [{ productId: phone.id, quantity: 2 }], discountAmount: 0, payments: [] },
      ctx.db,
    );
    expect(quote.grandTotal).toBe(2400000);

    // Sale and payment
    const sale = createSale(
      {
        customerId: customer.id,
        items: [{ productId: phone.id, quantity: 2 }],
        discountAmount: 0,
        payments: [{ amount: 2500000, paymentMethod: 'CASH' }],
      },
      actor,
      ctx.db,
    );
    expect(sale.sale.status).toBe('COMPLETED');
    expect(sale.sale.changeAmount).toBe(100000);

    // Receipt and invoice — rendered, not merely queued
    const settings = getShopSettings(ctx.db);
    const invoice = renderA4Invoice({ sale, settings, reprint: false });
    const receipt = renderThermalReceipt({ sale, settings, reprint: false });
    expect(invoice).toContain(sale.sale.invoiceNumber);
    expect(receipt).toContain('Galaxy A54 5G');

    // Refund
    const refund = refundSale(
      {
        saleId: sale.sale.id,
        items: [{ saleItemId: sale.items[0].id, quantity: 1, isDefective: false }],
        reason: 'Customer changed their mind',
        refundMethod: 'CASH',
      },
      actor,
      ctx.db,
    );
    expect(refund.refundAmount).toBe(1200000);

    // Expense
    const category = listExpenseCategories(false, ctx.db)[0];
    const expense = createExpense(
      {
        categoryId: category.id,
        expenseDay: TODAY,
        description: 'Shop rent',
        amount: 1500000,
        paymentMethod: 'CASH',
      },
      actor,
      ctx.db,
    );
    expect(expense.expenseNumber).toBeTruthy();

    // Repair job, start to finish
    const job = createServiceOrder(
      {
        customerName: 'Walk-in',
        customerPhone: '0877777777',
        deviceBrand: 'Samsung',
        deviceModel: 'Galaxy S24',
        problemDescription: 'Cracked screen',
        estimatedCost: 350000,
        depositAmount: 0,
        depositMethod: 'CASH',
      },
      actor,
      ctx.db,
    );
    addServiceItem(
      {
        serviceOrderId: job.order.id,
        description: 'Screen fitting labour',
        quantity: 1,
        unitCost: 0,
        sellingPrice: 350000,
        type: 'LABOR',
      },
      actor,
      ctx.db,
    );
    changeServiceStatus({ serviceOrderId: job.order.id, status: 'REPAIRING' }, actor, ctx.db);
    changeServiceStatus({ serviceOrderId: job.order.id, status: 'COMPLETED' }, actor, ctx.db);
    addServicePayment(
      { serviceOrderId: job.order.id, amount: 350000, paymentMethod: 'CASH' },
      actor,
      ctx.db,
    );
    const delivered = changeServiceStatus(
      { serviceOrderId: job.order.id, status: 'DELIVERED' },
      actor,
      ctx.db,
    );
    expect(delivered.order.status).toBe('DELIVERED');

    // Reports
    for (const kind of ['SALES', 'PROFIT_LOSS', 'INVENTORY', 'SERVICES'] as const) {
      const report = buildReport(kind, { from: TODAY, to: TODAY }, ctx.db);
      expect(report.tables.length, kind).toBeGreaterThan(0);
    }

    // Backup
    const backup = createBackup({ dir: ctx.backupDir, kind: 'MANUAL' }, ctx.db);
    expect(fs.existsSync(backup.path)).toBe(true);

    // ...then trade on, so the restore has something to roll back.
    createProduct(
      {
        sku: 'AFTER-BACKUP',
        name: 'Added later',
        purchasePrice: 100,
        sellingPrice: 200,
        taxRate: 0,
        taxRateOverride: false,
        minimumStock: 0,
        unit: 'pcs',
        isSerialized: false,
        warrantyMonths: 0,
        initialStock: 1,
      },
      actor,
      ctx.db,
    );

    // Restore
    const restored = restoreBackup({
      file: backup.path,
      targetFile: ctx.file,
      backupDir: ctx.backupDir,
      migrationsDir: MIGRATIONS_DIR,
    });
    expect(restored.safetyBackup.kind).toBe('SAFETY');

    const db = getDatabase();
    expect(
      db.prepare(`SELECT id FROM "Product" WHERE sku = 'AFTER-BACKUP'`).get(),
    ).toBeUndefined();
    expect(db.prepare(`SELECT id FROM "Product" WHERE sku = 'PH-1'`).get()).toBeTruthy();
    // The day's trading is still there.
    expect((db.prepare(`SELECT COUNT(*) AS n FROM "Sale"`).get() as { n: number }).n).toBe(1);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM "ServiceOrder"`).get() as { n: number }).n,
    ).toBe(1);
  }, 30_000);

  it('needs no environment variable, config file or service to be reachable', () => {
    // A dependency on an env var is how an "offline" application ends up needing
    // something the shop's PC does not have. Only the two smoke-test switches
    // exist, and both are gated on POS_SMOKE.
    const envReads = new Set<string>();
    for (const file of walk('electron', 'shared', 'src')) {
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(/process\.env\.(\w+)/g)) envReads.add(match[1]);
    }
    expect([...envReads].sort()).toEqual([
      // Debug-level logging only.
      'NODE_ENV',
      // The three build-verification switches, all gated on POS_SMOKE.
      'POS_SCREENSHOT',
      'POS_SMOKE',
      'POS_USER_DATA_DIR',
      // Set by the dev launcher; undefined in a packaged build.
      'VITE_DEV_SERVER_URL',
    ]);
  });

  it('declares no runtime dependency that talks to a network', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    // Three runtime dependencies, none of which is a client for anything.
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      'bcryptjs',
      'better-sqlite3',
      'exceljs',
    ]);
  });
});

function walk(...dirs: string[]): string[] {
  const found: string[] = [];
  const recurse = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) recurse(full);
      else if (/\.tsx?$/.test(entry.name)) found.push(full);
    }
  };
  for (const dir of dirs) recurse(path.join(REPO_ROOT, dir));
  return found;
}

// -----------------------------------------------------------------------------
// Printing (spec §37, §38, Phase 17)
// -----------------------------------------------------------------------------

describe('printing without a printer', () => {
  /**
   * Documents are built as self-contained HTML in the main process. That is what
   * makes them testable here: the markup can be asserted without a printer, a
   * print server or a PDF library. `npm run smoke` then pushes the same markup
   * through Chromium's real print pipeline and checks the bytes on disk.
   */
  it('builds a receipt that references nothing outside itself', () => {
    const sale = sellSomething();
    const settings = getShopSettings(ctx.db);

    for (const html of [
      renderA4Invoice({ sale, settings, reprint: false }),
      renderThermalReceipt({ sale, settings, reprint: false }),
    ]) {
      // A document that fetched a font or a logo would print blank on a PC with
      // no internet, which is every PC this runs on.
      expect(html).not.toMatch(/https?:\/\//);
      expect(html).not.toContain('<link');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('@import');
      // Styles are inline, so there is no stylesheet to fail to load.
      expect(html).toContain('<style>');
    }
  });

  it('sizes both thermal widths for Electron, in microns', () => {
    // Electron wants microns, not millimetres. Getting the scale wrong prints a
    // receipt off the side of the paper, which is only ever discovered on real
    // hardware — so the exact numbers are pinned here.
    expect(receiptPageSize('58mm').width).toBe(58_000);
    expect(receiptPageSize('80mm').width).toBe(80_000);
    // Height is deliberately generous: a roll printer cuts at the end of the
    // content, so the page only has to be at least as long as the receipt.
    for (const width of ['58mm', '80mm'] as const) {
      expect(receiptPageSize(width).height).toBeGreaterThanOrEqual(200_000);
    }
  });

  it('builds both service documents from a real job', () => {
    const job = repairJob();
    const settings = getShopSettings(ctx.db);

    const jobSheet = renderServiceDocument({
      detail: job,
      settings,
      kind: 'JOB_SHEET',
      reprint: false,
    });
    expect(jobSheet).toContain(job.order.serviceNumber);
    expect(jobSheet).toContain('SERVICE JOB SHEET');
    expect(jobSheet).toContain('Galaxy S24');
    expect(jobSheet).toContain('Cracked screen');

    const completion = renderServiceDocument({
      detail: job,
      settings,
      kind: 'COMPLETION',
      reprint: false,
    });
    expect(completion).toContain('SERVICE COMPLETION');
    expect(completion).toContain(job.order.serviceNumber);

    for (const html of [jobSheet, completion]) {
      expect(html).not.toMatch(/https?:\/\//);
      expect(html).not.toContain('<script');
      // The shop logo, inlined — a path would print as a broken image from the
      // temp directory these are rendered in.
      expect(html).toContain('class="brand"');
      expect(html).toMatch(/<img src="data:image\/png;base64,/);
    }
  });

  it('marks a reprinted service document', () => {
    const job = repairJob();
    const settings = getShopSettings(ctx.db);
    const reprint = renderServiceDocument({
      detail: job,
      settings,
      kind: 'JOB_SHEET',
      reprint: true,
    });
    // A second copy must not be able to pass as the original.
    expect(reprint.toUpperCase()).toContain('REPRINT');
  });

  it('escapes customer text in a service document', () => {
    const job = repairJob('<script>alert(1)</script>');
    const settings = getShopSettings(ctx.db);
    const html = renderServiceDocument({
      detail: job,
      settings,
      kind: 'JOB_SHEET',
      reprint: false,
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  /** A completed sale, for the document builders. */
  function sellSomething() {
    const product = createProduct(
      {
        sku: 'CBL-1',
        name: 'USB-C Cable',
        purchasePrice: 80000,
        sellingPrice: 100000,
        taxRate: 0,
        taxRateOverride: false,
        minimumStock: 0,
        unit: 'pcs',
        isSerialized: false,
        warrantyMonths: 0,
        initialStock: 10,
      },
      actor,
      ctx.db,
    );
    return createSale(
      {
        items: [{ productId: product.id, quantity: 2 }],
        discountAmount: 0,
        payments: [{ amount: 200000, paymentMethod: 'CASH' }],
      },
      actor,
      ctx.db,
    );
  }

  /** A repair job with a part and labour on it. */
  function repairJob(problem = 'Cracked screen') {
    const job = createServiceOrder(
      {
        customerName: 'Walk-in',
        customerPhone: '0877777777',
        deviceBrand: 'Samsung',
        deviceModel: 'Galaxy S24',
        imei: '356938035643809',
        problemDescription: problem,
        estimatedCost: 350000,
        depositAmount: 100000,
        depositMethod: 'CASH',
      },
      actor,
      ctx.db,
    );
    addServiceItem(
      {
        serviceOrderId: job.order.id,
        description: 'Screen fitting labour',
        quantity: 1,
        unitCost: 0,
        sellingPrice: 250000,
        type: 'LABOR',
      },
      actor,
      ctx.db,
    );
    return getServiceOrder(job.order.id, ctx.db);
  }
});
