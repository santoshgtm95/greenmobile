import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from './helpers/test-db';
import { completeFirstRunSetup } from '../electron/services/auth.service';
import { getSessionUser, setSessionUser, type SessionUser } from '../electron/session';
import { createProduct, findProductByCode } from '../electron/services/product.service';
import {
  calculateEan13CheckDigit,
  generateEan13Candidate,
  isValidEan13,
} from '../shared/barcode';
import type { FirstRunSetupInput } from '../shared/validation';

let ctx: TestDatabase;
let actor: SessionUser;

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

describe('barcode utility', () => {
  it('computes correct EAN-13 check digit', () => {
    // Standard GS1 test vectors
    expect(calculateEan13CheckDigit('590123412345')).toBe(7);
    expect(calculateEan13CheckDigit('400638133393')).toBe(1);
  });

  it('generates valid 13-digit EAN-13 candidate with in-store prefix 20', () => {
    const code = generateEan13Candidate();
    expect(code).toHaveLength(13);
    expect(code.startsWith('20')).toBe(true);
    expect(isValidEan13(code)).toBe(true);
  });

  it('rejects invalid EAN-13 barcodes', () => {
    expect(isValidEan13('123')).toBe(false);
    expect(isValidEan13('5901234123458')).toBe(false); // wrong checksum
  });
});

describe('automatic barcode generation on product creation', () => {
  it('automatically generates a unique barcode if barcode is omitted', () => {
    const product1 = createProduct(
      {
        sku: 'TEST-SKU-1',
        name: 'Product 1',
        purchasePrice: 1000,
        sellingPrice: 1500,
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

    expect(product1.barcode).toBeDefined();
    expect(product1.barcode).not.toBeNull();
    expect(product1.barcode).toHaveLength(13);
    expect(isValidEan13(product1.barcode!)).toBe(true);

    const product2 = createProduct(
      {
        sku: 'TEST-SKU-2',
        name: 'Product 2',
        purchasePrice: 2000,
        sellingPrice: 2500,
        taxRate: 0,
        taxRateOverride: false,
        minimumStock: 0,
        unit: 'pcs',
        isSerialized: false,
        warrantyMonths: 0,
        initialStock: 5,
      },
      actor,
      ctx.db,
    );

    expect(product2.barcode).toBeDefined();
    expect(product2.barcode).not.toBeNull();
    expect(product2.barcode).not.toBe(product1.barcode);

    // Can be scanned / found by barcode
    const found = findProductByCode(product1.barcode!, ctx.db);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(product1.id);
  });

  it('preserves user-inputted barcode when supplied', () => {
    const customBarcode = 'CUSTOM-CODE-99';
    const product = createProduct(
      {
        sku: 'TEST-SKU-3',
        barcode: customBarcode,
        name: 'Product 3',
        purchasePrice: 1000,
        sellingPrice: 1500,
        taxRate: 0,
        taxRateOverride: false,
        minimumStock: 0,
        unit: 'pcs',
        isSerialized: false,
        warrantyMonths: 0,
        initialStock: 0,
      },
      actor,
      ctx.db,
    );

    expect(product.barcode).toBe(customBarcode);
  });
});
