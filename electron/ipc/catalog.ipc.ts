/**
 * Products, categories, brands, serials and inventory (spec §28).
 *
 * Reading needs the *.view permission; every write needs the matching manage or
 * adjust permission. The registry enforces both before a handler runs.
 */
import { handle } from './registry';
import { CHANNELS } from '../../shared/channels';
import {
  zProductListQuery,
  zIdOnly,
  zCodeLookup,
  zCreateProduct,
  zUpdateProduct,
  zAdjustStock,
  zAddSerials,
  zMarkSerialDefective,
  zSaveLookup,
  zLookupQuery,
  zInventoryQuery,
  zNoPayload,
} from '../../shared/validation';
import {
  listProducts,
  getProduct,
  findProductByCode,
  createProduct,
  updateProduct,
  deleteProduct,
  adjustStock,
  addSerials,
  markSerialDefective,
  listCategories,
  listBrands,
  saveCategory,
  saveBrand,
} from '../services/product.service';
import {
  listSerials,
  findSerialByCode,
  inventoryHistory,
  stockSummary,
  lowStock,
} from '../services/inventory.service';
import { getShopSettings } from '../services/settings.service';
import { requireUser } from '../session';
import { z } from 'zod';

const zSerialQuery = z.object({
  productId: z.string().min(1).max(64),
  status: z.enum(['AVAILABLE', 'SOLD', 'RETURNED', 'DEFECTIVE', 'RESERVED']).optional(),
});

export function registerCatalogIpc(): void {
  // --- Products -------------------------------------------------------------

  handle(CHANNELS.products.list, { access: 'permission', permission: 'products.view' }, zProductListQuery, (q) =>
    listProducts(q),
  );

  handle(CHANNELS.products.get, { access: 'permission', permission: 'products.view' }, zIdOnly, ({ id }) =>
    getProduct(id),
  );

  /** Barcode scan (spec §33). Returns null so the UI can offer "create product". */
  handle(
    CHANNELS.products.findByCode,
    { access: 'permission', permission: 'products.view' },
    zCodeLookup,
    ({ code }) => findProductByCode(code),
  );

  handle(
    CHANNELS.products.create,
    { access: 'permission', permission: 'products.manage' },
    zCreateProduct,
    (input) => createProduct(input, requireUser()),
  );

  handle(
    CHANNELS.products.update,
    { access: 'permission', permission: 'products.manage' },
    zUpdateProduct,
    (input) => updateProduct(input, requireUser()),
  );

  handle(
    CHANNELS.products.delete,
    { access: 'permission', permission: 'products.manage' },
    zIdOnly,
    ({ id }) => deleteProduct(id, requireUser()),
  );

  // --- Stock ----------------------------------------------------------------

  handle(
    CHANNELS.products.adjustStock,
    { access: 'permission', permission: 'inventory.adjust' },
    zAdjustStock,
    (input) => adjustStock(input, requireUser()),
  );

  handle(
    CHANNELS.inventory.history,
    { access: 'permission', permission: 'inventory.view' },
    zInventoryQuery,
    (q) => inventoryHistory(q),
  );

  handle(CHANNELS.inventory.lowStock, { access: 'permission', permission: 'inventory.view' }, zNoPayload, () =>
    lowStock(getShopSettings().lowStockThreshold),
  );

  handle(CHANNELS.inventory.summary, { access: 'permission', permission: 'inventory.view' }, zNoPayload, () =>
    stockSummary(getShopSettings().lowStockThreshold),
  );

  // --- Serial numbers / IMEI ------------------------------------------------

  handle(
    CHANNELS.serials.list,
    { access: 'permission', permission: 'products.view' },
    zSerialQuery,
    ({ productId, status }) => listSerials(productId, status),
  );

  handle(
    CHANNELS.serials.findByCode,
    { access: 'permission', permission: 'products.view' },
    zCodeLookup,
    ({ code }) => findSerialByCode(code),
  );

  handle(
    CHANNELS.serials.add,
    { access: 'permission', permission: 'inventory.adjust' },
    zAddSerials,
    (input) => addSerials(input, requireUser()),
  );

  handle(
    CHANNELS.serials.markDefective,
    { access: 'permission', permission: 'inventory.adjust' },
    zMarkSerialDefective,
    ({ serialId, reason }) => {
      markSerialDefective(serialId, reason, requireUser());
    },
  );

  // --- Categories and brands ------------------------------------------------

  handle(
    CHANNELS.categories.list,
    { access: 'permission', permission: 'products.view' },
    zLookupQuery,
    ({ includeInactive }) => listCategories(includeInactive),
  );

  handle(
    CHANNELS.categories.save,
    { access: 'permission', permission: 'products.manage' },
    zSaveLookup,
    (input) => saveCategory(input, requireUser()),
  );

  handle(
    CHANNELS.brands.list,
    { access: 'permission', permission: 'products.view' },
    zLookupQuery,
    ({ includeInactive }) => listBrands(includeInactive),
  );

  handle(
    CHANNELS.brands.save,
    { access: 'permission', permission: 'products.manage' },
    zSaveLookup,
    (input) => saveBrand(input, requireUser()),
  );
}
