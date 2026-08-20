/**
 * Invoice and receipt rendering (spec §37).
 *
 * These are pure functions over a stored sale, so they can be checked directly.
 * The escaping tests matter most: shop data goes straight into markup, and a
 * product called `Cable <b>` must print as text rather than turning the rest of
 * the receipt bold.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  renderA4Invoice,
  renderThermalReceipt,
  receiptPageSize,
} from '../electron/services/document.service';
import type { SaleDetail } from '../electron/services/sale.service';
import type { ShopSettings } from '../shared/settings';

const REPO_ROOT = path.resolve(__dirname, '..');

const SETTINGS: ShopSettings = {
  shopName: 'Green Mobile',
  shopAddress: '12 Market Road\nBangkok',
  shopPhone: '0812345678',
  shopEmail: 'shop@example.com',
  shopLogo: '',
  currency: 'THB',
  taxEnabled: true,
  taxRate: 700,
  taxMode: 'EXCLUSIVE',
  invoicePrefix: 'INV',
  receiptWidth: '80mm',
  receiptFooter: 'Thank you!',
  defaultPrinter: '',
  printerAutoPrint: false,
  lowStockThreshold: 5,
  allowNegativeStock: false,
  backupLocation: '',
  autoBackupFrequency: 'DAILY',
  autoBackupKeep: 10,
  setupCompleted: true,
};

function makeSale(overrides: Partial<SaleDetail['sale']> = {}, itemName = 'USB-C Cable'): SaleDetail {
  return {
    sale: {
      id: 's1',
      invoiceNumber: 'INV-202608-0001',
      customerId: null,
      customerName: 'Walk-in Customer',
      customerPhone: null,
      saleDate: '2026-08-10T03:15:00.000Z',
      saleDay: '2026-08-10',
      subtotal: 200_000,
      discountAmount: 0,
      taxAmount: 14_000,
      grandTotal: 214_000,
      amountPaid: 214_000,
      changeAmount: 0,
      costTotal: 160_000,
      refundedAmount: 0,
      paymentStatus: 'PAID',
      status: 'COMPLETED',
      notes: null,
      createdBy: 'u1',
      cashierName: 'Somchai',
      createdAt: '2026-08-10T03:15:00.000Z',
      ...overrides,
    },
    items: [
      {
        id: 'i1',
        saleId: 's1',
        productId: 'p1',
        productName: itemName,
        sku: 'SKU-1',
        quantity: 2,
        unitCost: 80_000,
        unitPrice: 100_000,
        discountAmount: 0,
        taxAmount: 14_000,
        totalAmount: 214_000,
        returnedQuantity: 0,
        serials: null,
      },
    ],
    payments: [
      {
        id: 'pay1',
        amount: 214_000,
        paymentMethod: 'CASH',
        referenceNumber: null,
        paymentDate: '2026-08-10T03:15:00.000Z',
        notes: null,
      },
    ],
  };
}

describe('A4 invoice', () => {
  it('includes everything the spec lists', () => {
    const html = renderA4Invoice({ sale: makeSale(), settings: SETTINGS });

    expect(html).toContain('Green Mobile');
    expect(html).toContain('12 Market Road');
    expect(html).toContain('0812345678');
    expect(html).toContain('INV-202608-0001');
    expect(html).toContain('Somchai');
    expect(html).toContain('Walk-in Customer');
    expect(html).toContain('USB-C Cable');
    expect(html).toContain('SKU-1');
    // Quantity, unit price, tax and grand total.
    expect(html).toContain('1,000.00');
    expect(html).toContain('140.00');
    expect(html).toContain('2,140.00');
    expect(html).toContain('GRAND TOTAL');
    expect(html).toContain('Cash');
    expect(html).toContain('@page');
    expect(html).toContain('size: A4');
  });

  it('shows change when cash was overpaid', () => {
    const html = renderA4Invoice({
      sale: makeSale({ amountPaid: 214_000, changeAmount: 86_000 }),
      settings: SETTINGS,
    });
    expect(html).toContain('Change');
    expect(html).toContain('860.00');
  });

  it('marks a reprint so it cannot pass as the original', () => {
    const plain = renderA4Invoice({ sale: makeSale(), settings: SETTINGS });
    const reprint = renderA4Invoice({ sale: makeSale(), settings: SETTINGS, reprint: true });
    expect(plain).not.toContain('REPRINT');
    expect(reprint).toContain('REPRINT');
  });

  it('banners a cancelled or refunded sale', () => {
    const cancelled = renderA4Invoice({
      sale: makeSale({ status: 'CANCELLED' }),
      settings: SETTINGS,
    });
    expect(cancelled).toContain('CANCELLED');

    const partial = renderA4Invoice({
      sale: makeSale({ status: 'PARTIALLY_REFUNDED', refundedAmount: 107_000 }),
      settings: SETTINGS,
    });
    // Underscores are turned into spaces for display.
    expect(partial).toContain('PARTIALLY REFUNDED');
    expect(partial).toContain('Refunded');
  });

  it('escapes shop data instead of letting it become markup', () => {
    const html = renderA4Invoice({
      sale: makeSale({ customerName: 'Bobby <script>alert(1)</script>' }, 'Cable <b>strong</b>'),
      settings: SETTINGS,
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Cable &lt;b&gt;strong&lt;/b&gt;');
  });

  it('respects a currency with no decimal places', () => {
    const html = renderA4Invoice({
      sale: makeSale(),
      settings: { ...SETTINGS, currency: 'JPY' },
    });
    expect(html).toContain('2,140');
    expect(html).toContain('JPY');
  });
});

describe('thermal receipt', () => {
  it('renders at the configured width', () => {
    const wide = renderThermalReceipt({ sale: makeSale(), settings: SETTINGS });
    expect(wide).toContain('size: 80mm auto');
    expect(wide).toContain('width: 72mm');

    const narrow = renderThermalReceipt({
      sale: makeSale(),
      settings: { ...SETTINGS, receiptWidth: '58mm' },
    });
    expect(narrow).toContain('size: 58mm auto');
    expect(narrow).toContain('width: 48mm');
  });

  it('includes the shop, invoice, items, totals and footer', () => {
    const html = renderThermalReceipt({ sale: makeSale(), settings: SETTINGS });
    expect(html).toContain('Green Mobile');
    expect(html).toContain('INV-202608-0001');
    expect(html).toContain('USB-C Cable');
    expect(html).toContain('TOTAL');
    expect(html).toContain('2,140.00');
    expect(html).toContain('Thank you!');
  });

  it('prints the IMEI when a serialized item was sold', () => {
    const sale = makeSale();
    sale.items[0].serials = '354121080000001';
    const html = renderThermalReceipt({ sale, settings: SETTINGS });
    expect(html).toContain('IMEI 354121080000001');
  });

  it('escapes the footer and shop name', () => {
    const html = renderThermalReceipt({
      sale: makeSale(),
      settings: { ...SETTINGS, shopName: 'Shop & Co <hr>', receiptFooter: '<img src=x>' },
    });
    expect(html).toContain('Shop &amp; Co &lt;hr&gt;');
    expect(html).not.toContain('<img src=x>');
  });

  it('omits the tax line entirely when no tax was charged', () => {
    const html = renderThermalReceipt({
      sale: makeSale({ taxAmount: 0, grandTotal: 200_000 }),
      settings: { ...SETTINGS, taxEnabled: false },
    });
    expect(html).not.toContain('>Tax<');
  });
});

describe('receipt page geometry', () => {
  it('reports the paper width in microns for Electron', () => {
    expect(receiptPageSize('58mm').width).toBe(58_000);
    expect(receiptPageSize('80mm').width).toBe(80_000);
  });
});

// -----------------------------------------------------------------------------
// Branding (spec §35, §58)
// -----------------------------------------------------------------------------

describe('the shop logo', () => {
  it('appears on the A4 invoice', () => {
    // Spec §35 lists "Shop logo" as the first thing on the invoice.
    const html = renderA4Invoice({ sale: makeSale(), settings: SETTINGS });
    expect(html).toContain('class="brand"');
    expect(html).toMatch(/<img src="data:image\/png;base64,/);
  });

  it('is inlined, so a printed document cannot lose it', () => {
    // Documents render from a temp directory in an offscreen window. A relative
    // path would resolve differently there and print as a broken image.
    const html = renderA4Invoice({ sale: makeSale(), settings: SETTINGS });
    expect(html).not.toMatch(/<img src="[^"]*\.(png|jpe?g|svg)"/);
    expect(html).not.toMatch(/<img src="(\.|\/|file:)/);
  });

  it('uses the shop’s own logo when one is set', () => {
    const own =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
    const html = renderA4Invoice({
      sale: makeSale(),
      settings: { ...SETTINGS, shopLogo: own },
    });
    expect(html).toContain(own);
  });

  it('refuses a shopLogo that is not an image data URI', () => {
    // The setting has no screen writing it yet, which is exactly when a value
    // like this would slip through unnoticed. An attribute is as injectable as a
    // text node, so anything that is not an inline image falls back to the mark.
    for (const hostile of [
      'javascript:alert(1)',
      '" onerror="alert(1)',
      'https://example.com/track.png',
      '../../../etc/passwd',
      'data:text/html,<script>alert(1)</script>',
    ]) {
      const html = renderA4Invoice({
        sale: makeSale(),
        settings: { ...SETTINGS, shopLogo: hostile },
      });
      expect(html, hostile).not.toContain(hostile);
      expect(html, hostile).toMatch(/<img src="data:image\/png;base64,/);
      // And nothing escaped into an attribute or a tag.
      expect(html, hostile).not.toContain('onerror');
      expect(html, hostile).not.toContain('javascript:');
    }
  });

  it('escapes a hostile data URI rather than emitting it raw', () => {
    // A value that passes the data:image/ prefix check still gets escaped.
    const sneaky = 'data:image/png;base64,AAAA" onerror="alert(1)';
    const html = renderA4Invoice({
      sale: makeSale(),
      settings: { ...SETTINGS, shopLogo: sneaky },
    });
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain('&quot;');
  });

  it('keeps the thermal receipt logo-free', () => {
    // Deliberate: §35 asks for the logo on the A4 invoice, and a detailed
    // two-tone mark dithers badly on a 58 mm thermal roll. The receipt leads
    // with the shop name instead.
    const html = renderThermalReceipt({ sale: makeSale(), settings: SETTINGS });
    expect(html).not.toContain('<img');
    expect(html).toContain('Green Mobile');
  });
});

describe('the installer icon', () => {
  it('is a committed multi-resolution ICO', () => {
    // Generated by scripts/build-logo-assets.py, committed so `npm run dist`
    // needs no Python. Without it electron-builder silently falls back to the
    // default Electron icon, which is the kind of thing nobody notices until a
    // shop asks why the POS looks like a science experiment.
    const icon = fs.readFileSync(path.join(REPO_ROOT, 'build', 'icon.ico'));

    // ICONDIR: reserved 0, type 1 (icon), then the image count.
    expect(icon.readUInt16LE(0)).toBe(0);
    expect(icon.readUInt16LE(2)).toBe(1);
    const count = icon.readUInt16LE(4);
    expect(count).toBe(7);

    // ICONDIRENTRY widths, where 0 means 256.
    const widths = Array.from({ length: count }, (_, i) => {
      const width = icon.readUInt8(6 + i * 16);
      return width === 0 ? 256 : width;
    }).sort((a, b) => a - b);
    expect(widths).toEqual([16, 24, 32, 48, 64, 128, 256]);
  });

  it('is referenced by the packaging config', () => {
    const yml = fs.readFileSync(path.join(REPO_ROOT, 'electron-builder.yml'), 'utf8');
    expect(yml).toMatch(/icon:\s*build\/icon\.ico/);
  });
});
