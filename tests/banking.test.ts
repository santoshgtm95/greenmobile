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
  getBankAdvance,
  listBankAccounts,
  listBankAdvances,
  listBankTransactions,
  openBankAdvance,
  saveBankAccount,
  saveCashCount,
  saveBankBalances,
  withdrawFromBankAdvance,
} from '../electron/services/banking.service';
import { AppError } from '../shared/errors';
import { businessDay, addDays, nowLocalDateTime, localDateTimeToInstant } from '../shared/datetime';
import { roleHasPermission, type BankFeeDirection } from '../shared/domain';
import { formatMoney } from '../shared/money';
import {
  zCreateBankTransaction,
  zWithdrawBankAdvance,
  type FirstRunSetupInput,
} from '../shared/validation';

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

  it('Account Receive (Cash Out) + Fee Received: actual is amount - fee and subtracts from cash in hand', () => {
    saveCashCount({ amount: 1_000_000, notes: 'Morning till' }, actor, ctx.db);
    // Amount: 500,000, Fee Received: 2,500 (50 bps) -> Actual: 497,500
    receive(500_000, { feeBasisPoints: 50, feeDirection: 'RECEIVE' });
    expect(cashInHand(ctx.db).amount).toBe(502_500); // 1,000,000 - 497,500
  });

  it('Account Receive (Cash Out) + Fee Pay: actual is amount + fee and subtracts from cash in hand', () => {
    saveCashCount({ amount: 1_000_000, notes: 'Morning till' }, actor, ctx.db);
    // Amount: 500,000, Fee Pay: 2,500 (50 bps) -> Actual: 502,500
    receive(500_000, { feeBasisPoints: 50, feeDirection: 'PAY' });
    expect(cashInHand(ctx.db).amount).toBe(497_500); // 1,000,000 - 502,500
  });

  it('Account Transfer (Cash In) + Fee Pay: actual is amount - fee and adds to cash in hand', () => {
    saveCashCount({ amount: 500_000, notes: 'Morning till' }, actor, ctx.db);
    // Amount: 1,000,000, Fee Pay: 1,000 (10 bps) -> Actual: 999,000
    transfer(1_000_000, { feeBasisPoints: 10, feeDirection: 'PAY' });
    expect(cashInHand(ctx.db).amount).toBe(1_499_000); // 500,000 + 999,000
  });

  it('Account Transfer (Cash In) + Fee Received: actual is amount + fee and adds to cash in hand', () => {
    saveCashCount({ amount: 500_000, notes: 'Morning till' }, actor, ctx.db);
    // Amount: 1,000,000, Fee Received: 1,000 (10 bps) -> Actual: 1,001,000
    transfer(1_000_000, { feeBasisPoints: 10, feeDirection: 'RECEIVE' });
    expect(cashInHand(ctx.db).amount).toBe(1_501_000); // 500,000 + 1,001,000
  });

  it('reverses cash in hand adjustment when an ordinary transaction is deleted', () => {
    saveCashCount({ amount: 500_000, notes: 'Morning till' }, actor, ctx.db);
    const movement = transfer(1_000_000, { feeBasisPoints: 10, feeDirection: 'RECEIVE' });
    expect(cashInHand(ctx.db).amount).toBe(1_501_000);
    deleteBankTransaction(movement.id, 'Entered by mistake', actor, ctx.db);
    expect(cashInHand(ctx.db).amount).toBe(500_000);
  });
});

// -----------------------------------------------------------------------------
// In the banks / bank balances
// -----------------------------------------------------------------------------

describe('editing in the banks / bank balances', () => {
  it('increases an account balance by creating a receive adjustment and updates overview bankBalance without touching cash in hand', () => {
    saveCashCount({ amount: 500_000, notes: 'Morning till' }, actor, ctx.db);
    expect(cashInHand(ctx.db).amount).toBe(500_000);
    expect(bankingOverview(TODAY, ctx.db).bankBalance).toBe(0);

    const res = saveBankBalances(
      { balances: [{ accountId: kpay, balance: 350_000 }], notes: 'Opening bank balance' },
      actor,
      ctx.db,
    );
    expect(res.count).toBe(1);

    const overview = bankingOverview(TODAY, ctx.db);
    expect(overview.bankBalance).toBe(350_000);
    const kpayPos = overview.accounts.find((a) => a.accountId === kpay);
    expect(kpayPos?.balance).toBe(350_000);

    // Cash in hand is untouched!
    expect(cashInHand(ctx.db).amount).toBe(500_000);
  });

  it('decreases an account balance by creating a transfer adjustment without touching cash in hand', () => {
    saveBankBalances(
      { balances: [{ accountId: kpay, balance: 500_000 }] },
      actor,
      ctx.db,
    );
    expect(bankingOverview(TODAY, ctx.db).bankBalance).toBe(500_000);

    saveCashCount({ amount: 200_000, notes: undefined }, actor, ctx.db);

    const res = saveBankBalances(
      { balances: [{ accountId: kpay, balance: 300_000 }] },
      actor,
      ctx.db,
    );
    expect(res.count).toBe(1);

    const overview = bankingOverview(TODAY, ctx.db);
    expect(overview.bankBalance).toBe(300_000);
    const kpayPos = overview.accounts.find((a) => a.accountId === kpay);
    expect(kpayPos?.balance).toBe(300_000);

    // Cash in hand is untouched!
    expect(cashInHand(ctx.db).amount).toBe(200_000);
  });

  it('updates multiple accounts in a single call', () => {
    const res = saveBankBalances(
      {
        balances: [
          { accountId: kpay, balance: 400_000 },
          { accountId: aya, balance: 600_000 },
        ],
      },
      actor,
      ctx.db,
    );
    expect(res.count).toBe(2);

    const overview = bankingOverview(TODAY, ctx.db);
    expect(overview.bankBalance).toBe(1_000_000);
    expect(overview.accounts.find((a) => a.accountId === kpay)?.balance).toBe(400_000);
    expect(overview.accounts.find((a) => a.accountId === aya)?.balance).toBe(600_000);
  });

  it('skips accounts with zero delta', () => {
    saveBankBalances({ balances: [{ accountId: kpay, balance: 250_000 }] }, actor, ctx.db);
    const res = saveBankBalances(
      {
        balances: [
          { accountId: kpay, balance: 250_000 },
          { accountId: aya, balance: 100_000 },
        ],
      },
      actor,
      ctx.db,
    );
    expect(res.count).toBe(1);
    expect(bankingOverview(TODAY, ctx.db).bankBalance).toBe(350_000);
  });

  it('refuses to adjust a switched-off account', () => {
    saveBankAccount(
      { id: aya, name: 'AYA Bank', key: 'AYAPay', description: undefined, isActive: false },
      actor,
      ctx.db,
    );

    const error = captureError(() =>
      saveBankBalances({ balances: [{ accountId: aya, balance: 100_000 }] }, actor, ctx.db),
    );
    expect(error.code).toBe('INVALID_STATE');
    expect(error.message).toContain('switched off');
  });
});

// -----------------------------------------------------------------------------
// Audit
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Customer advances
// -----------------------------------------------------------------------------

describe('customer advances', () => {
  /** A customer's money arriving into the shop's Kpay, to collect later. */
  function openAdvance(
    amount: number,
    overrides: Partial<{
      day: string;
      time: string;
      feeBasisPoints: number;
      feeDirection: BankFeeDirection;
      customer: string;
    }> = {},
  ) {
    return openBankAdvance(
      {
        transactionAt: at(overrides.day, overrides.time),
        fromAccountId: undefined,
        fromAccountNumber: '09-555-0001',
        fromName: overrides.customer ?? 'U Aung',
        toAccountId: kpay,
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

  /** Paying some of it back out of the shop's Kpay to the customer. */
  function withdraw(
    advanceId: string,
    amount: number,
    overrides: Partial<{ day: string; time: string; feeBasisPoints: number }> = {},
  ) {
    return withdrawFromBankAdvance(
      {
        advanceId,
        transactionAt: at(overrides.day, overrides.time),
        fromAccountId: kpay,
        fromAccountNumber: '001-22-3333',
        fromName: 'Green Mobile',
        toAccountId: undefined,
        toAccountNumber: '09-555-0001',
        toName: 'U Aung',
        amount,
        feeBasisPoints: overrides.feeBasisPoints ?? 0,
        feeDirection: 'RECEIVE',
        notes: undefined,
      },
      actor,
      ctx.db,
    );
  }

  const MILLION = 100_000_000; // 1,000,000.00 in minor units

  it('follows the shop’s own example: 3,000,000 in, 1,000,000 out, then the rest', () => {
    // 03/10/2026: the customer transfers 3,000,000 in.
    const opened = openAdvance(3 * MILLION, { day: '2026-10-03' });
    expect(opened.amount).toBe(3 * MILLION);
    expect(opened.remaining).toBe(3 * MILLION);
    expect(opened.status).toBe('OPEN');
    expect(opened.type).toBe('RECEIVE');
    expect(opened.advanceRole).toBe('DEPOSIT');

    // 10/10/2026: collects 1,000,000. Two million left.
    const partly = withdraw(opened.id, MILLION, { day: '2026-10-10' });
    expect(partly.advance.withdrawn).toBe(MILLION);
    expect(partly.advance.remaining).toBe(2 * MILLION);
    expect(partly.advance.status).toBe('OPEN');
    expect(partly.withdrawals).toHaveLength(1);
    expect(partly.withdrawals[0].type).toBe('TRANSFER');
    expect(partly.withdrawals[0].advanceDepositId).toBe(opened.id);

    // Another day: the remaining 2,000,000. Nothing left, and settled.
    const done = withdraw(opened.id, 2 * MILLION, { day: '2026-10-15' });
    expect(done.advance.remaining).toBe(0);
    expect(done.advance.status).toBe('SETTLED');
    expect(done.advance.withdrawalCount).toBe(2);
  });

  it('supports withdrawal in cash without an account number, and saves to the database', () => {
    const opened = openAdvance(MILLION);
    const withdrawn = withdrawFromBankAdvance(
      {
        advanceId: opened.id,
        transactionAt: at('2026-10-10', '15:00'),
        fromAccountId: kpay,
        fromAccountNumber: '001-22-3333',
        fromName: 'Green Mobile',
        toAccountId: undefined,
        toAccountNumber: '',
        toName: 'Cash',
        amount: 500_000,
        feeBasisPoints: 0,
        feeDirection: 'RECEIVE',
        notes: 'Cash withdrawal',
      },
      actor,
      ctx.db,
    );

    expect(withdrawn.advance.remaining).toBe(MILLION - 500_000);
    expect(withdrawn.withdrawals).toHaveLength(1);
    const w = withdrawn.withdrawals[0];
    expect(w.toName).toBe('Cash');
    expect(w.toAccountNumber).toBeNull();
    expect(w.toAccountId).toBeNull();
    expect(w.fromAccountId).toBeNull();

    // Verify row in database directly
    const row = ctx.db
      .prepare('SELECT toAccountId, toAccountNumber, toName, fromAccountId FROM "BankTransaction" WHERE id = ?')
      .get(w.id) as { toAccountId: string | null; toAccountNumber: string | null; toName: string | null; fromAccountId: string | null };
    expect(row.toAccountId).toBeNull();
    expect(row.toAccountNumber).toBeNull();
    expect(row.toName).toBe('Cash');
    expect(row.fromAccountId).toBeNull();
  });

  it('when user withdraws Cash from advance, minuses that amount from Cash in hand and leaves In the banks untouched', () => {
    saveCashCount({ amount: MILLION, notes: 'Morning till' }, actor, ctx.db);
    expect(cashInHand(ctx.db).amount).toBe(MILLION);

    const opened = openAdvance(MILLION); // 1,000,000 received into kpay
    expect(bankingOverview(ALL_TIME, ctx.db).bankBalance).toBe(MILLION);
    expect(cashInHand(ctx.db).amount).toBe(MILLION);

    const withdrawn = withdrawFromBankAdvance(
      {
        advanceId: opened.id,
        transactionAt: at('2026-10-10', '15:00'),
        amount: 30_000_000,
        toName: 'Cash',
        withdrawalMethod: 'cash',
      },
      actor,
      ctx.db,
    );

    expect(withdrawn.advance.remaining).toBe(70_000_000);
    // Cash in hand is reduced by 300,000 (30_000_000 minor units)!
    expect(cashInHand(ctx.db).amount).toBe(70_000_000);
    // In the banks is NOT reduced! It still holds the 1,000,000 deposited.
    expect(bankingOverview(ALL_TIME, ctx.db).bankBalance).toBe(MILLION);

    // Deleting the cash withdrawal restores Cash in hand!
    deleteBankTransaction(withdrawn.withdrawals[0].id, 'Mistake', actor, ctx.db);
    expect(cashInHand(ctx.db).amount).toBe(MILLION);
    expect(bankingOverview(ALL_TIME, ctx.db).bankBalance).toBe(MILLION);
  });

  it('when user withdraws from Account from advance, minuses that amount from In the banks and leaves Cash in hand untouched', () => {
    saveCashCount({ amount: MILLION, notes: 'Morning till' }, actor, ctx.db);
    expect(cashInHand(ctx.db).amount).toBe(MILLION);

    const opened = openAdvance(MILLION); // 1,000,000 received into kpay
    expect(bankingOverview(ALL_TIME, ctx.db).bankBalance).toBe(MILLION);

    const withdrawn = withdrawFromBankAdvance(
      {
        advanceId: opened.id,
        transactionAt: at('2026-10-10', '15:00'),
        fromAccountId: kpay,
        fromAccountNumber: '001-22-3333',
        fromName: 'Green Mobile',
        toName: 'Daw Nu',
        toAccountNumber: '09-999-8888',
        amount: 40_000_000,
        withdrawalMethod: 'account',
      },
      actor,
      ctx.db,
    );

    expect(withdrawn.advance.remaining).toBe(60_000_000);
    // In the banks is reduced by 400,000 (40_000_000 minor units)!
    expect(bankingOverview(ALL_TIME, ctx.db).bankBalance).toBe(60_000_000);
    // Cash in hand is NOT reduced!
    expect(cashInHand(ctx.db).amount).toBe(MILLION);

    // Deleting the account withdrawal restores In the banks!
    deleteBankTransaction(withdrawn.withdrawals[0].id, 'Mistake', actor, ctx.db);
    expect(bankingOverview(ALL_TIME, ctx.db).bankBalance).toBe(MILLION);
    expect(cashInHand(ctx.db).amount).toBe(MILLION);
  });

  it('supports withdrawal to an account and saves the account details in the database', () => {
    const opened = openAdvance(MILLION);
    const withdrawn = withdrawFromBankAdvance(
      {
        advanceId: opened.id,
        transactionAt: at('2026-10-10', '16:00'),
        fromAccountId: kpay,
        fromAccountNumber: '001-22-3333',
        fromName: 'Green Mobile',
        toAccountId: undefined,
        toAccountNumber: '09-999-8888',
        toName: 'Daw Nu',
        amount: 400_000,
        feeBasisPoints: 0,
        feeDirection: 'RECEIVE',
        notes: 'Account transfer',
      },
      actor,
      ctx.db,
    );

    expect(withdrawn.advance.remaining).toBe(MILLION - 400_000);
    expect(withdrawn.withdrawals).toHaveLength(1);
    const w = withdrawn.withdrawals[0];
    expect(w.toName).toBe('Daw Nu');
    expect(w.toAccountNumber).toBe('09-999-8888');

    // Verify row in database directly
    const row = ctx.db
      .prepare('SELECT toAccountId, toAccountNumber, toName FROM "BankTransaction" WHERE id = ?')
      .get(w.id) as { toAccountId: string | null; toAccountNumber: string | null; toName: string | null };
    expect(row.toAccountNumber).toBe('09-999-8888');
    expect(row.toName).toBe('Daw Nu');
  });

  it('refuses to pay out more than is left', () => {
    const opened = openAdvance(3 * MILLION);
    withdraw(opened.id, MILLION);

    const tooMuch = captureError(() => withdraw(opened.id, 2 * MILLION + 1));
    expect(tooMuch.code).toBe('VALIDATION');
    expect(tooMuch.message).toContain('2,000,000.00');
    // And nothing was written by the refused attempt.
    expect(getBankAdvance(opened.id, ctx.db).advance.remaining).toBe(2 * MILLION);
  });

  it('refuses any withdrawal once settled', () => {
    const opened = openAdvance(MILLION);
    withdraw(opened.id, MILLION);
    expect(captureError(() => withdraw(opened.id, 1)).code).toBe('INVALID_STATE');
  });

  it('refuses a withdrawal dated before the deposit', () => {
    const opened = openAdvance(MILLION, { day: '2026-10-10', time: '12:00' });
    expect(
      captureError(() => withdraw(opened.id, 1_000, { day: '2026-10-09' })).code,
    ).toBe('VALIDATION');
    // Later the same day is fine.
    expect(withdraw(opened.id, 1_000, { day: '2026-10-10', time: '15:00' }).advance.withdrawn).toBe(
      1_000,
    );
  });

  it('only draws on an advance, never on an ordinary receipt', () => {
    const ordinary = receive(MILLION);
    expect(captureError(() => withdraw(ordinary.id, 1_000)).code).toBe('INVALID_STATE');
  });

  it('puts the money back when a withdrawal is deleted', () => {
    const opened = openAdvance(MILLION);
    const after = withdraw(opened.id, MILLION);
    expect(after.advance.status).toBe('SETTLED');

    deleteBankTransaction(after.withdrawals[0].id, 'Entered on the wrong advance', actor, ctx.db);

    const restored = getBankAdvance(opened.id, ctx.db);
    expect(restored.advance.remaining).toBe(MILLION);
    expect(restored.advance.status).toBe('OPEN');
    expect(restored.withdrawals).toHaveLength(0);
  });

  it('will not delete a deposit that withdrawals still draw on', () => {
    const opened = openAdvance(MILLION);
    withdraw(opened.id, 1_000);

    const refused = captureError(() =>
      deleteBankTransaction(opened.id, 'Mistake', actor, ctx.db),
    );
    expect(refused.code).toBe('INVALID_STATE');
    expect(refused.message).toContain('withdrawal');
  });

  it('can delete a deposit nothing has been drawn from, and the advance goes with it', () => {
    const opened = openAdvance(MILLION);
    deleteBankTransaction(opened.id, 'Recorded twice', actor, ctx.db);

    expect(captureError(() => getBankAdvance(opened.id, ctx.db)).code).toBe('NOT_FOUND');
    expect(
      listBankAdvances({ page: 0, pageSize: 50 }, ctx.db).rows.map((r) => r.id),
    ).not.toContain(opened.id);
  });

  it('tracks what is owed on the amount, never on the fee', () => {
    // A 0.5% fee on the way in is the shop's income. The customer still has
    // 3,000,000 to collect — not 3,015,000, and not 2,985,000.
    const opened = openAdvance(3 * MILLION, { feeBasisPoints: 50, feeDirection: 'RECEIVE' });
    expect(opened.feeAmount).toBe(1_500_000);
    expect(opened.remaining).toBe(3 * MILLION);

    // A fee on a withdrawal does not take more off what is owed either.
    const after = withdraw(opened.id, MILLION, { feeBasisPoints: 100 });
    expect(after.withdrawals[0].feeAmount).toBe(1_000_000);
    expect(after.advance.remaining).toBe(2 * MILLION);
  });

  it('counts in the balances like any other movement, because the money really moved', () => {
    const opened = openAdvance(3 * MILLION);
    withdraw(opened.id, MILLION);

    const { totals, accounts } = bankingOverview(ALL_TIME, ctx.db);
    expect(totals.received).toBe(3 * MILLION);
    expect(totals.transferred).toBe(MILLION);
    expect(accounts.find((a) => a.accountId === kpay)!.balance).toBe(2 * MILLION);
  });

  it('totals what is held across every open advance, whatever the search', () => {
    const first = openAdvance(3 * MILLION, { customer: 'U Aung' });
    openAdvance(MILLION, { customer: 'Daw Hla' });
    const settled = openAdvance(500_000, { customer: 'Ko Min' });
    withdraw(first.id, MILLION);
    withdraw(settled.id, 500_000);

    const all = listBankAdvances({ page: 0, pageSize: 50 }, ctx.db);
    expect(all.total).toBe(3);
    expect(all.heldTotal).toBe(2 * MILLION + MILLION);
    expect(all.openCount).toBe(2);

    // Filters narrow the rows but must not shrink what the shop is holding.
    const searched = listBankAdvances({ search: 'Hla', page: 0, pageSize: 50 }, ctx.db);
    expect(searched.rows.map((r) => r.fromName)).toEqual(['Daw Hla']);
    expect(searched.heldTotal).toBe(all.heldTotal);

    const open = listBankAdvances({ status: 'OPEN', page: 0, pageSize: 50 }, ctx.db);
    expect(open.rows).toHaveLength(2);
    const done = listBankAdvances({ status: 'SETTLED', page: 0, pageSize: 50 }, ctx.db);
    expect(done.rows.map((r) => r.fromName)).toEqual(['Ko Min']);
  });

  it('marks advance movements in the ordinary history', () => {
    const opened = openAdvance(MILLION);
    withdraw(opened.id, 1_000);

    const { rows } = listBankTransactions(
      { ...ALL_TIME, includeDeleted: false, page: 0, pageSize: 50 },
      ctx.db,
    );
    expect(rows.map((r) => r.advanceRole).sort()).toEqual(['DEPOSIT', 'WITHDRAWAL']);
    // And an ordinary movement is never part of one.
    expect(receive(1_000).advanceRole).toBeNull();
  });

  it('accepts no advance link from the ordinary transaction channel', () => {
    // The link is set only by openBankAdvance / withdrawFromBankAdvance. If the
    // ordinary channel took it, a plain transfer could be filed as a withdrawal
    // against any customer's money without the remaining-balance check.
    const keys = Object.keys(zCreateBankTransaction.shape);
    expect(keys).not.toContain('advanceRole');
    expect(keys).not.toContain('advanceDepositId');
    expect(Object.keys(zWithdrawBankAdvance.shape)).toContain('advanceId');
  });
});

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
