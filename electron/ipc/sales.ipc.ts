/**
 * Customers and sales (spec §28).
 *
 * Note that `sales.quote` exists so the POS screen can show authoritative
 * figures while the cart is being built: the same priceSale() that commits the
 * sale produces them, so what the cashier sees and what is charged cannot drift
 * apart (spec §68).
 */
import { handle } from './registry';
import { CHANNELS } from '../../shared/channels';
import {
  zCustomerListQuery,
  zIdOnly,
  zCreateCustomer,
  zUpdateCustomer,
  zCreateSale,
  zSaleListQuery,
  zCancelSale,
  zRefundSale,
  zSaleId,
} from '../../shared/validation';
import {
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  purchaseHistory,
  serviceHistory,
} from '../services/customer.service';
import {
  createSale,
  listSales,
  getSale,
  cancelSale,
  refundSale,
  priceSale,
} from '../services/sale.service';
import { requireUser } from '../session';

export function registerSalesIpc(): void {
  // --- Customers ------------------------------------------------------------

  handle(
    CHANNELS.customers.list,
    { access: 'permission', permission: 'customers.view' },
    zCustomerListQuery,
    (q) => listCustomers(q),
  );

  handle(CHANNELS.customers.get, { access: 'permission', permission: 'customers.view' }, zIdOnly, ({ id }) =>
    getCustomer(id),
  );

  handle(
    CHANNELS.customers.create,
    { access: 'permission', permission: 'customers.manage' },
    zCreateCustomer,
    (input) => createCustomer(input, requireUser()),
  );

  handle(
    CHANNELS.customers.update,
    { access: 'permission', permission: 'customers.manage' },
    zUpdateCustomer,
    (input) => updateCustomer(input, requireUser()),
  );

  handle(
    CHANNELS.customers.history,
    { access: 'permission', permission: 'customers.view' },
    zIdOnly,
    ({ id }) => ({
      customer: getCustomer(id),
      purchases: purchaseHistory(id),
      services: serviceHistory(id),
    }),
  );

  // --- Sales ----------------------------------------------------------------

  /** Authoritative running total for the cart. Read-only: writes nothing. */
  handle(CHANNELS.sales.quote, { access: 'permission', permission: 'pos.sell' }, zCreateSale, (input) => {
    const priced = priceSale(input);
    return {
      lines: priced.lines.map((line) => ({
        productId: line.productId,
        productSerialId: line.productSerialId,
        productName: line.productName,
        sku: line.sku,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount,
        taxAmount: line.taxAmount,
        totalAmount: line.totalAmount,
      })),
      subtotal: priced.subtotal,
      discountAmount: priced.discountAmount,
      taxAmount: priced.taxAmount,
      grandTotal: priced.grandTotal,
    };
  });

  handle(CHANNELS.sales.create, { access: 'permission', permission: 'pos.sell' }, zCreateSale, (input) =>
    createSale(input, requireUser()),
  );

  handle(CHANNELS.sales.list, { access: 'permission', permission: 'sales.view' }, zSaleListQuery, (q) =>
    listSales(q),
  );

  handle(CHANNELS.sales.get, { access: 'permission', permission: 'sales.view' }, zSaleId, ({ saleId }) =>
    getSale(saleId),
  );

  handle(
    CHANNELS.sales.cancel,
    { access: 'permission', permission: 'sales.cancel' },
    zCancelSale,
    ({ saleId, reason }) => cancelSale(saleId, reason, requireUser()),
  );

  handle(CHANNELS.sales.refund, { access: 'permission', permission: 'sales.refund' }, zRefundSale, (input) =>
    refundSale(input, requireUser()),
  );
}
