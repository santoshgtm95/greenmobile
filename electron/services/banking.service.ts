/**
 * Banking — money moved between the shop and its banks and mobile wallets.
 *
 * The shop registers its own accounts, because which banks and wallets a shop
 * uses is local knowledge: "Kanbawza" with the key "Kpay", "AYA" with "AYAPay".
 * Two rules follow from that, and they are the reason this file exists rather
 * than a generic lookup table:
 *
 *   THE KEY NEVER CHANGES.  It is the short handle printed on every listed
 *   movement and in every export. Editing it would silently relabel history, so
 *   an UPDATE here never touches the column and an attempt to change it is
 *   refused rather than quietly ignored.
 *
 *   A USED ACCOUNT IS NEVER DELETED.  Deleting it would either orphan the
 *   movements or take them with it, and either way a balance shown last week
 *   stops adding up. An account that has been used can only be deactivated,
 *   which hides it from the new-transaction form but leaves the history intact.
 *
 * The per-account balance is simply what arrived less what left:
 *
 *   balance = SUM(amount WHERE toAccountId = a) - SUM(amount WHERE fromAccountId = a)
 *
 * That only adds up if every movement has one of the shop's own accounts on the
 * side the money moved, so createBankTransaction insists on it. Without that a
 * "receive" belonging to no account would raise the headline received total
 * while changing nobody's balance, and the two figures on the same screen would
 * contradict each other.
 *
 * Cash in hand is a *recorded* figure, not a derived one. Cash also moves
 * through sales, refunds, expenses and service deposits, so a number calculated
 * from this table alone would be a guess presented as a fact. The shop counts
 * the drawer and saves what it counted; each count is kept.
 */
import type { Database as Db } from 'better-sqlite3';
import { getDatabase, transaction } from '../database/connection';
import { newId } from '../utils/id';
import {
  nowInstant,
  businessDay,
  localDateTimeToInstant,
  localDateTimeToDay,
} from '../../shared/datetime';
import { errors } from '../../shared/errors';
import { recordAudit } from './audit.service';
import { nextNumber } from './sequence.service';
import type { SessionUser } from '../session';
import {
  BANK_FEE_DIRECTION_LABELS,
  BANK_TRANSACTION_TYPE_LABELS,
  type BankFeeDirection,
  type BankTransactionType,
} from '../../shared/domain';
import { rateOf } from '../../shared/money';
import type {
  BankTransactionListQuery,
  CreateBankTransactionInput,
  DayRangeInput,
  SaveBankAccountInput,
  SaveCashCountInput,
} from '../../shared/validation';

// -----------------------------------------------------------------------------
// Accounts
// -----------------------------------------------------------------------------

export interface BankAccountRow {
  id: string;
  name: string;
  key: string;
  description: string | null;
  isActive: number;
  transactionCount: number;
  canDelete: boolean;
}

/** Movements against an account, ignoring deleted ones. */
const BANK_ACCOUNT_USE_COUNT = `
  (SELECT COUNT(*) FROM "BankTransaction" t
    WHERE (t.fromAccountId = a.id OR t.toAccountId = a.id) AND t.isDeleted = 0)
`;

/**
 * Whether an account has EVER been used, including by movements since deleted.
 *
 * Deliberately different from the count above: a soft-deleted movement still
 * holds a foreign key to the account, so hard-deleting the account would fail on
 * the constraint — or, worse, succeed and take a piece of history with it.
 */
function hasAnyTransaction(accountId: string, db: Db): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM "BankTransaction"
        WHERE fromAccountId = ? OR toAccountId = ?`,
    )
    .get(accountId, accountId) as { n: number };
  return row.n > 0;
}

export function listBankAccounts(includeInactive = false, db: Db = getDatabase()): BankAccountRow[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.key, a.description, a.isActive,
              ${BANK_ACCOUNT_USE_COUNT} AS transactionCount,
              (SELECT COUNT(*) FROM "BankTransaction" t
                WHERE t.fromAccountId = a.id OR t.toAccountId = a.id) AS everUsed
         FROM "BankAccount" a
        ${includeInactive ? '' : 'WHERE a.isActive = 1'}
        ORDER BY a.name ASC`,
    )
    .all() as Array<Omit<BankAccountRow, 'canDelete'> & { everUsed: number }>;

  return rows.map(({ everUsed, ...row }) => ({ ...row, canDelete: everUsed === 0 }));
}

export function getBankAccount(id: string, db: Db = getDatabase()): BankAccountRow {
  const row = listBankAccounts(true, db).find((account) => account.id === id);
  if (!row) throw errors.notFound('account');
  return row;
}

/**
 * Creates an account, or renames / retires an existing one.
 *
 * The key is written exactly once. On update it is compared and refused, not
 * ignored: a caller trying to change it has misunderstood something, and
 * answering "saved" while keeping the old value would hide that.
 */
export function saveBankAccount(
  input: SaveBankAccountInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): BankAccountRow {
  return transaction(() => {
    const nameClash = db
      .prepare(`SELECT id FROM "BankAccount" WHERE name = ? COLLATE NOCASE AND id IS NOT ?`)
      .get(input.name, input.id ?? null) as { id: string } | undefined;
    if (nameClash) {
      throw errors.validation('An account with that name already exists.', {
        name: 'Already in use',
      });
    }

    const now = nowInstant();

    if (input.id) {
      const before = db
        .prepare(
          `SELECT id, name, key, description, isActive FROM "BankAccount" WHERE id = ?`,
        )
        .get(input.id) as
        | { id: string; name: string; key: string; description: string | null; isActive: number }
        | undefined;
      if (!before) throw errors.notFound('account');

      if (input.key !== before.key) {
        throw errors.invalidState(
          `The key "${before.key}" cannot be changed — it labels every transaction already ` +
            `recorded against ${before.name}. Create a new account instead, and deactivate this one.`,
        );
      }

      // No `key` column here, so the rule holds even if the check above is ever
      // refactored away.
      db.prepare(
        // No `key` column here, so the rule holds even if the check above is ever
        // refactored away.
        `UPDATE "BankAccount" SET name = ?, description = ?, isActive = ?, updatedAt = ?
          WHERE id = ?`,
      ).run(input.name, input.description ?? null, input.isActive ? 1 : 0, now, input.id);

      recordAudit(
        {
          userId: actor.id,
          action: 'UPDATE',
          entityName: 'BankAccount',
          entityId: input.id,
          summary: `Updated account "${input.name}" (${before.key})`,
          oldValues: before,
          newValues: input,
        },
        db,
      );

      return getBankAccount(input.id, db);
    }

    const keyClash = db
      .prepare(`SELECT id, name FROM "BankAccount" WHERE key = ? COLLATE NOCASE`)
      .get(input.key) as { id: string; name: string } | undefined;
    if (keyClash) {
      throw errors.validation(`The key "${input.key}" is already used by ${keyClash.name}.`, {
        key: 'Already in use',
      });
    }

    const id = newId();
    db.prepare(
      `INSERT INTO "BankAccount" (id, name, key, description, isActive, createdBy,
         createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name,
      input.key,
      input.description ?? null,
      input.isActive ? 1 : 0,
      actor.id,
      now,
      now,
    );

    recordAudit(
      {
        userId: actor.id,
        action: 'CREATE',
        entityName: 'BankAccount',
        entityId: id,
        summary: `Registered account "${input.name}" with key ${input.key}`,
        newValues: input,
      },
      db,
    );

    return getBankAccount(id, db);
  }, db);
}

/**
 * Removes an account that was never used.
 *
 * Once a key appears on a transaction the account is part of the shop's
 * financial history and this refuses — the way to retire it is isActive = 0,
 * which is what the message says.
 */
export function deleteBankAccount(
  id: string,
  actor: SessionUser,
  db: Db = getDatabase(),
): { deleted: true } {
  return transaction(() => {
    const before = getBankAccount(id, db);

    if (hasAnyTransaction(id, db)) {
      throw errors.invalidState(
        `"${before.name}" (${before.key}) has transactions recorded against it, so it can no ` +
          `longer be deleted. Switch it off instead — the history stays and it disappears from ` +
          `the new-transaction form.`,
      );
    }

    db.prepare(`DELETE FROM "BankAccount" WHERE id = ?`).run(id);

    recordAudit(
      {
        userId: actor.id,
        action: 'DELETE',
        entityName: 'BankAccount',
        entityId: id,
        summary: `Deleted unused account "${before.name}" (${before.key})`,
        oldValues: before,
      },
      db,
    );

    return { deleted: true as const };
  }, db);
}

// -----------------------------------------------------------------------------
// Transactions
// -----------------------------------------------------------------------------

export interface BankTransactionRow {
  id: string;
  transactionNumber: string;
  type: BankTransactionType;
  transactionDate: string;
  transactionDay: string;
  fromAccountId: string | null;
  fromAccountName: string | null;
  fromAccountKey: string | null;
  fromAccountNumber: string | null;
  fromName: string | null;
  toAccountId: string | null;
  toAccountName: string | null;
  toAccountKey: string | null;
  toAccountNumber: string | null;
  toName: string | null;
  amount: number;
  /** Basis points of the amount: 50 == 0.5%. */
  feeBasisPoints: number;
  /** Minor units, worked out here and stored — never recomputed on read. */
  feeAmount: number;
  feeDirection: BankFeeDirection;
  notes: string | null;
  isDeleted: number;
  deletedReason: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
}

const BANK_TRANSACTION_SELECT = `
  SELECT t.id, t.transactionNumber, t.type, t.transactionDate, t.transactionDay,
         t.fromAccountId, f.name AS fromAccountName, f.key AS fromAccountKey,
         t.fromAccountNumber, t.fromName,
         t.toAccountId, o.name AS toAccountName, o.key AS toAccountKey,
         t.toAccountNumber, t.toName,
         t.amount, t.feeBasisPoints, t.feeAmount, t.feeDirection,
         t.notes, t.isDeleted, t.deletedReason,
         t.createdBy, u.fullName AS createdByName, t.createdAt
    FROM "BankTransaction" t
    LEFT JOIN "BankAccount" f ON f.id = t.fromAccountId
    LEFT JOIN "BankAccount" o ON o.id = t.toAccountId
    LEFT JOIN "User" u ON u.id = t.createdBy
`;

export function listBankTransactions(
  query: BankTransactionListQuery,
  db: Db = getDatabase(),
): {
  rows: BankTransactionRow[];
  total: number;
  /**
   * By TYPE, not by direction — every listed row is one or the other, so these
   * two add up to the total value on screen.
   *
   * Deliberately not named like the overview's received/transferred, which count
   * money IN and OUT of each account: an account-to-account transfer is out of
   * one and into another, and confusing the two pairs of figures is how a screen
   * ends up showing two different "totals" for the same rows.
   */
  transferTotal: number;
  receiveTotal: number;
} {
  const where: string[] = [];
  const params: unknown[] = [];

  if (!query.includeDeleted) where.push('t.isDeleted = 0');

  if (query.from) {
    where.push('t.transactionDay >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('t.transactionDay <= ?');
    params.push(query.to);
  }
  if (query.type) {
    where.push('t.type = ?');
    params.push(query.type);
  }
  if (query.accountId) {
    // Either side: "show me everything that touched this account".
    where.push('(t.fromAccountId = ? OR t.toAccountId = ?)');
    params.push(query.accountId, query.accountId);
  }
  if (query.search) {
    where.push(
      `(t.transactionNumber LIKE ? COLLATE NOCASE OR t.fromName LIKE ? COLLATE NOCASE
        OR t.toName LIKE ? COLLATE NOCASE OR t.notes LIKE ? COLLATE NOCASE
        OR t.fromAccountNumber LIKE ? OR t.toAccountNumber LIKE ?
        OR f.name LIKE ? COLLATE NOCASE OR f.key LIKE ? COLLATE NOCASE
        OR o.name LIKE ? COLLATE NOCASE OR o.key LIKE ? COLLATE NOCASE)`,
    );
    const like = `%${query.search}%`;
    params.push(like, like, like, like, like, like, like, like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // The joins are needed even for the aggregate, because the search matches
  // account names and keys.
  const aggregate = db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN t.type = 'TRANSFER' THEN t.amount ELSE 0 END), 0) AS transferTotal,
              COALESCE(SUM(CASE WHEN t.type = 'RECEIVE' THEN t.amount ELSE 0 END), 0) AS receiveTotal
         FROM "BankTransaction" t
         LEFT JOIN "BankAccount" f ON f.id = t.fromAccountId
         LEFT JOIN "BankAccount" o ON o.id = t.toAccountId
        ${whereSql}`,
    )
    .get(...params) as { n: number; transferTotal: number; receiveTotal: number };

  const rows = db
    .prepare(`${BANK_TRANSACTION_SELECT} ${whereSql} ORDER BY t.transactionDate DESC, t.createdAt DESC LIMIT ? OFFSET ?`)
    .all(...params, query.pageSize, query.page * query.pageSize) as BankTransactionRow[];

  return {
    rows,
    total: aggregate.n,
    transferTotal: aggregate.transferTotal,
    receiveTotal: aggregate.receiveTotal,
  };
}

export function getBankTransaction(id: string, db: Db = getDatabase()): BankTransactionRow {
  const row = db.prepare(`${BANK_TRANSACTION_SELECT} WHERE t.id = ?`).get(id) as
    | BankTransactionRow
    | undefined;
  if (!row) throw errors.notFound('transaction');
  return row;
}

/** An account that may be used on a new movement: it must exist and be switched on. */
function usableAccount(id: string, db: Db): { id: string; name: string; key: string } {
  const row = db
    .prepare(`SELECT id, name, key, isActive FROM "BankAccount" WHERE id = ?`)
    .get(id) as { id: string; name: string; key: string; isActive: number } | undefined;
  if (!row) throw errors.notFound('account');
  if (!row.isActive) {
    throw errors.invalidState(
      `"${row.name}" (${row.key}) is switched off, so no new transaction can be recorded ` +
        `against it. Switch it back on first.`,
    );
  }
  return { id: row.id, name: row.name, key: row.key };
}

export function createBankTransaction(
  input: CreateBankTransactionInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): BankTransactionRow {
  return transaction(() => {
    // Checked here as well as at the IPC boundary, because the balances in
    // bankingOverview are only arithmetic that adds up while this holds — and
    // this function is also reachable directly from tests and future callers.
    if (input.type === 'TRANSFER' && !input.fromAccountId) {
      throw errors.validation('Choose which of your accounts the money left.', {
        fromAccountId: 'Required for a transfer',
      });
    }
    if (input.type === 'RECEIVE' && !input.toAccountId) {
      throw errors.validation('Choose which of your accounts the money arrived in.', {
        toAccountId: 'Required for a receipt',
      });
    }
    // Both sides may be the same account; see the note in shared/validation.ts.
    if (input.amount <= 0) {
      throw errors.validation('Amount must be more than zero.', { amount: 'Required' });
    }

    const from = input.fromAccountId ? usableAccount(input.fromAccountId, db) : null;
    const to = input.toAccountId ? usableAccount(input.toAccountId, db) : null;

    const id = newId();
    const number = nextNumber('banking', db);
    const now = nowInstant();
    // The form supplies a local wall-clock date and time; the instant is derived
    // from the shop's own clock so the day column and the instant always agree.
    const transactionDate = localDateTimeToInstant(input.transactionAt);
    const transactionDay = localDateTimeToDay(input.transactionAt);

    // The fee is calculated HERE, from the amount and the rate, and never taken
    // from the renderer — the same rule the cart follows for prices (§68). The
    // form shows a running figure with this exact function, so what the user saw
    // and what is stored cannot drift apart.
    const feeAmount = rateOf(input.amount, input.feeBasisPoints);

    db.prepare(
      `INSERT INTO "BankTransaction" (id, transactionNumber, type, transactionDate, transactionDay,
         fromAccountId, fromAccountNumber, fromName, toAccountId, toAccountNumber, toName,
         amount, feeBasisPoints, feeAmount, feeDirection,
         notes, isDeleted, deletedReason, createdBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`,
    ).run(
      id,
      number,
      input.type,
      transactionDate,
      transactionDay,
      input.fromAccountId ?? null,
      input.fromAccountNumber,
      input.fromName,
      input.toAccountId ?? null,
      input.toAccountNumber,
      input.toName,
      input.amount,
      input.feeBasisPoints,
      feeAmount,
      input.feeDirection,
      input.notes ?? null,
      actor.id,
      now,
      now,
    );

    // Names the bank when it is one of ours, and always the number that was typed.
    const side = (
      bank: { name: string; key: string } | null,
      accountNumber: string,
      holder: string,
    ) => `${bank ? `${bank.name} (${bank.key}) ` : ''}${accountNumber} ${holder}`.trim();
    const route = [
      side(from, input.fromAccountNumber, input.fromName),
      side(to, input.toAccountNumber, input.toName),
    ].join(' → ');

    recordAudit(
      {
        userId: actor.id,
        action: 'CREATE',
        entityName: 'BankTransaction',
        entityId: id,
        summary:
          `${BANK_TRANSACTION_TYPE_LABELS[input.type]} ${number} — ${input.amount}, ${route}` +
          (feeAmount > 0
            ? ` (fee ${feeAmount} ${BANK_FEE_DIRECTION_LABELS[input.feeDirection].toLowerCase()})`
            : ''),
        // The calculated fee too, not just the rate that was sent in.
        newValues: { ...input, feeAmount },
      },
      db,
    );

    return getBankTransaction(id, db);
  }, db);
}

/**
 * Soft delete, administrators only (enforced by the channel's permission).
 *
 * The row stays so that a balance somebody wrote down last month can still be
 * explained, and so the audit trail has something to point at.
 */
export function deleteBankTransaction(
  id: string,
  reason: string,
  actor: SessionUser,
  db: Db = getDatabase(),
): void {
  transaction(() => {
    const before = getBankTransaction(id, db);
    if (before.isDeleted) return;

    db.prepare(
      `UPDATE "BankTransaction" SET isDeleted = 1, deletedReason = ?, updatedAt = ? WHERE id = ?`,
    ).run(reason, nowInstant(), id);

    recordAudit(
      {
        userId: actor.id,
        action: 'DELETE',
        entityName: 'BankTransaction',
        entityId: id,
        summary: `Deleted ${before.transactionNumber} (${before.amount}) — ${reason}`,
        oldValues: before,
      },
      db,
    );
  }, db);
}

// -----------------------------------------------------------------------------
// Cash in hand
// -----------------------------------------------------------------------------

export interface CashInHandRow {
  amount: number;
  countedAt: string | null;
  countedByName: string | null;
  notes: string | null;
  recorded: boolean;
}

export function cashInHand(db: Db = getDatabase()): CashInHandRow {
  const row = db
    .prepare(
      `SELECT c.amount, c.countedAt, c.notes, u.fullName AS countedByName
         FROM "CashCount" c
         LEFT JOIN "User" u ON u.id = c.createdBy
        ORDER BY c.countedAt DESC, c.createdAt DESC
        LIMIT 1`,
    )
    .get() as Omit<CashInHandRow, 'recorded'> | undefined;

  // Zero and "never counted" are different things, and the screen says which.
  if (!row) {
    return { amount: 0, countedAt: null, countedByName: null, notes: null, recorded: false };
  }
  return { ...row, recorded: true };
}

export function saveCashCount(
  input: SaveCashCountInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): CashInHandRow {
  return transaction(() => {
    const previous = cashInHand(db);
    const now = nowInstant();
    const id = newId();

    db.prepare(
      `INSERT INTO "CashCount" (id, amount, countedAt, countedDay, notes, createdBy, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      // businessDay(), not now.slice(0, 10): the instant is UTC, and a count
      // taken at 8pm in Yangon belongs to that evening, not to tomorrow.
    ).run(id, input.amount, now, businessDay(), input.notes ?? null, actor.id, now);

    recordAudit(
      {
        userId: actor.id,
        action: 'CREATE',
        entityName: 'CashCount',
        entityId: id,
        summary: previous.recorded
          ? `Cash in hand counted as ${input.amount} (was ${previous.amount})`
          : `Cash in hand counted as ${input.amount}`,
        oldValues: previous.recorded ? previous : undefined,
        newValues: input,
      },
      db,
    );

    return cashInHand(db);
  }, db);
}

// -----------------------------------------------------------------------------
// Overview — the strip across the top of the Banking screen
// -----------------------------------------------------------------------------

export interface BankAccountPositionRow {
  accountId: string;
  name: string;
  key: string;
  isActive: number;
  received: number;
  transferred: number;
  net: number;
  balance: number;
  count: number;
}

export interface BankingOverviewResult {
  accounts: BankAccountPositionRow[];
  totals: {
    received: number;
    transferred: number;
    net: number;
    /** Fees the shop earned, and fees it was charged, over the period. */
    feeReceived: number;
    feePaid: number;
    /** net + feeReceived - feePaid. */
    netAfterFees: number;
    count: number;
  };
  bankBalance: number;
  cashInHand: CashInHandRow;
  range: { from: string; to: string };
}

/**
 * Per-account figures for the chosen period, alongside the all-time balance.
 *
 * Both are shown because they answer different questions and one cannot stand in
 * for the other: "what moved this week" changes with the filter, while "what is
 * left in the account" must not — a balance that fell when somebody picked
 * "Today" would be read as money going missing.
 *
 * EVERY FIGURE HERE IS SPLIT BY TYPE, and each movement is counted once:
 *
 *   transferred  TRANSFER rows, against the account the money LEFT
 *   received     RECEIVE rows,  against the account the money ARRIVED IN
 *
 * An earlier version summed by direction instead — every row with a fromAccountId
 * counted as "out" and every row with a toAccountId as "in". That is wrong for the
 * way this screen is actually used: the two account pickers name the *provider* on
 * each side, so a customer paying by Kpay into the shop's Kpay produces a row with
 * Kpay on both sides. Summing by direction counted that single row as both money in
 * AND money out, and a shop with two such rows saw its own totals doubled while the
 * list underneath it showed the right split.
 *
 * The consequence to keep in mind: a TRANSFER is money out of the shop, full stop,
 * even when the receiving side happens to be another account the shop registered.
 * That matches the label the user chose on the form, which is the only thing that
 * can be trusted to say which way the money went.
 */
export function bankingOverview(
  range: DayRangeInput,
  db: Db = getDatabase(),
): BankingOverviewResult {
  const accounts = db
    .prepare(
      `SELECT a.id AS accountId, a.name, a.key, a.isActive,
              COALESCE((SELECT SUM(t.amount) FROM "BankTransaction" t
                         WHERE t.type = 'RECEIVE' AND t.toAccountId = a.id AND t.isDeleted = 0
                           AND t.transactionDay BETWEEN ? AND ?), 0) AS received,
              COALESCE((SELECT SUM(t.amount) FROM "BankTransaction" t
                         WHERE t.type = 'TRANSFER' AND t.fromAccountId = a.id AND t.isDeleted = 0
                           AND t.transactionDay BETWEEN ? AND ?), 0) AS transferred,
              -- Counted once each: a row is a receipt INTO this account or a
              -- transfer OUT of it, never both.
              (SELECT COUNT(*) FROM "BankTransaction" t
                WHERE t.isDeleted = 0 AND t.transactionDay BETWEEN ? AND ?
                  AND ((t.type = 'RECEIVE' AND t.toAccountId = a.id)
                    OR (t.type = 'TRANSFER' AND t.fromAccountId = a.id))) AS count,
              COALESCE((SELECT SUM(t.amount) FROM "BankTransaction" t
                         WHERE t.type = 'RECEIVE' AND t.toAccountId = a.id
                           AND t.isDeleted = 0), 0)
                - COALESCE((SELECT SUM(t.amount) FROM "BankTransaction" t
                             WHERE t.type = 'TRANSFER' AND t.fromAccountId = a.id
                               AND t.isDeleted = 0), 0) AS balance
         FROM "BankAccount" a
        WHERE a.isActive = 1
           -- A retired account holding money must stay on screen, or the figure
           -- would simply disappear the day it was switched off.
           OR EXISTS (SELECT 1 FROM "BankTransaction" t
                       WHERE (t.fromAccountId = a.id OR t.toAccountId = a.id) AND t.isDeleted = 0)
        ORDER BY a.name ASC`,
    )
    .all(
      range.from,
      range.to,
      range.from,
      range.to,
      range.from,
      range.to,
    ) as Array<Omit<BankAccountPositionRow, 'net'>>;

  const positions: BankAccountPositionRow[] = accounts.map((account) => ({
    ...account,
    net: account.received - account.transferred,
  }));

  /**
   * The same split, over every movement in the period.
   *
   * Identical to the transferTotal / receiveTotal that listBankTransactions
   * reports for the rows on screen, so the strip at the top of the page and the
   * line under the table can never disagree — which they did while this summed by
   * direction and that summed by type.
   */
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN type = 'RECEIVE' THEN amount ELSE 0 END), 0) AS received,
              COALESCE(SUM(CASE WHEN type = 'TRANSFER' THEN amount ELSE 0 END), 0) AS transferred,
              -- Fees split by the DIRECTION OF THE FEE, not by the type of the
              -- movement carrying it. A commission the shop earned is money in
              -- whether it came with a receipt or a transfer, and a charge the
              -- wallet took is money out on the same footing. Splitting these by
              -- the row's type instead would put a fee the shop was charged on a
              -- receipt into the "earned" column.
              COALESCE(SUM(CASE WHEN feeDirection = 'RECEIVE' THEN feeAmount ELSE 0 END), 0)
                AS feeReceived,
              COALESCE(SUM(CASE WHEN feeDirection = 'PAY' THEN feeAmount ELSE 0 END), 0)
                AS feePaid
         FROM "BankTransaction"
        WHERE isDeleted = 0 AND transactionDay BETWEEN ? AND ?`,
    )
    .get(range.from, range.to) as {
    count: number;
    received: number;
    transferred: number;
    feeReceived: number;
    feePaid: number;
  };

  const net = totals.received - totals.transferred;

  return {
    accounts: positions,
    totals: {
      ...totals,
      net,
      /**
       * What the shop is up over the period once fees are taken into account:
       * money in, less money out, plus commissions earned, less charges paid.
       *
       * NOT the sum of the Actual column in the list. That column sums money in
       * and money out together, which is the mistake this screen already made
       * once with its received/transferred split. This keeps the directions
       * apart and folds the fees in on the side each one belongs to.
       */
      netAfterFees: net + totals.feeReceived - totals.feePaid,
    },
    bankBalance: positions.reduce((total, account) => total + account.balance, 0),
    cashInHand: cashInHand(db),
    range: { from: range.from, to: range.to },
  };
}
