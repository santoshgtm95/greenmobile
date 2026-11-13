/** Purchase invoices and suppliers. Viewing follows products; changes need products.manage. */
import { handle } from './registry';
import { CHANNELS } from '../../shared/channels';
import {
  zIdOnly,
  zLookupQuery,
  zSaveSupplier,
  zCreatePurchaseInvoice,
  zUpdatePurchaseInvoice,
  zPurchaseInvoiceListQuery,
  zReceivePurchaseItems,
  zReturnPurchaseItem,
  zPaySupplier,
  zDeleteExpense as zDeleteWithReason,
} from '../../shared/validation';
import {
  listSuppliers,
  saveSupplier,
  listPurchaseInvoices,
  getPurchaseInvoice,
  createPurchaseInvoice,
  updatePurchaseInvoice,
  deletePurchaseInvoice,
  receivePurchaseItems,
  returnPurchaseItem,
  paySupplier,
  deletePurchaseItem,
  deleteSupplierPayment,
} from '../services/purchase.service';
import { requireUser } from '../session';


export function registerPurchasesIpc(): void {
  handle(CHANNELS.suppliers.list, { access: 'permission', permission: 'products.view' }, zLookupQuery, ({ includeInactive }) => listSuppliers(includeInactive));
  handle(CHANNELS.suppliers.save, { access: 'permission', permission: 'products.manage' }, zSaveSupplier, (input) => saveSupplier(input, requireUser()));

  handle(CHANNELS.purchases.list, { access: 'permission', permission: 'products.view' }, zPurchaseInvoiceListQuery, (q) => listPurchaseInvoices(q));
  handle(CHANNELS.purchases.get, { access: 'permission', permission: 'products.view' }, zIdOnly, ({ id }) => getPurchaseInvoice(id));
  handle(CHANNELS.purchases.create, { access: 'permission', permission: 'products.manage' }, zCreatePurchaseInvoice, (input) => createPurchaseInvoice(input, requireUser()));
  handle(CHANNELS.purchases.update, { access: 'permission', permission: 'products.manage' }, zUpdatePurchaseInvoice, (input) => updatePurchaseInvoice(input, requireUser()));
  handle(
    CHANNELS.purchases.delete,
    { access: 'permission', permission: 'products.delete' },
    zDeleteWithReason,
    ({ id, reason }) => deletePurchaseInvoice(id, reason, requireUser()),
  );
  handle(CHANNELS.purchases.receive, { access: 'permission', permission: 'products.manage' }, zReceivePurchaseItems, (input) => receivePurchaseItems(input, requireUser()));
  handle(CHANNELS.purchases.returnItem, { access: 'permission', permission: 'products.manage' }, zReturnPurchaseItem, (input) => returnPurchaseItem(input, requireUser()));
  handle(CHANNELS.purchases.pay, { access: 'permission', permission: 'products.manage' }, zPaySupplier, (input) => paySupplier(input, requireUser()));
  handle(CHANNELS.purchases.deleteItem, { access: 'permission', permission: 'products.delete' }, zDeleteWithReason, ({ id, reason }) => deletePurchaseItem(id, reason, requireUser()));
  handle(CHANNELS.purchases.deletePayment, { access: 'permission', permission: 'products.delete' }, zDeleteWithReason, ({ id, reason }) => deleteSupplierPayment(id, reason, requireUser()));
}
