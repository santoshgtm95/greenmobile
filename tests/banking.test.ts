/**
 * Banking — accounts, transfers and receipts, balances, cash in hand.
 *
 * The guarantees worth a test here are the ones a shop cannot recover from by
 * retyping something:
 *
 *   an account KEY is immutable, because it labels transactions already recorded
 *   a USED account cannot be deleted, so history cannot be orphaned
 *   deleting a transaction never removes the row, so an old balance stays explainable
 *   the figures on the strip and the figures under the list are the SAME figures —
 *   they were once computed two different ways, and a row with the same bank on
 *   both sides made them disagree
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from './helpers/test-db';
import { completeFirstRunSetup } from '../electron/services/auth.service';
import { getSessionUser, setSessionUser, type SessionUser } from '../electron/session';
import {
  bankingOverview,
  cashInHand,
  createBankTransaction,
  deleteBankAccount,
  deleteBankTransaction,
  getBankAccount,
  listBankAccounts,
  listBankTransactions,
  saveBankAccount,
  saveCashCount,
} from '../electron/services/banking.service';
import { AppError } from '../shared/errors';
import { businessDay, addDays, nowLocalDateTime, localDateTimeToInstant } from '../shared/datetime';
import { roleHasPermission, type BankFeeDirection } from '../shared/domain';
import { formatMoney } from '../shared/money';
import { zCreateBankTransaction, type FirstRunSetupInput } from '../shared/validation';

let ctx: TestDatabase;
let actor: SessionUser;
let kpay: string;
let aya: string;

const SETUP: FirstRunSetupInput = {
  shopName: 'Green Mobile',
  shopAddress: undefined,
  shopPhone: undefined,
  shopEmail: undefined,
  fullName: 'Owner',
  username: 'owner',
  password: 'owner-pass',
  confirmPassword: 'owner-pass',
  currency: 'MMK',
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

  kpay = saveBankAccount(
    { name: 'Kanbawza', key: 'Kpay', description: undefined, isActive: true },
    actor,
    ctx.db,
  ).id;
  aya = saveBankAccount(
    { name: 'AYA Bank', key: 'AYAPay', description: undefined, isActive: true },
    actor,
    ctx.db,
  ).id;
});

afterEach(() => {
  setSessionUser(null);
  ctx.cleanup();
});

/** A day-and-time value the form would have produced, on the given business day. */
function at(day: string = businessDay(), time = '10:30'): string {
  return `${day}T${time}`;
}

function receive(
  amount: number,
  overrides: Partial<{
    to: string;
    from: string;
    day: string;
    fromName: string;
    feeBasisPoints: number;
    feeDirection: BankFeeDirection;
  }> = {},
) {
  return createBankTransaction(
    {
      type: 'RECEIVE',
      transactionAt: at(overrides.day),
      fromAccountId: overrides.from,
      fromAccountNumber: '09-111-2222',
      fromName: overrides.fromName ?? 'A customer',
      toAccountId: overrides.to ?? kpay,
      toAccountNumber: '001-22-3333',
      toName: 'Green Mobile',
      amount,
      feeBasisPoints: overrides.feeBasisPoints ?? 0,
      feeDirection: overrides.feeDirection ?? 'RECEIVE',
      notes: undefined,
    },
    actor,
    ctx.db,
  );
}

function transfer(
  amount: number,
  overrides: Partial<{
    from: string;
    to: string;
    day: string;
    toName: string;
    feeBasisPoints: number;
    feeDirection: BankFeeDirection;
  }> = {},
) {
  return createBankTransaction(
    {
      type: 'TRANSFER',
      transactionAt: at(overrides.day),
      fromAccountId: overrides.from ?? kpay,
      fromAccountNumber: '001-22-3333',
      fromName: 'Green Mobile',
      toAccountId: overrides.to,
      toAccountNumber: '09-333-4444',
      toName: overrides.toName ?? 'A supplier',
      amount,
      feeBasisPoints: overrides.feeBasisPoints ?? 0,
      feeDirection: overrides.feeDirection ?? 'RECEIVE',
      notes: undefined,
    },
    actor,
    ctx.db,
  );
}

const ALL_TIME = { from: '2000-01-01', to: '2099-12-31' };
const TODAY = { from: businessDay(), to: businessDay() };

// -----------------------------------------------------------------------------
// Accounts
// -----------------------------------------------------------------------------

describe('registering accounts', () => {
  it('stores the name and the key the shop chose', () => {
    const account = getBankAccount(kpay, ctx.db);
    expect(account.name).toBe('Kanbawza');
    expect(account.key).toBe('Kpay');
    expect(account.isActive).toBe(1);
    expect(account.transactionCount).toBe(0);
    expect(account.canDelete).toBe(true);
  });

  it('refuses a duplicate name, whatever the case', () => {
    const error = captureError(() =>
      saveBankAccount(
        { name: 'kanbawza', key: 'KBZ2', description: undefined, isActive: true },
        actor,
        ctx.db,
      ),
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.fields?.name).toBeTruthy();
  });

  it('refuses a duplicate key, whatever the case', () => {
    const error = captureError(() =>
      saveBankAccount(
        { name: 'Another Bank', key: 'kpay', description: undefined, isActive: true },
        actor,
        ctx.db,
      ),
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.fields?.key).toBeTruthy();
    expect(error.message).toContain('Kanbawza');
  });

  it('renames an account without touching its key', () => {
    const renamed = saveBankAccount(
      { id: kpay, name: 'KBZ Bank', key: 'Kpay', description: 'Main account', isActive: true },
      actor,
      ctx.db,
    );
    expect(renamed.name).toBe('KBZ Bank');
    expect(renamed.key).toBe('Kpay');
    expect(renamed.description).toBe('Main account');
  });

  it('refuses to change a key, rather than silently keeping the old one', () => {
    // The dangerous failure mode is a quiet success: the caller believes the key
    // changed while every recorded transaction still shows the old one.
    const error = captureError(() =>
      saveBankAccount(
        { id: kpay, name: 'Kanbawza', key: 'KpayNew', description: undefined, isActive: true },
        actor,
        ctx.db,
      ),
    );
    expect(error.code).toBe('INVALID_STATE');
    expect(error.message).toContain('Kpay');
    expect(getBankAccount(kpay, ctx.db).key).toBe('Kpay');
  });

  it('hides a switched-off account from the pickers but keeps it listed', () => {
    saveBankAccount(
      { id: aya, name: 'AYA Bank', key: 'AYAPay', description: undefined, isActive: false },
      actor,
      ctx.db,
    );

    expect(listBankAccounts(false, ctx.db).map((a) => a.key)).toEqual(['Kpay']);
    expect(listBankAccounts(true, ctx.db).map((a) => a.key)).toEqual(['AYAPay', 'Kpay']);
  });

  it('refuses a new transaction against a switched-off account', () => {
    saveBankAccount(
      { id: aya, name: 'AYA Bank', key: 'AYAPay', description: undefined, isActive: false },
      actor,
      ctx.db,
    );

    const error = captureError(() => receive(100_000, { to: aya }));
    expect(error.code).toBe('INVALID_STATE');
    expect(error.message).toContain('switched off');
  });
});

describe('deleting accounts', () => {
  it('deletes an account that has never been used', () => {
    expect(deleteBankAccount(aya, actor, ctx.db)).toEqual({ deleted: true });
    expect(listBankAccounts(true, ctx.db).map((a) => a.key)).toEqual(['Kpay']);
  });

  it('frees the key again once an unused account is deleted', () => {
    deleteBankAccount(aya, actor, ctx.db);
    const reused = saveBankAccount(
      { name: 'AYA Bank Two', key: 'AYAPay', description: undefined, isActive: true },
      actor,
      ctx.db,
    );
    expect(reused.key).toBe('AYAPay');
  });

  it('refuses to delete an account once its key has been used', () => {
    receive(500_000, { to: kpay });

    const error = captureError(() => deleteBankAccount(kpay, actor, ctx.db));
    expect(error.code).toBe('INVALID_STATE');
    expect(error.message).toContain('Kpay');
    // And it says what to do instead.
    expect(error.message).toMatch(/switch it off/i);

    expect(getBankAccount(kpay, ctx.db).canDelete).toBe(false);
  });

  it('still refuses after the only transaction has been deleted', () => {
    // A soft-deleted transaction still holds the foreign key, so the account is
    // still load-bearing even though the ledger looks empty.
    const movement = receive(500_000, { to: kpay });
    deleteBankTransaction(movement.id, 'Entered twice', actor, ctx.db);

    expect(getBankAccount(kpay, ctx.db).transactionCount).toBe(0);
    expect(getBankAccount(kpay, ctx.db).canDelete).toBe(false);
    expect(captureError(() => deleteBankAccount(kpay, actor, ctx.db)).code).toBe('INVALID_STATE');
  });
});

// -----------------------------------------------------------------------------
// Transactions
// -----------------------------------------------------------------------------

describe('recording transactions', () => {
  it('numbers transactions in sequence', () => {
    const first = receive(100_000);
    const second = transfer(50_000);

    expect(first.transactionNumber).toMatch(/^BNK-\d{6}-0001$/);
    expect(second.transactionNumber).toMatch(/^BNK-\d{6}-0002$/);
  });

  it('records both sides, resolving the shop’s own account', () => {
    const row = receive(250_000, { to: kpay, fromName: 'Ma Hla' });

    expect(row.type).toBe('RECEIVE');
    expect(row.toAccountId).toBe(kpay);
    expect(row.toAccountName).toBe('Kanbawza');
    expect(row.toAccountKey).toBe('Kpay');
    expect(row.fromAccountId).toBeNull();
    expect(row.fromName).toBe('Ma Hla');
    // The number and holder belong to the movement, not to the bank.
    expect(row.fromAccountNumber).toBe('09-111-2222');
    expect(row.toAccountNumber).toBe('001-22-3333');
    expect(row.toName).toBe('Green Mobile');
    expect(row.amount).toBe(250_000);
    expect(row.isDeleted).toBe(0);
    expect(row.createdByName).toBe('Owner');
  });

  it('reads the date and time as the shop’s own wall clock', () => {
    const row = createBankTransaction(
      {
        type: 'RECEIVE',
        transactionAt: '2026-03-05T14:45',
        fromAccountId: undefined,
        fromAccountNumber: '09-111-2222',
        fromName: 'Ma Hla',
        toAccountId: kpay,
        toAccountNumber: '001-22-3333',
        toName: 'Green Mobile',
        amount: 10_000,
        feeBasisPoints: 0,
        feeDirection: 'RECEIVE',
        notes: undefined,
      },
      actor,
      ctx.db,
    );

    // The business day is what reports group on, so it must be the local date the
    // user picked — never a UTC date that could be the day either side of it.
    expect(row.transactionDay).toBe('2026-03-05');
    expect(row.transactionDate).toBe(localDateTimeToInstant('2026-03-05T14:45'));
    expect(new Date(row.transactionDate).getHours()).toBe(14);
  });

  it('defaults the form to now', () => {
    expect(nowLocalDateTime()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(nowLocalDateTime().slice(0, 10)).toBe(businessDay());
  });

  it('requires one of the shop’s accounts on the side the money moved', () => {
    // Without this the headline totals would move while no balance did.
    const noSource = captureError(() =>
      createBankTransaction(
        {
          type: 'TRANSFER',
          transactionAt: at(),
          fromAccountId: undefined,
          fromAccountNumber: '1',
          fromName: 'Somebody',
          toAccountId: undefined,
          toAccountNumber: '2',
          toName: 'Somebody else',
          amount: 1_000,
          feeBasisPoints: 0,
          feeDirection: 'RECEIVE',
          notes: undefined,
        },
        actor,
        ctx.db,
      ),
    );
    expect(noSource.code).toBe('VALIDATION');
    expect(noSource.fields?.fromAccountId).toBeTruthy();

    const noDestination = captureError(() =>
      createBankTransaction(
        {
          type: 'RECEIVE',
          transactionAt: at(),
          fromAccountId: undefined,
          fromAccountNumber: '1',
          fromName: 'Somebody',
          toAccountId: undefined,
          toAccountNumber: '2',
          toName: 'Somebody else',
          amount: 1_000,
          feeBasisPoints: 0,
          feeDirection: 'RECEIVE',
          notes: undefined,
        },
        actor,
        ctx.db,
      ),
    );
    expect(noDestination.code).toBe('VALIDATION');
    expect(noDestination.fields?.toAccountId).toBeTruthy();
  });

  it('requires an account number and a name on both sides', () => {
    // The number belongs to the movement, not to the bank: one registered wallet
    // serves a different account number on almost every payment. Checked at the
    // schema, which is where the trim and the requirement live.
    const base = {
      type: 'RECEIVE' as const,
      transactionAt: at(),
      toAccountId: kpay,
      amount: 1_000,
      fromAccountNumber: '09-111-2222',
      fromName: 'Ma Hla',
      toAccountNumber: '001-22-3333',
      toName: 'Green Mobile',
    };

    for (const field of ['fromAccountNumber', 'fromName', 'toAccountNumber', 'toName']) {
      const payload: Record<string, unknown> = { ...base, [field]: '   ' };
      expect(
        zCreateBankTransaction.safeParse(payload).success,
        `blank ${field} was accepted`,
      ).toBe(false);
    }

    // Otherwise taken as typed, only trimmed: real numbers carry dashes and spaces.
    const parsed = zCreateBankTransaction.parse({
      ...base,
      fromAccountNumber: ' 0012-3456 7890 ',
      fromName: ' Ma Hla ',
    });
    expect(parsed.fromAccountNumber).toBe('0012-3456 7890');
    expect(parsed.fromName).toBe('Ma Hla');
  });

  it('allows the same account on both sides, and counts the row once', () => {
    // The pickers name the PROVIDER on each side, so a customer paying by Kpay
    // into the shop's Kpay is one row with Kpay twice. This is the case that used
    // to be double-counted: it showed as money in AND money out.
    receive(1_000_000, { to: kpay });
    const same = transfer(250_000, { from: kpay, to: kpay });

    expect(same.fromAccountId).toBe(kpay);
    expect(same.toAccountId).toBe(kpay);

    const overview = bankingOverview(ALL_TIME, ctx.db);
    const account = overview.accounts.find((a) => a.accountId === kpay)!;

    // A TRANSFER is money out, once, whatever is on the other side.
    expect(account.transferred).toBe(250_000);
    expect(account.received).toBe(1_000_000);
    expect(account.balance).toBe(750_000);
    expect(overview.totals.transferred).toBe(250_000);
    expect(overview.totals.received).toBe(1_000_000);
    expect(overview.totals.count).toBe(2);
  });

  it('refuses a zero or negative amount', () => {
    expect(captureError(() => receive(0)).code).toBe('VALIDATION');
    expect(captureError(() => receive(-5_000)).code).toBe('VALIDATION');
  });

  it('refuses an account that does not exist', () => {
    expect(captureError(() => receive(1_000, { to: 'no-such-account' })).code).toBe('NOT_FOUND');
  });
});

// -----------------------------------------------------------------------------
// Fees
// -----------------------------------------------------------------------------

describe('the fee on a movement', () => {
  /**
   * The figure the form promises.
   *
   * Amounts here are minor units, so 1,000,000.00 is 100,000,000 and the fee
   * 5,000.00 is 500,000. Written out because a percentage of a percentage of a
   * scaled integer is exactly the kind of arithmetic that looks right and is not.
   */
  it('works out 0.5% of 1,000,000 as 5,000', () => {
    const row = receive(100_000_000, { feeBasisPoints: 50 });

    expect(row.feeBasisPoints).toBe(50);
    expect(row.feeAmount).toBe(500_000);
    expect(formatMoney(row.feeAmount)).toBe('5,000.00');
  });

  it('records which way the fee went', () => {
    const earned = receive(100_000_000, { feeBasisPoints: 50, feeDirection: 'RECEIVE' });
    const charged = transfer(100_000_000, { feeBasisPoints: 50, feeDirection: 'PAY' });

    expect(earned.feeDirection).toBe('RECEIVE');
    expect(charged.feeDirection).toBe('PAY');
    // Same rate, same amount — only the direction differs. The fee is not
    // negated in storage; which way it went is a separate column so that a
    // report can total the two sides independently.
    expect(charged.feeAmount).toBe(earned.feeAmount);
  });

  it('is zero when no percentage was entered', () => {
    const row = receive(100_000_000);
    expect(row.feeBasisPoints).toBe(0);
    expect(row.feeAmount).toBe(0);
  });

  it('calculates the fee itself rather than trusting what it is sent', () => {
    // The channel payload carries the RATE, never the money — the same rule the
    // cart follows for prices (§68). If feeAmount were ever accepted from the
    // renderer, this object would set it and the stored row would disagree with
    // the arithmetic.
    const sent = { feeAmount: 999_999_999 } as Record<string, unknown>;
    expect(Object.keys(zCreateBankTransaction.shape)).not.toContain('feeAmount');

    const row = createBankTransaction(
      {
        type: 'RECEIVE',
        transactionAt: at(),
        fromAccountId: undefined,
        fromAccountNumber: '09-111-2222',
        fromName: 'Ma Hla',
        toAccountId: kpay,
        toAccountNumber: '001-22-3333',
        toName: 'Green Mobile',
        amount: 100_000_000,
        feeBasisPoints: 50,
        feeDirection: 'RECEIVE',
        notes: undefined,
        ...sent,
      },
      actor,
      ctx.db,
    );

    expect(row.feeAmount).toBe(500_000);
  });

  it('rounds a fee that does not divide evenly, rather than truncating', () => {
    // 333.33 at 7.5% is 24.99975 — a quarter of a satang short of 25.00.
    const row = receive(33_333, { feeBasisPoints: 750 });
    expect(row.feeAmount).toBe(2_500);
  });

  it('refuses a rate above 100%', () => {
    const tooHigh = zCreateBankTransaction.safeParse({
      type: 'RECEIVE',
      transactionAt: at(),
      fromAccountNumber: '09-111-2222',
      fromName: 'Ma Hla',
      toAccountId: kpay,
      toAccountNumber: '001-22-3333',
      toName: 'Green Mobile',
      amount: 100_000,
      feeBasisPoints: 10_001,
      feeDirection: 'RECEIVE',
    });
    expect(tooHigh.success).toBe(false);
  });

  it('defaults to no fee when the payload omits it, so old callers still work', () => {
    const parsed = zCreateBankTransaction.parse({
      type: 'RECEIVE',
      transactionAt: at(),
      fromAccountNumber: '09-111-2222',
      fromName: 'Ma Hla',
      toAccountId: kpay,
      toAccountNumber: '001-22-3333',
      toName: 'Green Mobile',
      amount: 100_000,
    });
    expect(parsed.feeBasisPoints).toBe(0);
    expect(parsed.feeDirection).toBe('RECEIVE');
  });

  it('totals fees by the direction of the fee, not the type of the movement', () => {
    // The distinction that makes this worth a test: the fee PAID here sits on a
    // RECEIVE row. Splitting fees by the row's type would file it under money
    // earned; splitting by the fee's own direction — which is what the shop
    // actually chose on the form — files it correctly under money paid out.
    receive(100_000_000, { feeBasisPoints: 50, feeDirection: 'RECEIVE' });
    receive(100_000, { feeBasisPoints: 100, feeDirection: 'PAY' });
    transfer(400_000, { feeBasisPoints: 25, feeDirection: 'RECEIVE' });

    const { totals } = bankingOverview(ALL_TIME, ctx.db);

    expect(totals.feeReceived).toBe(500_000 + 1_000);
    expect(totals.feePaid).toBe(1_000);
  });

  it('adds fees into the actual total on the side each one belongs to', () => {
    receive(100_000_000, { feeBasisPoints: 50, feeDirection: 'RECEIVE' });
    receive(100_000, { feeBasisPoints: 100, feeDirection: 'PAY' });
    transfer(550_000);

    const { totals } = bankingOverview(ALL_TIME, ctx.db);

    expect(totals.received).toBe(100_100_000);
    expect(totals.transferred).toBe(550_000);
    expect(totals.net).toBe(99_550_000);
    // net + fees earned - fees paid. Written out because getting the paid fee on
    // the wrong side of this is an easy and invisible mistake: it was wrong by
    // twice the fee when this figure was first described.
    expect(totals.netAfterFees).toBe(99_550_000 + 500_000 - 1_000);
  });

  it('reports no fees rather than nothing when none were charged', () => {
    receive(100_000);
    const { totals } = bankingOverview(ALL_TIME, ctx.db);

    expect(totals.feeReceived).toBe(0);
    expect(totals.feePaid).toBe(0);
    expect(totals.netAfterFees).toBe(totals.net);
  });

  it('keeps a deleted movement out of the fee totals', () => {
    const kept = receive(100_000_000, { feeBasisPoints: 50, feeDirection: 'RECEIVE' });
    const removed = receive(100_000_000, { feeBasisPoints: 50, feeDirection: 'RECEIVE' });
    deleteBankTransaction(removed.id, 'Recorded twice', actor, ctx.db);

    const { totals } = bankingOverview(ALL_TIME, ctx.db);
    expect(totals.feeReceived).toBe(500_000);
    expect(kept.feeAmount).toBe(500_000);
  });

  it('leaves the balances alone', () => {
    // What the shop asked for: the fee is recorded beside the movement, not
    // folded into it. 1,000,000 received with a 5,000 fee still moves exactly
    // 1,000,000 into the account. Changing this is a decision about the books,
    // not a detail — so it is pinned here rather than left to drift.
    receive(100_000_000, { feeBasisPoints: 50, feeDirection: 'RECEIVE' });

    const overview = bankingOverview(ALL_TIME, ctx.db);
    const account = overview.accounts.find((a) => a.accountId === kpay)!;

    expect(account.balance).toBe(100_000_000);
    expect(overview.totals.received).toBe(100_000_000);
  });
});

describe('deleting a transaction', () => {
  it('keeps the row and stops it counting', () => {
    const kept = receive(300_000);
    const removed = receive(700_000);

    deleteBankTransaction(removed.id, 'Duplicate entry', actor, ctx.db);

    const visible = listBankTransactions(
      { ...ALL_TIME, includeDeleted: false, page: 0, pageSize: 50 },
      ctx.db,
    );
    expect(visible.rows.map((r) => r.id)).toEqual([kept.id]);
    expect(visible.receiveTotal).toBe(300_000);

    // Still there, with the reason, for anyone asking why a balance changed.
    const all = listBankTransactions(
      { ...ALL_TIME, includeDeleted: true, page: 0, pageSize: 50 },
      ctx.db,
    );
    expect(all.total).toBe(2);
    const deleted = all.rows.find((r) => r.id === removed.id)!;
    expect(deleted.isDeleted).toBe(1);
    expect(deleted.deletedReason).toBe('Duplicate entry');
  });

  it('takes the amount out of the balance', () => {
    const movement = receive(300_000, { to: kpay });
    expect(balanceOf(kpay)).toBe(300_000);

    deleteBankTransaction(movement.id, 'Never arrived', actor, ctx.db);
    expect(balanceOf(kpay)).toBe(0);
  });

  it('is idempotent', () => {
    const movement = receive(300_000);
    deleteBankTransaction(movement.id, 'First', actor, ctx.db);
    deleteBankTransaction(movement.id, 'Second', actor, ctx.db);

    const all = listBankTransactions(
      { ...ALL_TIME, includeDeleted: true, page: 0, pageSize: 50 },
      ctx.db,
    );
    expect(all.total).toBe(1);
    // The first reason is the one that explains the change; it is not overwritten.
    expect(all.rows[0].deletedReason).toBe('First');
  });

  it('is an administrator-only capability', () => {
    // The channel is gated on this permission, so the role matrix IS the rule.
    expect(roleHasPermission('ADMIN', 'banking.delete')).toBe(true);
    expect(roleHasPermission('MANAGER', 'banking.delete')).toBe(false);
    expect(roleHasPermission('CASHIER', 'banking.delete')).toBe(false);
    // A manager may still record movements.
    expect(roleHasPermission('MANAGER', 'banking.manage')).toBe(true);
    expect(roleHasPermission('CASHIER', 'banking.view')).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Filtering
// -----------------------------------------------------------------------------

describe('filtering the history', () => {
  beforeEach(() => {
    receive(100_000, { day: businessDay() });
    transfer(40_000, { day: businessDay() });
    receive(700_000, { day: addDays(businessDay(), -1) });
    transfer(250_000, { day: addDays(businessDay(), -10), from: aya });
  });

  it('filters to a single day', () => {
    const today = listBankTransactions(
      { ...TODAY, includeDeleted: false, page: 0, pageSize: 50 },
      ctx.db,
    );
    expect(today.total).toBe(2);
    expect(today.receiveTotal).toBe(100_000);
    expect(today.transferTotal).toBe(40_000);
  });

  it('filters to yesterday', () => {
    const yesterday = addDays(businessDay(), -1);
    const result = listBankTransactions(
      { from: yesterday, to: yesterday, includeDeleted: false, page: 0, pageSize: 50 },
      ctx.db,
    );
    expect(result.total).toBe(1);
    expect(result.receiveTotal).toBe(700_000);
  });

  it('filters by type', () => {
    const transfers = listBankTransactions(
      { ...ALL_TIME, type: 'TRANSFER', includeDeleted: false, page: 0, pageSize: 50 },
      ctx.db,
    );
    expect(transfers.total).toBe(2);
    expect(transfers.receiveTotal).toBe(0);
    expect(transfers.transferTotal).toBe(290_000);
  });

  it('filters by account, matching either side of the movement', () => {
    const onAya = listBankTransactions(
      { ...ALL_TIME, accountId: aya, includeDeleted: false, page: 0, pageSize: 50 },
      ctx.db,
    );
    expect(onAya.total).toBe(1);
    expect(onAya.transferTotal).toBe(250_000);
  });

  it('searches the account name and key as well as the typed names', () => {
    const byKey = listBankTransactions(
      { ...ALL_TIME, search: 'AYAPay', includeDeleted: false, page: 0, pageSize: 50 },
      ctx.db,
    );
    expect(byKey.total).toBe(1);

    const bySupplier = listBankTransactions(
      { ...ALL_TIME, search: 'supplier', includeDeleted: false, page: 0, pageSize: 50 },
      ctx.db,
    );
    expect(bySupplier.total).toBe(2);
  });

  it('pages without changing the totals', () => {
    const firstPage = listBankTransactions(
      { ...ALL_TIME, includeDeleted: false, page: 0, pageSize: 2 },
      ctx.db,
    );
    expect(firstPage.rows).toHaveLength(2);
    expect(firstPage.total).toBe(4);
    // The figures describe the whole filtered set, not the page on screen.
    expect(firstPage.receiveTotal).toBe(800_000);
    expect(firstPage.transferTotal).toBe(290_000);
  });
});

// -----------------------------------------------------------------------------
// Balances
// -----------------------------------------------------------------------------

function balanceOf(accountId: string): number {
  const overview = bankingOverview(ALL_TIME, ctx.db);
  return overview.accounts.find((a) => a.accountId === accountId)!.balance;
}

describe('balances', () => {
  it('is received less transferred, per account', () => {
    receive(1_000_000, { to: kpay });
    receive(500_000, { to: kpay });
    transfer(300_000, { from: kpay });

    const overview = bankingOverview(ALL_TIME, ctx.db);
    const account = overview.accounts.find((a) => a.accountId === kpay)!;

    expect(account.received).toBe(1_500_000);
    expect(account.transferred).toBe(300_000);
    expect(account.net).toBe(1_200_000);
    expect(account.balance).toBe(1_200_000);
    expect(account.count).toBe(3);
  });

  it('treats a transfer as money out even when another registered bank is named', () => {
    receive(1_000_000, { to: kpay });
    transfer(400_000, { from: kpay, to: aya });

    const overview = bankingOverview(ALL_TIME, ctx.db);
    const from = overview.accounts.find((a) => a.accountId === kpay)!;
    const to = overview.accounts.find((a) => a.accountId === aya)!;

    // The type the user chose is what says which way the money went, and it said
    // out. Nothing is credited to the account merely named on the other side —
    // that side is the recipient's provider, not a second account of the shop's.
    expect(from.transferred).toBe(400_000);
    expect(from.balance).toBe(600_000);
    expect(to.received).toBe(0);
    expect(to.balance).toBe(0);
    expect(overview.bankBalance).toBe(600_000);

    expect(overview.totals.count).toBe(2);
    expect(overview.totals.received).toBe(1_000_000);
    expect(overview.totals.transferred).toBe(400_000);
  });

  it('reports the same split as the transaction list, so the two cannot disagree', () => {
    // The bug this pins: the strip at the top summed by DIRECTION while the line
    // under the table summed by TYPE, so two Kpay-to-Kpay rows showed 1,500,000
    // both in and out while the list correctly showed 1,000,000 out, 500,000 in.
    receive(500_000, { to: kpay, from: kpay });
    transfer(1_000_000, { from: kpay, to: kpay });

    const overview = bankingOverview(TODAY, ctx.db);
    const listed = listBankTransactions(
      { ...TODAY, includeDeleted: false, page: 0, pageSize: 50 },
      ctx.db,
    );

    expect(overview.totals.transferred).toBe(1_000_000);
    expect(overview.totals.received).toBe(500_000);
    expect(overview.totals.transferred).toBe(listed.transferTotal);
    expect(overview.totals.received).toBe(listed.receiveTotal);
    expect(overview.totals.count).toBe(listed.total);
  });

  it('adds the per-account money columns up to the totals', () => {
    receive(900_000, { to: kpay });
    receive(300_000, { to: aya });
    transfer(100_000, { from: aya });
    transfer(250_000, { from: kpay, to: aya });

    const overview = bankingOverview(ALL_TIME, ctx.db);
    const sum = (pick: (a: (typeof overview.accounts)[number]) => number) =>
      overview.accounts.reduce((total, account) => total + pick(account), 0);

    expect(sum((a) => a.received)).toBe(overview.totals.received);
    expect(sum((a) => a.transferred)).toBe(overview.totals.transferred);
    expect(sum((a) => a.balance)).toBe(overview.bankBalance);
    expect(overview.totals.net).toBe(overview.totals.received - overview.totals.transferred);
  });

  it('shows the period figures for the range but the balance for all time', () => {
    receive(800_000, { to: kpay, day: addDays(businessDay(), -5) });
    receive(200_000, { to: kpay, day: businessDay() });

    const today = bankingOverview(TODAY, ctx.db).accounts.find((a) => a.accountId === kpay)!;

    // Only today's movement is in the period...
    expect(today.received).toBe(200_000);
    expect(today.net).toBe(200_000);
    // ...but the account really does hold both. A balance that fell when somebody
    // picked "Today" would read as money going missing.
    expect(today.balance).toBe(1_000_000);
  });

  it('keeps a switched-off account visible while it still holds money', () => {
    receive(600_000, { to: aya });
    saveBankAccount(
      { id: aya, name: 'AYA Bank', key: 'AYAPay', description: undefined, isActive: false },
      actor,
      ctx.db,
    );

    const overview = bankingOverview(ALL_TIME, ctx.db);
    const retired = overview.accounts.find((a) => a.accountId === aya);
    expect(retired?.isActive).toBe(0);
    expect(retired?.balance).toBe(600_000);
    expect(overview.bankBalance).toBe(600_000);
  });

  it('leaves an unused switched-off account out of the strip', () => {
    saveBankAccount(
      { id: aya, name: 'AYA Bank', key: 'AYAPay', description: undefined, isActive: false },
      actor,
      ctx.db,
    );
    expect(bankingOverview(ALL_TIME, ctx.db).accounts.map((a) => a.key)).toEqual(['Kpay']);
  });

  it('reports zeroes rather than nulls for an account with no movements', () => {
    const overview = bankingOverview(TODAY, ctx.db);
    for (const account of overview.accounts) {
      expect(account.received).toBe(0);
      expect(account.transferred).toBe(0);
      expect(account.balance).toBe(0);
    }
    expect(overview.bankBalance).toBe(0);
    // Exhaustive on purpose: a new total added without a zero case is a card
    // that reads "undefined" on the day a shop opens.
    expect(overview.totals).toEqual({
      received: 0,
      transferred: 0,
      net: 0,
      feeReceived: 0,
      feePaid: 0,
      netAfterFees: 0,
      count: 0,
    });
  });
});

// -----------------------------------------------------------------------------
// Cash in hand
// -----------------------------------------------------------------------------

describe('cash in hand', () => {
  it('distinguishes "never counted" from "counted zero"', () => {
    const before = cashInHand(ctx.db);
    expect(before.recorded).toBe(false);
    expect(before.amount).toBe(0);

    saveCashCount({ amount: 0, notes: 'Emptied the till' }, actor, ctx.db);

    const after = cashInHand(ctx.db);
    expect(after.recorded).toBe(true);
    expect(after.amount).toBe(0);
  });

  it('keeps the latest count and who took it', () => {
    saveCashCount({ amount: 450_000, notes: undefined }, actor, ctx.db);
    const latest = saveCashCount({ amount: 380_000, notes: 'After paying the courier' }, actor, ctx.db);

    expect(latest.amount).toBe(380_000);
    expect(latest.countedByName).toBe('Owner');
    expect(latest.notes).toBe('After paying the courier');
    expect(cashInHand(ctx.db).amount).toBe(380_000);
  });

  it('keeps every count, so the figure has a history', () => {
    saveCashCount({ amount: 100_000, notes: undefined }, actor, ctx.db);
    saveCashCount({ amount: 200_000, notes: undefined }, actor, ctx.db);

    const counts = ctx.db.prepare(`SELECT COUNT(*) AS n FROM "CashCount"`).get() as { n: number };
    expect(counts.n).toBe(2);
  });

  it('records the count against the shop’s own business day', () => {
    saveCashCount({ amount: 100_000, notes: undefined }, actor, ctx.db);
    const row = ctx.db.prepare(`SELECT countedDay FROM "CashCount"`).get() as { countedDay: string };
    // Not the UTC date: a count taken at 8pm belongs to that evening.
    expect(row.countedDay).toBe(businessDay());
  });

  it('travels on the overview, so the screen needs one call', () => {
    saveCashCount({ amount: 275_000, notes: undefined }, actor, ctx.db);
    expect(bankingOverview(TODAY, ctx.db).cashInHand.amount).toBe(275_000);
  });
});

// -----------------------------------------------------------------------------
// Audit
// -----------------------------------------------------------------------------

describe('audit trail', () => {
  it('records every banking action against the user who took it', () => {
    const movement = receive(500_000);
    deleteBankTransaction(movement.id, 'Wrong account', actor, ctx.db);
    saveCashCount({ amount: 120_000, notes: undefined }, actor, ctx.db);

    const entries = ctx.db
      .prepare(
        `SELECT action, entityName, summary FROM "AuditLog"
          WHERE entityName IN ('BankAccount', 'BankTransaction', 'CashCount')
          ORDER BY createdAt ASC, rowid ASC`,
      )
      .all() as Array<{ action: string; entityName: string; summary: string }>;

    expect(entries.map((e) => `${e.action} ${e.entityName}`)).toEqual([
      'CREATE BankAccount',
      'CREATE BankAccount',
      'CREATE BankTransaction',
      'DELETE BankTransaction',
      'CREATE CashCount',
    ]);
    expect(entries[3].summary).toContain('Wrong account');
  });
});

/** Runs `fn`, and fails the test unless it threw an AppError. */
function captureError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('Expected an AppError to be thrown, but the call succeeded');
}
