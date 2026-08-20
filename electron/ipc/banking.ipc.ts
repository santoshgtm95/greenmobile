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
  zBankTransactionListQuery,
  zCreateBankTransaction,
  zDeleteBankTransaction,
  zDayRange,
  zIdOnly,
  zLookupQuery,
  zSaveBankAccount,
  zSaveCashCount,
} from '../../shared/validation';
import {
  bankingOverview,
  createBankTransaction,
  deleteBankAccount,
  deleteBankTransaction,
  listBankAccounts,
  listBankTransactions,
  saveBankAccount,
  saveCashCount,
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
    { access: 'permission', permission: 'banking.manage' },
    zIdOnly,
    ({ id }) => deleteBankAccount(id, requireUser()),
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

  handle(
    CHANNELS.banking.saveCashCount,
    { access: 'permission', permission: 'banking.manage' },
    zSaveCashCount,
    (input) => saveCashCount(input, requireUser()),
  );
}
