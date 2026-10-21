/**
 * Banking — transfers, receipts, accounts and cash in hand.
 *
 * Three permissions rather than one, because the three things a user can do here
 * carry very different weight:
 *
 *   banking.view    read the ledger and the balances
 *   banking.manage  record a movement, register or retire an account
 *   banking.delete  remove a recorded movement — ADMIN only (see ROLE_PERMISSIONS)
 *
 * Deleting is separated for the same reason it is on expenses: it changes what a
 * balance on the screen says, so it is the one action a manager cannot take.
 */
import { handle } from './registry';
import { CHANNELS } from '../../shared/channels';
import {
  zBankAdvanceListQuery,
  zBankTransactionListQuery,
  zCreateBankTransaction,
  zDeleteBankTransaction,
  zDayRange,
  zIdOnly,
  zLookupQuery,
  zOpenBankAdvance,
  zSaveBankAccount,
  zSaveShopBankAccount,
  zSaveCashCount,
  zSaveBankBalances,
  zWithdrawBankAdvance,
  zCreateInternalTransfer,
  zDeleteInternalTransfer,
  zInternalTransferListQuery,
  zCreateShopAdvance,
  zReceiveShopAdvance,
  zShopAdvanceListQuery,
  zDeleteShopAdvance,
  zDeleteShopAdvanceSettlement,
} from '../../shared/validation';
import {
  bankingOverview,
  createBankTransaction,
  createInternalTransfer,
  createShopAdvance,
  deleteBankAccount,
  deleteBankTransaction,
  deleteInternalTransfer,
  deleteShopAdvance,
  deleteShopAdvanceSettlement,
  deleteShopBankAccount,
  getBankAdvance,
  getShopAdvance,
  listBankAccounts,
  listBankAdvances,
  listBankTransactions,
  listInternalTransfers,
  listShopAdvances,
  listShopBankAccounts,
  openBankAdvance,
  receiveShopAdvance,
  saveBankAccount,
  saveBankBalances,
  saveCashCount,
  saveShopBankAccount,
  withdrawFromBankAdvance,
} from '../services/banking.service';
import { requireUser } from '../session';

export function registerBankingIpc(): void {
  handle(CHANNELS.banking.overview, { access: 'permission', permission: 'banking.view' }, zDayRange, (range) =>
    bankingOverview(range),
  );

  handle(
    CHANNELS.banking.listAccounts,
    { access: 'permission', permission: 'banking.view' },
    zLookupQuery,
    ({ includeInactive }) => listBankAccounts(includeInactive),
  );

  handle(
    CHANNELS.banking.saveAccount,
    { access: 'permission', permission: 'banking.manage' },
    zSaveBankAccount,
    (input) => saveBankAccount(input, requireUser()),
  );

  handle(
    CHANNELS.banking.deleteAccount,
    { access: 'permission', permission: 'banking.delete' },
    zIdOnly,
    ({ id }) => deleteBankAccount(id, requireUser()),
  );

  handle(
    CHANNELS.banking.listShopAccounts,
    { access: 'permission', permission: 'banking.view' },
    zLookupQuery,
    ({ includeInactive }) => listShopBankAccounts(includeInactive),
  );

  handle(
    CHANNELS.banking.saveShopAccount,
    { access: 'permission', permission: 'banking.manage' },
    zSaveShopBankAccount,
    (input) => saveShopBankAccount(input, requireUser()),
  );

  handle(
    CHANNELS.banking.deleteShopAccount,
    { access: 'permission', permission: 'banking.delete' },
    zIdOnly,
    ({ id }) => deleteShopBankAccount(id, requireUser()),
  );

  handle(
    CHANNELS.banking.listTransactions,
    { access: 'permission', permission: 'banking.view' },
    zBankTransactionListQuery,
    (query) => listBankTransactions(query),
  );

  handle(
    CHANNELS.banking.createTransaction,
    { access: 'permission', permission: 'banking.manage' },
    zCreateBankTransaction,
    (input) => createBankTransaction(input, requireUser()),
  );

  handle(
    CHANNELS.banking.deleteTransaction,
    { access: 'permission', permission: 'banking.delete' },
    zDeleteBankTransaction,
    ({ id, reason }) => {
      deleteBankTransaction(id, reason, requireUser());
    },
  );

  /*
    Customer advances. Same three permissions as every other movement, because
    that is what they are: opening one or paying one out records money moving
    (manage), reading them is reading the ledger (view), and removing either
    side goes through deleteTransaction like anything else (delete, admin only).
  */
  handle(
    CHANNELS.banking.listAdvances,
    { access: 'permission', permission: 'banking.view' },
    zBankAdvanceListQuery,
    (query) => listBankAdvances(query),
  );

  handle(
    CHANNELS.banking.getAdvance,
    { access: 'permission', permission: 'banking.view' },
    zIdOnly,
    ({ id }) => getBankAdvance(id),
  );

  handle(
    CHANNELS.banking.openAdvance,
    { access: 'permission', permission: 'banking.manage' },
    zOpenBankAdvance,
    (input) => openBankAdvance(input, requireUser()),
  );

  handle(
    CHANNELS.banking.withdrawAdvance,
    { access: 'permission', permission: 'banking.manage' },
    zWithdrawBankAdvance,
    (input) => withdrawFromBankAdvance(input, requireUser()),
  );

  handle(
    CHANNELS.banking.saveCashCount,
    { access: 'permission', permission: 'banking.manage' },
    zSaveCashCount,
    (input) => saveCashCount(input, requireUser()),
  );

  handle(
    CHANNELS.banking.saveBankBalances,
    { access: 'permission', permission: 'banking.manage' },
    zSaveBankBalances,
    (input) => saveBankBalances(input, requireUser()),
  );

  handle(
    CHANNELS.banking.listInternalTransfers,
    { access: 'permission', permission: 'banking.view' },
    zInternalTransferListQuery,
    (query) => listInternalTransfers(query),
  );

  handle(
    CHANNELS.banking.createInternalTransfer,
    { access: 'permission', permission: 'banking.manage' },
    zCreateInternalTransfer,
    (input) => createInternalTransfer(input, requireUser()),
  );

  handle(
    CHANNELS.banking.deleteInternalTransfer,
    { access: 'permission', permission: 'banking.delete' },
    zDeleteInternalTransfer,
    ({ id, reason }) => {
      deleteInternalTransfer(id, reason, requireUser());
    },
  );

  handle(
    CHANNELS.banking.listShopAdvances,
    { access: 'permission', permission: 'banking.view' },
    zShopAdvanceListQuery,
    (query) => listShopAdvances(query),
  );

  handle(
    CHANNELS.banking.getShopAdvance,
    { access: 'permission', permission: 'banking.view' },
    zIdOnly,
    ({ id }) => getShopAdvance(id),
  );

  handle(
    CHANNELS.banking.createShopAdvance,
    { access: 'permission', permission: 'banking.manage' },
    zCreateShopAdvance,
    (input) => createShopAdvance(input, requireUser()),
  );

  handle(
    CHANNELS.banking.receiveShopAdvance,
    { access: 'permission', permission: 'banking.manage' },
    zReceiveShopAdvance,
    (input) => receiveShopAdvance(input, requireUser()),
  );

  handle(
    CHANNELS.banking.deleteShopAdvance,
    { access: 'permission', permission: 'banking.delete' },
    zDeleteShopAdvance,
    ({ id, reason }) => {
      deleteShopAdvance(id, reason, requireUser());
    },
  );

  handle(
    CHANNELS.banking.deleteShopAdvanceSettlement,
    { access: 'permission', permission: 'banking.delete' },
    zDeleteShopAdvanceSettlement,
    ({ id, reason }) => {
      deleteShopAdvanceSettlement(id, reason, requireUser());
    },
  );
}
