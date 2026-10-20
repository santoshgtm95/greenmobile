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
  nowLocalDateTime,
  localDateTimeToInstant,
  localDateTimeToDay,
} from '../../shared/datetime';
import { errors } from '../../shared/errors';
import { recordAudit } from './audit.service';
import { nextNumber } from './sequence.service';
import type { SessionUser } from '../session';
import {
  BANK_ADVANCE_ROLE_LABELS,
  BANK_FEE_DIRECTION_LABELS,
  BANK_TRANSACTION_TYPE_LABELS,
  type BankAdvanceRole,
  type BankAdvanceStatus,
  type BankFeeDirection,
  type BankTransactionType,
  type ShopAdvanceSourceType,
  type ShopAdvanceDestinationType,
  type ShopAdvanceStatus,
} from '../../shared/domain';
import { amountAfterFee, formatMoney, rateOf } from '../../shared/money';
import type {
  BankAdvanceListQuery,
  BankTransactionListQuery,
  CreateBankTransactionInput,
  OpenBankAdvanceInput,
  WithdrawBankAdvanceInput,
  DayRangeInput,
  SaveBankAccountInput,
  SaveShopBankAccountInput,
  SaveCashCountInput,
  SaveBankBalancesInput,
  BankAccountBalanceAdjustment,
  CreateInternalTransferInput,
  InternalTransferListQuery,
  CreateShopAdvanceInput,
  ReceiveShopAdvanceInput,
  ShopAdvanceListQuery,
  DeleteShopAdvanceInput,
  DeleteShopAdvanceSettlementInput,
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
// Shop Registered Bank Accounts
// -----------------------------------------------------------------------------

export interface ShopBankAccountRow {
  id: string;
  bankAccountId: string;
  bankName: string;
  bankKey: string;
  accountNumber: string;
  accountName: string;
  balance: number;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

export function listShopBankAccounts(
  includeInactive = false,
  db: Db = getDatabase(),
): ShopBankAccountRow[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.bankAccountId, s.accountNumber, s.accountName, s.balance, s.isActive,
              s.createdAt, s.updatedAt,
              b.name AS bankName, b.key AS bankKey,
              COALESCE((SELECT SUM(t.amount) FROM "BankTransaction" t
                         WHERE t.type = 'RECEIVE' AND t.toAccountId = s.bankAccountId
                           AND t.toAccountNumber = s.accountNumber AND t.isDeleted = 0), 0)
              - COALESCE((SELECT SUM(t.amount) FROM "BankTransaction" t
                         WHERE t.type = 'TRANSFER' AND t.fromAccountId = s.bankAccountId
                           AND t.fromAccountNumber = s.accountNumber AND t.isDeleted = 0), 0)
              + COALESCE((SELECT SUM(i.amount) FROM "InternalTransfer" i
                           WHERE i.toShopAccountId = s.id AND i.isDeleted = 0), 0)
              - COALESCE((SELECT SUM(i.amount) FROM "InternalTransfer" i
                           WHERE i.fromShopAccountId = s.id AND i.isDeleted = 0), 0)
              + COALESCE((SELECT SUM(sas.amount) FROM "ShopAdvanceSettlement" sas
                           WHERE sas.toShopAccountId = s.id AND sas.isDeleted = 0), 0)
              - COALESCE((SELECT SUM(sa.amount) FROM "ShopAdvance" sa
                           WHERE sa.fromShopAccountId = s.id AND sa.isDeleted = 0), 0) AS calculatedBalance,
              (SELECT COUNT(*) FROM "BankTransaction" t
                WHERE ((t.toAccountId = s.bankAccountId AND t.toAccountNumber = s.accountNumber)
                   OR (t.fromAccountId = s.bankAccountId AND t.fromAccountNumber = s.accountNumber))
                  AND t.isDeleted = 0) AS txCount
         FROM "ShopBankAccount" s
         JOIN "BankAccount" b ON b.id = s.bankAccountId
        ${includeInactive ? '' : 'WHERE s.isActive = 1 AND b.isActive = 1'}
        ORDER BY b.name ASC, s.accountNumber ASC`,
    )
    .all() as Array<ShopBankAccountRow & { calculatedBalance: number; txCount: number }>;

  return rows.map((r) => ({
    ...r,
    balance: r.txCount > 0 ? r.calculatedBalance : (r.balance ?? 0),
  }));
}

export function getShopBankAccount(id: string, db: Db = getDatabase()): ShopBankAccountRow {
  const row = db
    .prepare(
      `SELECT s.id, s.bankAccountId, s.accountNumber, s.accountName, s.balance, s.isActive,
              s.createdAt, s.updatedAt,
              b.name AS bankName, b.key AS bankKey,
              COALESCE((SELECT SUM(t.amount) FROM "BankTransaction" t
                         WHERE t.type = 'RECEIVE' AND t.toAccountId = s.bankAccountId
                           AND t.toAccountNumber = s.accountNumber AND t.isDeleted = 0), 0)
              - COALESCE((SELECT SUM(t.amount) FROM "BankTransaction" t
                         WHERE t.type = 'TRANSFER' AND t.fromAccountId = s.bankAccountId
                           AND t.fromAccountNumber = s.accountNumber AND t.isDeleted = 0), 0)
              + COALESCE((SELECT SUM(i.amount) FROM "InternalTransfer" i
                           WHERE i.toShopAccountId = s.id AND i.isDeleted = 0), 0)
              - COALESCE((SELECT SUM(i.amount) FROM "InternalTransfer" i
                           WHERE i.fromShopAccountId = s.id AND i.isDeleted = 0), 0)
              + COALESCE((SELECT SUM(sas.amount) FROM "ShopAdvanceSettlement" sas
                           WHERE sas.toShopAccountId = s.id AND sas.isDeleted = 0), 0)
              - COALESCE((SELECT SUM(sa.amount) FROM "ShopAdvance" sa
                           WHERE sa.fromShopAccountId = s.id AND sa.isDeleted = 0), 0) AS calculatedBalance,
              (SELECT COUNT(*) FROM "BankTransaction" t
                WHERE ((t.toAccountId = s.bankAccountId AND t.toAccountNumber = s.accountNumber)
                   OR (t.fromAccountId = s.bankAccountId AND t.fromAccountNumber = s.accountNumber))
                  AND t.isDeleted = 0) AS txCount
         FROM "ShopBankAccount" s
         JOIN "BankAccount" b ON b.id = s.bankAccountId
        WHERE s.id = ?`,
    )
    .get(id) as (ShopBankAccountRow & { calculatedBalance: number; txCount: number }) | undefined;
  if (!row) throw errors.notFound('shop bank account');
  return {
    ...row,
    balance: row.txCount > 0 ? row.calculatedBalance : (row.balance ?? 0),
  };
}

export function saveShopBankAccount(
  input: SaveShopBankAccountInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): ShopBankAccountRow {
  return transaction(() => {
    const bank = db
      .prepare(`SELECT id, name, key, isActive FROM "BankAccount" WHERE id = ?`)
      .get(input.bankAccountId) as { id: string; name: string; key: string; isActive: number } | undefined;
    if (!bank) {
      throw errors.validation('Please choose a valid bank or wallet provider.', {
        bankAccountId: 'Provider not found',
      });
    }

    const numberClash = db
      .prepare(
        `SELECT id FROM "ShopBankAccount"
          WHERE bankAccountId = ? AND accountNumber = ? COLLATE NOCASE AND id IS NOT ?`,
      )
      .get(input.bankAccountId, input.accountNumber.trim(), input.id ?? null) as { id: string } | undefined;
    if (numberClash) {
      throw errors.validation(`This account number is already registered under ${bank.name}.`, {
        accountNumber: 'Already registered',
      });
    }

    const now = nowInstant();

    if (input.id) {
      const before = db
        .prepare(
          `SELECT id, bankAccountId, accountNumber, accountName, isActive FROM "ShopBankAccount" WHERE id = ?`,
        )
        .get(input.id) as
        | { id: string; bankAccountId: string; accountNumber: string; accountName: string; isActive: number }
        | undefined;
      if (!before) throw errors.notFound('shop bank account');

      db.prepare(
        `UPDATE "ShopBankAccount"
            SET bankAccountId = ?, accountNumber = ?, accountName = ?, isActive = ?, updatedAt = ?
          WHERE id = ?`,
      ).run(
        input.bankAccountId,
        input.accountNumber.trim(),
        input.accountName.trim(),
        (input.isActive ?? true) ? 1 : 0,
        now,
        input.id,
      );

      recordAudit(
        {
          userId: actor.id,
          action: 'UPDATE',
          entityName: 'ShopBankAccount',
          entityId: input.id,
          summary: `Updated shop account "${input.accountNumber.trim()}" (${input.accountName.trim()}) under ${bank.name}`,
          oldValues: before,
          newValues: input,
        },
        db,
      );

      return getShopBankAccount(input.id, db);
    }

    const id = newId();
    db.prepare(
      `INSERT INTO "ShopBankAccount" (id, bankAccountId, accountNumber, accountName, balance, isActive, createdBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.bankAccountId,
      input.accountNumber.trim(),
      input.accountName.trim(),
      input.balance ?? 0,
      (input.isActive ?? true) ? 1 : 0,
      actor.id,
      now,
      now,
    );

    recordAudit(
      {
        userId: actor.id,
        action: 'CREATE',
        entityName: 'ShopBankAccount',
        entityId: id,
        summary: `Registered shop account "${input.accountNumber.trim()}" (${input.accountName.trim()}) under ${bank.name}`,
        newValues: input,
      },
      db,
    );

    return getShopBankAccount(id, db);
  }, db);
}

export function deleteShopBankAccount(
  id: string,
  actor: SessionUser,
  db: Db = getDatabase(),
): { deleted: true } {
  return transaction(() => {
    const before = getShopBankAccount(id, db);

    const inUseTransfer = db
      .prepare(
        `SELECT COUNT(*) AS c FROM "InternalTransfer" WHERE fromShopAccountId = ? OR toShopAccountId = ?`,
      )
      .get(id, id) as { c: number } | undefined;
    if (inUseTransfer && inUseTransfer.c > 0) {
      throw errors.invalidState(
        `"${before.accountNumber}" (${before.accountName}) has internal transfers recorded against it, so it cannot be deleted. Deactivate it instead.`,
      );
    }

    const inUseShopAdvance = db
      .prepare(
        `SELECT COUNT(*) AS c FROM "ShopAdvance" WHERE fromShopAccountId = ?`,
      )
      .get(id) as { c: number } | undefined;
    if (inUseShopAdvance && inUseShopAdvance.c > 0) {
      throw errors.invalidState(
        `"${before.accountNumber}" (${before.accountName}) has shop advances recorded against it, so it cannot be deleted. Deactivate it instead.`,
      );
    }

    const inUseSettlement = db
      .prepare(
        `SELECT COUNT(*) AS c FROM "ShopAdvanceSettlement" WHERE toShopAccountId = ?`,
      )
      .get(id) as { c: number } | undefined;
    if (inUseSettlement && inUseSettlement.c > 0) {
      throw errors.invalidState(
        `"${before.accountNumber}" (${before.accountName}) has shop advance repayments recorded against it, so it cannot be deleted. Deactivate it instead.`,
      );
    }

    db.prepare(`DELETE FROM "ShopBankAccount" WHERE id = ?`).run(id);

    recordAudit(
      {
        userId: actor.id,
        action: 'DELETE',
        entityName: 'ShopBankAccount',
        entityId: id,
        summary: `Deleted shop account "${before.accountNumber}" (${before.accountName})`,
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
  /** Minor units, typed by the user and added to the actual amount. */
  otherFees: number;
  /** Set when this movement is part of a customer advance. */
  advanceRole: BankAdvanceRole | null;
  /** On a withdrawal, the deposit it draws down. */
  advanceDepositId: string | null;
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
         t.amount, t.feeBasisPoints, t.feeAmount, t.feeDirection, t.otherFees,
         t.advanceRole, t.advanceDepositId,
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
  // Advance deposits and withdrawals live on the Advances tab only.
  where.push('t.advanceRole IS NULL');

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

/**
 * Automatically adjusts cash in hand when an ordinary transaction moves cash in or out of the shop.
 *
 * An Account Transfer (Cash In) receives cash from the customer, adding actual amount to cash in hand.
 * A Receive (Cash Out) pays cash to the customer, deducting actual amount from cash in hand.
 */
function adjustCashInHand(
  delta: number,
  note: string,
  actorId: string,
  db: Db,
): void {
  const current = cashInHand(db);
  const newAmount = current.amount + delta;
  const countId = newId();
  const now = nowInstant();

  db.prepare(
    `INSERT INTO "CashCount" (id, amount, countedAt, countedDay, notes, createdBy, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(countId, newAmount, now, businessDay(), note, actorId, now);
}

export function createBankTransaction(
  input: CreateBankTransactionInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): BankTransactionRow {
  // An ordinary movement is never part of an advance. The link is set only by
  // openBankAdvance and withdrawFromBankAdvance, which is why it is a parameter
  // of the internal writer and not a field the renderer could send.
  return transaction(() => {
    const row = insertMovement(input, null, actor, db);
    const actual = amountAfterFee(row.amount, row.feeAmount, row.feeDirection, row.type, row.otherFees);
    if (row.type === 'TRANSFER') {
      adjustCashInHand(actual, `Account Transfer (Cash In) · ${row.transactionNumber}`, actor.id, db);
    } else if (row.type === 'RECEIVE') {
      adjustCashInHand(-actual, `Receive (Cash Out) · ${row.transactionNumber}`, actor.id, db);
    }
    return row;
  }, db);
}

/** How a movement belongs to a customer advance, when it does. */
interface AdvanceLink {
  role: BankAdvanceRole;
  /** The deposit a withdrawal draws down; null on the deposit itself. */
  depositId: string | null;
  /** Shown in the audit line, so the trail reads as one story. */
  depositNumber?: string;
}

/**
 * Writes one movement. Runs inside the caller's database transaction.
 *
 * Separate from createBankTransaction so that the advance functions can do
 * their own checks — what is still owed on a deposit — inside the SAME
 * transaction as the write, rather than reading a figure in one and writing
 * against it in another.
 */
function insertMovement(
  input: CreateBankTransactionInput,
  advance: AdvanceLink | null,
  actor: SessionUser,
  db: Db,
): BankTransactionRow {
  {
    // Checked here as well as at the IPC boundary, because the balances in
    // bankingOverview are only arithmetic that adds up while this holds — and
    // this function is also reachable directly from tests and future callers.
    if (input.type === 'TRANSFER' && !input.fromAccountId && advance?.role !== 'WITHDRAWAL') {
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
         amount, feeBasisPoints, feeAmount, feeDirection, otherFees, advanceRole, advanceDepositId,
         notes, isDeleted, deletedReason, createdBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`,
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
      input.toAccountNumber ? input.toAccountNumber.trim() : null,
      input.toName ? input.toName.trim() : null,
      input.amount,
      input.feeBasisPoints,
      feeAmount,
      input.feeDirection,
      input.otherFees ?? 0,
      advance?.role ?? null,
      advance?.depositId ?? null,
      input.notes ?? null,
      actor.id,
      now,
      now,
    );

    // Names the bank when it is one of ours, and always the number that was typed.
    const side = (
      bank: { name: string; key: string } | null,
      accountNumber: string | null | undefined,
      holder: string | null | undefined,
    ) => `${bank ? `${bank.name} (${bank.key}) ` : ''}${accountNumber ? `${accountNumber} ` : ''}${holder ?? ''}`.trim();
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
          `${advance ? BANK_ADVANCE_ROLE_LABELS[advance.role] : BANK_TRANSACTION_TYPE_LABELS[input.type]}` +
          ` ${number} — ${input.amount}, ${route}` +
          (advance?.depositNumber ? ` (from ${advance.depositNumber})` : '') +
          (feeAmount > 0
            ? ` (fee ${feeAmount} ${BANK_FEE_DIRECTION_LABELS[input.feeDirection].toLowerCase()})`
            : '') +
          (input.otherFees ? ` (other fees ${input.otherFees})` : ''),
        // The calculated fee too, not just the rate that was sent in.
        newValues: { ...input, feeAmount, advanceRole: advance?.role ?? null },
      },
      db,
    );

    return getBankTransaction(id, db);
  }
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

    // A deposit that withdrawals still draw on cannot go first: the withdrawals
    // would then be paying out of nothing, and what the customer is owed would
    // read as negative. Deleting a WITHDRAWAL is always allowed — its money
    // simply goes back on the advance, which is worked out on read.
    if (before.advanceRole === 'DEPOSIT') {
      const live = liveWithdrawalCount(id, db);
      if (live > 0) {
        const one = live === 1;
        throw errors.invalidState(
          `${before.transactionNumber} is an advance with ${live} withdrawal${one ? '' : 's'} ` +
            `recorded against it. Delete ${one ? 'that withdrawal' : 'those withdrawals'} first.`,
        );
      }
    }

    db.prepare(
      `UPDATE "BankTransaction" SET isDeleted = 1, deletedReason = ?, updatedAt = ? WHERE id = ?`,
    ).run(reason, nowInstant(), id);

    // If an ordinary transaction that adjusted cash in hand is deleted, reverse its cash adjustment
    if (before.advanceRole === null) {
      const actual = amountAfterFee(before.amount, before.feeAmount, before.feeDirection, before.type, before.otherFees);
      if (before.type === 'TRANSFER') {
        adjustCashInHand(-actual, `Deleted ${before.transactionNumber} (${reason})`, actor.id, db);
      } else if (before.type === 'RECEIVE') {
        adjustCashInHand(actual, `Deleted ${before.transactionNumber} (${reason})`, actor.id, db);
      }
    } else if (before.advanceRole === 'WITHDRAWAL' && (!before.fromAccountId || before.toName?.toLowerCase() === 'cash')) {
      const actual = amountAfterFee(before.amount, before.feeAmount, before.feeDirection, before.type, before.otherFees);
      adjustCashInHand(actual, `Deleted withdrawal ${before.transactionNumber} (${reason})`, actor.id, db);
    }

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
// Customer advances
// -----------------------------------------------------------------------------

/**
 * One advance: the deposit that opened it, and what has happened since.
 *
 * It IS the deposit row — same number, same accounts, same fee — with the
 * running figures added. The customer is the deposit's From side: the name and
 * number on the account the money came from.
 *
 * WHAT IS OWED IS THE AMOUNT, NOT THE AMOUNT AFTER FEES. A deposit of 3,000,000
 * leaves 3,000,000 to collect whatever fee was charged on the way in, and a
 * withdrawal of 1,000,000 takes exactly 1,000,000 off it. Fees are the shop's
 * own income and costs, recorded on each movement and totalled on the Banking
 * strip; letting them move the customer's balance as well would make what a
 * customer is owed depend on a percentage typed on a different day.
 */
export interface BankAdvanceRow extends BankTransactionRow {
  /** Live withdrawals, added up. */
  withdrawn: number;
  /** amount - withdrawn. What the shop still holds for this customer. */
  remaining: number;
  withdrawalCount: number;
  lastWithdrawalDate: string | null;
  status: BankAdvanceStatus;
}

/**
 * Every live deposit with its withdrawals summed alongside.
 *
 * Built on BANK_TRANSACTION_SELECT rather than beside it, so an advance carries
 * exactly the columns a transaction does and the two cannot drift. A deleted
 * withdrawal does not count — its money is back on the advance — and a deleted
 * deposit is not an advance at all.
 */
const BANK_ADVANCE_SELECT = `
  SELECT a.*, a.amount - a.withdrawn AS remaining
    FROM (
      SELECT d.*,
             COALESCE((SELECT SUM(w.amount) FROM "BankTransaction" w
                        WHERE w.advanceDepositId = d.id AND w.advanceRole = 'WITHDRAWAL'
                          AND w.isDeleted = 0), 0) AS withdrawn,
             (SELECT COUNT(*) FROM "BankTransaction" w
               WHERE w.advanceDepositId = d.id AND w.advanceRole = 'WITHDRAWAL'
                 AND w.isDeleted = 0) AS withdrawalCount,
             (SELECT MAX(w.transactionDate) FROM "BankTransaction" w
               WHERE w.advanceDepositId = d.id AND w.advanceRole = 'WITHDRAWAL'
                 AND w.isDeleted = 0) AS lastWithdrawalDate
        FROM (${BANK_TRANSACTION_SELECT}
               WHERE t.advanceRole = 'DEPOSIT' AND t.isDeleted = 0) d
    ) a
`;

function withStatus(row: Omit<BankAdvanceRow, 'status'>): BankAdvanceRow {
  return { ...row, status: row.remaining > 0 ? 'OPEN' : 'SETTLED' };
}

function liveWithdrawalCount(depositId: string, db: Db): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM "BankTransaction"
          WHERE advanceDepositId = ? AND advanceRole = 'WITHDRAWAL' AND isDeleted = 0`,
      )
      .get(depositId) as { n: number }
  ).n;
}

export function listBankAdvances(
  query: BankAdvanceListQuery,
  db: Db = getDatabase(),
): {
  rows: BankAdvanceRow[];
  total: number;
  /**
   * Everything still owed to customers, across EVERY open advance — not just
   * the ones the search matches. It answers "how much of the money in my
   * accounts is not mine", which a search box must not be able to shrink.
   */
  heldTotal: number;
  openCount: number;
} {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.status === 'OPEN') where.push('a.remaining > 0');
  if (query.status === 'SETTLED') where.push('a.remaining <= 0');

  if (query.search) {
    where.push(
      `(a.transactionNumber LIKE ? COLLATE NOCASE OR a.fromName LIKE ? COLLATE NOCASE
        OR a.fromAccountNumber LIKE ? OR a.notes LIKE ? COLLATE NOCASE
        OR a.toAccountName LIKE ? COLLATE NOCASE OR a.toAccountKey LIKE ? COLLATE NOCASE)`,
    );
    const like = `%${query.search}%`;
    params.push(like, like, like, like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM (${BANK_ADVANCE_SELECT}) a ${whereSql}`)
      .get(...params) as { n: number }
  ).n;

  const rows = (
    db
      .prepare(
        `SELECT * FROM (${BANK_ADVANCE_SELECT}) a ${whereSql}
          ORDER BY a.transactionDate DESC, a.createdAt DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, query.pageSize, query.page * query.pageSize) as Array<
      Omit<BankAdvanceRow, 'status'>
    >
  ).map(withStatus);

  const held = db
    .prepare(
      `SELECT COALESCE(SUM(a.remaining), 0) AS heldTotal, COUNT(*) AS openCount
         FROM (${BANK_ADVANCE_SELECT}) a WHERE a.remaining > 0`,
    )
    .get() as { heldTotal: number; openCount: number };

  return { rows, total, heldTotal: held.heldTotal, openCount: held.openCount };
}

/** One advance with its withdrawals, oldest first — the order they happened in. */
export function getBankAdvance(
  id: string,
  db: Db = getDatabase(),
): { advance: BankAdvanceRow; withdrawals: BankTransactionRow[] } {
  const row = db.prepare(`SELECT * FROM (${BANK_ADVANCE_SELECT}) a WHERE a.id = ?`).get(id) as
    | Omit<BankAdvanceRow, 'status'>
    | undefined;
  if (!row) throw errors.notFound('advance');

  const withdrawals = db
    .prepare(
      `${BANK_TRANSACTION_SELECT}
        WHERE t.advanceDepositId = ? AND t.advanceRole = 'WITHDRAWAL' AND t.isDeleted = 0
        ORDER BY t.transactionDate ASC, t.createdAt ASC`,
    )
    .all(id) as BankTransactionRow[];

  return { advance: withStatus(row), withdrawals };
}

/**
 * A customer's money arriving, to be collected later. Always a RECEIVE into one
 * of the shop's accounts, so it counts in that account's balance from today —
 * which is where the money actually is.
 */
export function openBankAdvance(
  input: OpenBankAdvanceInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): BankAdvanceRow {
  return transaction(() => {
    const deposit = insertMovement(
      { ...input, type: 'RECEIVE' },
      { role: 'DEPOSIT', depositId: null },
      actor,
      db,
    );
    return getBankAdvance(deposit.id, db).advance;
  }, db);
}

/**
 * Pays some or all of an advance back out — a TRANSFER from one of the shop's
 * accounts.
 *
 * What is left is worked out INSIDE this transaction, immediately before the
 * write. Reading it earlier — on the form, or in a separate query — is how two
 * withdrawals that each fit on their own end up paying out more than was ever
 * deposited.
 */
export function withdrawFromBankAdvance(
  input: WithdrawBankAdvanceInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): { advance: BankAdvanceRow; withdrawals: BankTransactionRow[] } {
  return transaction(() => {
    const { advanceId, ...movement } = input;

    const deposit = getBankTransaction(advanceId, db);
    if (deposit.advanceRole !== 'DEPOSIT') {
      throw errors.invalidState(`${deposit.transactionNumber} is not an advance.`);
    }
    if (deposit.isDeleted) {
      throw errors.invalidState(
        `${deposit.transactionNumber} has been deleted, so nothing can be withdrawn from it.`,
      );
    }

    const remaining = deposit.amount - withdrawnFrom(deposit.id, db);
    if (remaining <= 0) {
      throw errors.invalidState(
        `${deposit.transactionNumber} is settled — the whole amount has already been withdrawn.`,
      );
    }
    if (movement.amount > remaining) {
      throw errors.validation(
        `Only ${formatMoney(remaining)} is left on ${deposit.transactionNumber}.`,
        { amount: `At most ${formatMoney(remaining)}` },
      );
    }

    // The money cannot leave before it arrived. Compared as instants, so a
    // withdrawal later the same day is fine and one the day before is not.
    if (localDateTimeToInstant(movement.transactionAt) < deposit.transactionDate) {
      throw errors.validation('A withdrawal cannot be dated before the deposit it draws on.', {
        transactionAt: 'Before the deposit',
      });
    }

    const isCash =
      movement.withdrawalMethod === 'cash' ||
      movement.toName?.trim().toLowerCase() === 'cash' ||
      (!movement.toAccountId && (!movement.toAccountNumber || movement.toAccountNumber.trim() === '') && movement.toName?.trim().toLowerCase() === 'cash');

    const withdrawalInput: CreateBankTransactionInput = {
      ...movement,
      type: 'TRANSFER',
      feeBasisPoints: movement.feeBasisPoints ?? 0,
      feeDirection: movement.feeDirection ?? 'RECEIVE',
      fromAccountId: isCash ? undefined : (movement.fromAccountId ?? deposit.toAccountId ?? undefined),
      fromAccountNumber: isCash ? '-' : (movement.fromAccountNumber || '-'),
      fromName: isCash ? 'Cash in hand' : (movement.fromName || 'Bank'),
      toName: movement.toName || (isCash ? 'Cash' : '-'),
      toAccountNumber: movement.toAccountNumber || '',
    };

    const row = insertMovement(
      withdrawalInput,
      { role: 'WITHDRAWAL', depositId: deposit.id, depositNumber: deposit.transactionNumber },
      actor,
      db,
    );

    if (isCash) {
      const actual = amountAfterFee(row.amount, row.feeAmount, row.feeDirection, row.type, row.otherFees);
      adjustCashInHand(-actual, `Advance withdrawal (Cash) · ${deposit.transactionNumber}`, actor.id, db);
    }

    return getBankAdvance(deposit.id, db);
  }, db);
}

function withdrawnFrom(depositId: string, db: Db): number {
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS n FROM "BankTransaction"
          WHERE advanceDepositId = ? AND advanceRole = 'WITHDRAWAL' AND isDeleted = 0`,
      )
      .get(depositId) as { n: number }
  ).n;
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

/**
 * Updates bank or mobile payment account balances to match bank statements or app balances.
 *
 * Each changed balance creates an adjustment movement without touching cash in hand.
 */
export function saveBankBalances(
  input: SaveBankBalancesInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): { updated: true; count: number } {
  return transaction(() => {
    let count = 0;
    const localNow = nowLocalDateTime();
    const now = nowInstant();

    if (input.shopAccountBalances && input.shopAccountBalances.length > 0) {
      for (const item of input.shopAccountBalances) {
        const shopAccount = getShopBankAccount(item.shopAccountId, db);
        if (!shopAccount.isActive) {
          throw errors.invalidState(
            `"${shopAccount.accountNumber}" (${shopAccount.accountName}) is switched off, so its balance cannot be adjusted.`,
          );
        }

        const currentBalance = shopAccount.balance;
        const delta = item.balance - currentBalance;

        if (delta === 0) continue;

        if (delta > 0) {
          insertMovement(
            {
              type: 'RECEIVE',
              transactionAt: localNow,
              toAccountId: shopAccount.bankAccountId,
              toAccountNumber: shopAccount.accountNumber,
              toName: shopAccount.accountName,
              fromAccountId: undefined,
              fromAccountNumber: '-',
              fromName: 'Balance adjustment',
              amount: delta,
              feeBasisPoints: 0,
              otherFees: 0,
              feeDirection: 'RECEIVE',
              notes: input.notes?.trim() || `Balance adjustment · ${shopAccount.accountNumber}`,
            },
            null,
            actor,
            db,
          );
          count++;
        } else {
          insertMovement(
            {
              type: 'TRANSFER',
              transactionAt: localNow,
              fromAccountId: shopAccount.bankAccountId,
              fromAccountNumber: shopAccount.accountNumber,
              fromName: shopAccount.accountName,
              toAccountId: undefined,
              toAccountNumber: '-',
              toName: 'Balance adjustment',
              amount: Math.abs(delta),
              feeBasisPoints: 0,
              otherFees: 0,
              feeDirection: 'PAY',
              notes: input.notes?.trim() || `Balance adjustment · ${shopAccount.accountNumber}`,
            },
            null,
            actor,
            db,
          );
          count++;
        }

        db.prepare(
          `UPDATE "ShopBankAccount" SET balance = ?, updatedAt = ? WHERE id = ?`,
        ).run(item.balance, now, shopAccount.id);

        recordAudit(
          {
            userId: actor.id,
            action: 'UPDATE',
            entityName: 'ShopBankAccount',
            entityId: shopAccount.id,
            summary: `Adjusted balance for shop account "${shopAccount.accountNumber}" (${shopAccount.accountName}) to ${formatMoney(item.balance)}`,
          },
          db,
        );
      }
    }

    if (input.balances && input.balances.length > 0) {
      for (const item of input.balances) {
        const account = usableAccount(item.accountId, db);

        const currentBalanceRow = db
          .prepare(
            `SELECT COALESCE((SELECT SUM(amount) FROM "BankTransaction" WHERE type = 'RECEIVE' AND toAccountId = ? AND isDeleted = 0), 0)
                  - COALESCE((SELECT SUM(amount) FROM "BankTransaction" WHERE type = 'TRANSFER' AND fromAccountId = ? AND isDeleted = 0), 0) AS balance`,
          )
          .get(item.accountId, item.accountId) as { balance: number } | undefined;

        const currentBalance = currentBalanceRow?.balance ?? 0;
        const delta = item.balance - currentBalance;

        if (delta === 0) continue;

        if (delta > 0) {
          insertMovement(
            {
              type: 'RECEIVE',
              transactionAt: localNow,
              toAccountId: account.id,
              toAccountNumber: account.key,
              toName: account.name,
              fromAccountId: undefined,
              fromAccountNumber: '-',
              fromName: 'Balance adjustment',
              amount: delta,
              feeBasisPoints: 0,
              otherFees: 0,
              feeDirection: 'RECEIVE',
              notes: input.notes?.trim() || 'Bank balance adjustment',
            },
            null,
            actor,
            db,
          );
          count++;
        } else {
          insertMovement(
            {
              type: 'TRANSFER',
              transactionAt: localNow,
              fromAccountId: account.id,
              fromAccountNumber: account.key,
              fromName: account.name,
              toAccountId: undefined,
              toAccountNumber: '-',
              toName: 'Balance adjustment',
              amount: Math.abs(delta),
              feeBasisPoints: 0,
              otherFees: 0,
              feeDirection: 'PAY',
              notes: input.notes?.trim() || 'Bank balance adjustment',
            },
            null,
            actor,
            db,
          );
          count++;
        }
      }
    }

    return { updated: true, count };
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
                               AND t.isDeleted = 0), 0)
                + COALESCE((SELECT SUM(i.amount) FROM "InternalTransfer" i
                             WHERE i.toAccountId = a.id AND i.isDeleted = 0), 0)
                - COALESCE((SELECT SUM(i.amount) FROM "InternalTransfer" i
                             WHERE i.fromAccountId = a.id AND i.isDeleted = 0), 0)
                + COALESCE((SELECT SUM(sas.amount) FROM "ShopAdvanceSettlement" sas
                             JOIN "ShopBankAccount" s ON s.id = sas.toShopAccountId
                            WHERE s.bankAccountId = a.id AND sas.isDeleted = 0), 0)
                - COALESCE((SELECT SUM(sa.amount) FROM "ShopAdvance" sa
                             JOIN "ShopBankAccount" s ON s.id = sa.fromShopAccountId
                            WHERE s.bankAccountId = a.id AND sa.isDeleted = 0), 0) AS balance
         FROM "BankAccount" a
        WHERE a.isActive = 1
           -- A retired account holding money must stay on screen, or the figure
           -- would simply disappear the day it was switched off.
           OR EXISTS (SELECT 1 FROM "BankTransaction" t
                       WHERE (t.fromAccountId = a.id OR t.toAccountId = a.id) AND t.isDeleted = 0)
           OR EXISTS (SELECT 1 FROM "InternalTransfer" i
                       WHERE (i.fromAccountId = a.id OR i.toAccountId = a.id) AND i.isDeleted = 0)
           OR EXISTS (SELECT 1 FROM "ShopAdvance" sa JOIN "ShopBankAccount" s ON s.id = sa.fromShopAccountId
                       WHERE s.bankAccountId = a.id AND sa.isDeleted = 0)
           OR EXISTS (SELECT 1 FROM "ShopAdvanceSettlement" sas JOIN "ShopBankAccount" s ON s.id = sas.toShopAccountId
                       WHERE s.bankAccountId = a.id AND sas.isDeleted = 0)
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
        -- Advances are left out, matching the Transactions list. They still
        -- count in the account balances above: that money really is there.
        WHERE isDeleted = 0 AND advanceRole IS NULL AND transactionDay BETWEEN ? AND ?`,
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

// -----------------------------------------------------------------------------
// Internal Transfers — money moved between the shop's own bank accounts
// -----------------------------------------------------------------------------

export interface InternalTransferRow {
  id: string;
  transferNumber: string;
  transferDate: string;
  transferDay: string;
  fromShopAccountId: string;
  toShopAccountId: string;
  fromAccountId: string;
  toAccountId: string;
  fromBankName: string;
  fromBankKey: string;
  fromAccountNumber: string;
  fromAccountName: string;
  toBankName: string;
  toBankKey: string;
  toAccountNumber: string;
  toAccountName: string;
  amount: number;
  notes: string | null;
  outTransactionId: string | null;
  inTransactionId: string | null;
  isDeleted: number;
  deletedReason: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

const INTERNAL_TRANSFER_SELECT = `
  SELECT it.id, it.transferNumber, it.transferDate, it.transferDay,
         it.fromShopAccountId, it.toShopAccountId,
         it.fromAccountId, it.toAccountId,
         fb.name AS fromBankName, fb.key AS fromBankKey,
         it.fromAccountNumber, it.fromAccountName,
         tb.name AS toBankName, tb.key AS toBankKey,
         it.toAccountNumber, it.toAccountName,
         it.amount, it.notes,
         it.outTransactionId, it.inTransactionId,
         it.isDeleted, it.deletedReason,
         it.createdBy, u.fullName AS createdByName,
         it.createdAt, it.updatedAt
    FROM "InternalTransfer" it
    JOIN "BankAccount" fb ON fb.id = it.fromAccountId
    JOIN "BankAccount" tb ON tb.id = it.toAccountId
    LEFT JOIN "User" u ON u.id = it.createdBy
`;

export function getInternalTransfer(id: string, db: Db = getDatabase()): InternalTransferRow {
  const row = db
    .prepare(`${INTERNAL_TRANSFER_SELECT} WHERE it.id = ?`)
    .get(id) as InternalTransferRow | undefined;
  if (!row) throw errors.notFound('internal transfer');
  return row;
}

export function listInternalTransfers(
  query: InternalTransferListQuery,
  db: Db = getDatabase(),
): {
  rows: InternalTransferRow[];
  total: number;
  totalAmount: number;
} {
  const where: string[] = [];
  const params: unknown[] = [];

  if (!query.includeDeleted) where.push('it.isDeleted = 0');
  if (query.from) {
    where.push('it.transferDay >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('it.transferDay <= ?');
    params.push(query.to);
  }
  if (query.fromShopAccountId) {
    where.push('it.fromShopAccountId = ?');
    params.push(query.fromShopAccountId);
  }
  if (query.toShopAccountId) {
    where.push('it.toShopAccountId = ?');
    params.push(query.toShopAccountId);
  }
  if (query.shopAccountId) {
    where.push('(it.fromShopAccountId = ? OR it.toShopAccountId = ?)');
    params.push(query.shopAccountId, query.shopAccountId);
  }
  if (query.search) {
    where.push(
      `(it.transferNumber LIKE ? COLLATE NOCASE
        OR it.fromAccountNumber LIKE ? OR it.toAccountNumber LIKE ?
        OR it.fromAccountName LIKE ? COLLATE NOCASE OR it.toAccountName LIKE ? COLLATE NOCASE
        OR fb.name LIKE ? COLLATE NOCASE OR fb.key LIKE ? COLLATE NOCASE
        OR tb.name LIKE ? COLLATE NOCASE OR tb.key LIKE ? COLLATE NOCASE
        OR it.notes LIKE ? COLLATE NOCASE)`,
    );
    const like = `%${query.search}%`;
    params.push(like, like, like, like, like, like, like, like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const aggregate = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(it.amount), 0) AS totalAmount
         FROM "InternalTransfer" it
         JOIN "BankAccount" fb ON fb.id = it.fromAccountId
         JOIN "BankAccount" tb ON tb.id = it.toAccountId
       ${whereSql}`,
    )
    .get(...params) as { total: number; totalAmount: number };

  const rows = db
    .prepare(
      `${INTERNAL_TRANSFER_SELECT}
       ${whereSql}
       ORDER BY it.transferDate DESC, it.createdAt DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, query.pageSize, query.page * query.pageSize) as InternalTransferRow[];

  return {
    rows,
    total: aggregate.total,
    totalAmount: aggregate.totalAmount,
  };
}

export function createInternalTransfer(
  input: CreateInternalTransferInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): InternalTransferRow {
  return transaction(() => {
    if (input.fromShopAccountId === input.toShopAccountId) {
      throw errors.validation('Source and destination accounts must be different.', {
        toShopAccountId: 'Choose a different account to transfer to',
      });
    }

    if (input.amount <= 0) {
      throw errors.validation('Amount must be more than zero.', {
        amount: 'Required',
      });
    }

    const fromShopAccount = getShopBankAccount(input.fromShopAccountId, db);
    const toShopAccount = getShopBankAccount(input.toShopAccountId, db);

    if (!fromShopAccount.isActive) {
      throw errors.validation('The source account is inactive.', {
        fromShopAccountId: 'Account is inactive',
      });
    }
    if (!toShopAccount.isActive) {
      throw errors.validation('The destination account is inactive.', {
        toShopAccountId: 'Account is inactive',
      });
    }

    if (fromShopAccount.balance <= 0) {
      throw errors.validation(
        `"${fromShopAccount.accountName}" has no available balance to transfer.`,
        {
          fromShopAccountId: 'Insufficient balance',
          amount: 'Account has zero or negative balance',
        },
      );
    }

    if (input.amount > fromShopAccount.balance) {
      throw errors.validation(
        `Cannot transfer more than the current balance (${formatMoney(fromShopAccount.balance)}) of "${fromShopAccount.accountName}".`,
        {
          amount: `Exceeds current balance of ${formatMoney(fromShopAccount.balance)}`,
        },
      );
    }

    const fromBank = usableAccount(fromShopAccount.bankAccountId, db);
    const toBank = usableAccount(toShopAccount.bankAccountId, db);

    const transferId = newId();
    const transferNumber = nextNumber('banking', db);
    const now = nowInstant();
    const transferDate = localDateTimeToInstant(input.transferAt);
    const transferDay = localDateTimeToDay(input.transferAt);

    // Insert InternalTransfer record (no BankTransaction rows — balance is tracked
    // directly on ShopBankAccount.balance, avoiding the calculatedBalance override
    // that only accounts for BankTransaction sums and would ignore the stored balance).
    db.prepare(
      `INSERT INTO "InternalTransfer" (
         id, transferNumber, transferDate, transferDay,
         fromShopAccountId, toShopAccountId,
         fromAccountId, toAccountId,
         fromAccountNumber, fromAccountName,
         toAccountNumber, toAccountName,
         amount, notes,
         outTransactionId, inTransactionId,
         isDeleted, deletedReason,
         createdBy, createdAt, updatedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, NULL, ?, ?, ?)`,
    ).run(
      transferId,
      transferNumber,
      transferDate,
      transferDay,
      fromShopAccount.id,
      toShopAccount.id,
      fromShopAccount.bankAccountId,
      toShopAccount.bankAccountId,
      fromShopAccount.accountNumber,
      fromShopAccount.accountName,
      toShopAccount.accountNumber,
      toShopAccount.accountName,
      input.amount,
      input.notes?.trim() || null,
      actor.id,
      now,
      now,
    );

    // Update balances directly on ShopBankAccount
    const newFromBal = fromShopAccount.balance - input.amount;
    const newToBal = toShopAccount.balance + input.amount;
    db.prepare(`UPDATE "ShopBankAccount" SET balance = ?, updatedAt = ? WHERE id = ?`).run(
      newFromBal,
      now,
      fromShopAccount.id,
    );
    db.prepare(`UPDATE "ShopBankAccount" SET balance = ?, updatedAt = ? WHERE id = ?`).run(
      newToBal,
      now,
      toShopAccount.id,
    );

    recordAudit(
      {
        userId: actor.id,
        action: 'CREATE',
        entityName: 'InternalTransfer',
        entityId: transferId,
        summary: `Transferred ${formatMoney(input.amount)} from ${fromBank.name} (${fromShopAccount.accountNumber}) to ${toBank.name} (${toShopAccount.accountNumber})`,
        newValues: input,
      },
      db,
    );

    return getInternalTransfer(transferId, db);
  }, db);
}

export function deleteInternalTransfer(
  id: string,
  reason: string,
  actor: SessionUser,
  db: Db = getDatabase(),
): { deleted: true } {
  return transaction(() => {
    const transfer = getInternalTransfer(id, db);
    if (transfer.isDeleted) {
      throw errors.invalidState('This internal transfer has already been deleted.');
    }

    const now = nowInstant();

    db.prepare(
      `UPDATE "InternalTransfer"
          SET isDeleted = 1, deletedReason = ?, updatedAt = ?
        WHERE id = ?`,
    ).run(reason, now, id);

    const fromAccount = db
      .prepare(`SELECT id, balance FROM "ShopBankAccount" WHERE id = ?`)
      .get(transfer.fromShopAccountId) as { id: string; balance: number } | undefined;
    if (fromAccount) {
      db.prepare(`UPDATE "ShopBankAccount" SET balance = ?, updatedAt = ? WHERE id = ?`).run(
        fromAccount.balance + transfer.amount,
        now,
        fromAccount.id,
      );
    }

    const toAccount = db
      .prepare(`SELECT id, balance FROM "ShopBankAccount" WHERE id = ?`)
      .get(transfer.toShopAccountId) as { id: string; balance: number } | undefined;
    if (toAccount) {
      db.prepare(`UPDATE "ShopBankAccount" SET balance = ?, updatedAt = ? WHERE id = ?`).run(
        toAccount.balance - transfer.amount,
        now,
        toAccount.id,
      );
    }

    recordAudit(
      {
        userId: actor.id,
        action: 'DELETE',
        entityName: 'InternalTransfer',
        entityId: id,
        summary: `Deleted internal transfer ${transfer.transferNumber} of ${formatMoney(transfer.amount)}: ${reason}`,
        oldValues: transfer,
      },
      db,
    );

    return { deleted: true };
  }, db);
}



// -----------------------------------------------------------------------------
// Shop Advances (Money advanced from shop cash/account to external recipients)
// -----------------------------------------------------------------------------

export interface ShopAdvanceRow {
  id: string;
  advanceNumber: string;
  fromType: ShopAdvanceSourceType;
  fromShopAccountId: string | null;
  fromBankName: string | null;
  fromBankKey: string | null;
  fromAccountNumber: string | null;
  fromAccountName: string | null;
  toType: ShopAdvanceDestinationType;
  recipientName: string;
  recipientPhone: string | null;
  toBankName: string | null;
  toAccountNumber: string | null;
  toAccountName: string | null;
  amount: number;
  advanceDate: string;
  advanceDay: string;
  notes: string | null;
  received: number;
  remaining: number;
  settlementCount: number;
  lastSettlementDate: string | null;
  status: ShopAdvanceStatus;
  isDeleted: number;
  deletedReason: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShopAdvanceSettlementRow {
  id: string;
  shopAdvanceId: string;
  settlementNumber: string;
  toType: ShopAdvanceSourceType;
  toShopAccountId: string | null;
  toBankName: string | null;
  toBankKey: string | null;
  toAccountNumber: string | null;
  toAccountName: string | null;
  amount: number;
  settlementDate: string;
  settlementDay: string;
  notes: string | null;
  isDeleted: number;
  deletedReason: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

const SHOP_ADVANCE_BASE_SELECT = `
  SELECT sa.id, sa.advanceNumber, sa.advanceDate, sa.advanceDay,
         sa.fromType, sa.fromShopAccountId,
         sa.fromBankName, sa.fromBankKey, sa.fromAccountNumber, sa.fromAccountName,
         sa.toType, sa.recipientName, sa.recipientPhone,
         sa.toBankName, sa.toAccountNumber, sa.toAccountName,
         sa.amount, sa.notes,
         sa.isDeleted, sa.deletedReason,
         sa.createdBy, u.fullName AS createdByName,
         sa.createdAt, sa.updatedAt
    FROM "ShopAdvance" sa
    LEFT JOIN "User" u ON u.id = sa.createdBy
`;

const SHOP_ADVANCE_SELECT = `
  SELECT a.*,
         a.amount - a.received AS remaining,
         CASE WHEN a.amount - a.received <= 0 THEN 'SETTLED' ELSE 'OPEN' END AS status
    FROM (
      SELECT sa.*,
             COALESCE((SELECT SUM(s.amount) FROM "ShopAdvanceSettlement" s
                        WHERE s.shopAdvanceId = sa.id AND s.isDeleted = 0), 0) AS received,
             (SELECT COUNT(*) FROM "ShopAdvanceSettlement" s
                WHERE s.shopAdvanceId = sa.id AND s.isDeleted = 0) AS settlementCount,
             (SELECT MAX(s.settlementDate) FROM "ShopAdvanceSettlement" s
                WHERE s.shopAdvanceId = sa.id AND s.isDeleted = 0) AS lastSettlementDate
        FROM (${SHOP_ADVANCE_BASE_SELECT}) sa
    ) a
`;

const SHOP_ADVANCE_SETTLEMENT_SELECT = `
  SELECT sas.id, sas.shopAdvanceId, sas.settlementNumber, sas.settlementDate, sas.settlementDay,
         sas.toType, sas.toShopAccountId,
         sas.toBankName, sas.toBankKey, sas.toAccountNumber, sas.toAccountName,
         sas.amount, sas.notes,
         sas.isDeleted, sas.deletedReason,
         sas.createdBy, u.fullName AS createdByName,
         sas.createdAt, sas.updatedAt
    FROM "ShopAdvanceSettlement" sas
    LEFT JOIN "User" u ON u.id = sas.createdBy
`;

export function getShopAdvance(
  id: string,
  db: Db = getDatabase(),
): { advance: ShopAdvanceRow; settlements: ShopAdvanceSettlementRow[] } {
  const advance = db
    .prepare(`SELECT * FROM (${SHOP_ADVANCE_SELECT}) a WHERE a.id = ?`)
    .get(id) as ShopAdvanceRow | undefined;
  if (!advance) throw errors.notFound('shop advance');

  const settlements = db
    .prepare(
      `${SHOP_ADVANCE_SETTLEMENT_SELECT}
       WHERE sas.shopAdvanceId = ? AND sas.isDeleted = 0
       ORDER BY sas.settlementDate ASC, sas.createdAt ASC`,
    )
    .all(id) as ShopAdvanceSettlementRow[];

  return { advance, settlements };
}

export function listShopAdvances(
  query: ShopAdvanceListQuery,
  db: Db = getDatabase(),
): {
  rows: ShopAdvanceRow[];
  total: number;
  openCount: number;
  totalAdvanced: number;
  totalReceived: number;
  outstandingTotal: number;
} {
  const where: string[] = [];
  const params: unknown[] = [];

  if (!query.includeDeleted) where.push('a.isDeleted = 0');
  if (query.status === 'OPEN') where.push('a.remaining > 0');
  if (query.status === 'SETTLED') where.push('a.remaining <= 0');
  if (query.from) {
    where.push('a.advanceDay >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('a.advanceDay <= ?');
    params.push(query.to);
  }
  if (query.search) {
    where.push(
      `(a.advanceNumber LIKE ? COLLATE NOCASE
        OR a.recipientName LIKE ? COLLATE NOCASE
        OR a.recipientPhone LIKE ? COLLATE NOCASE
        OR a.fromAccountNumber LIKE ? COLLATE NOCASE
        OR a.fromAccountName LIKE ? COLLATE NOCASE
        OR a.fromBankName LIKE ? COLLATE NOCASE
        OR a.toAccountNumber LIKE ? COLLATE NOCASE
        OR a.toAccountName LIKE ? COLLATE NOCASE
        OR a.toBankName LIKE ? COLLATE NOCASE
        OR a.notes LIKE ? COLLATE NOCASE)`,
    );
    const like = `%${query.search}%`;
    params.push(like, like, like, like, like, like, like, like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRow = db
    .prepare(`SELECT COUNT(*) AS total FROM (${SHOP_ADVANCE_SELECT}) a ${whereSql}`)
    .get(...params) as { total: number };

  const summary = db
    .prepare(
      `SELECT COUNT(CASE WHEN remaining > 0 THEN 1 END) AS openCount,
              COALESCE(SUM(amount), 0) AS totalAdvanced,
              COALESCE(SUM(received), 0) AS totalReceived,
              COALESCE(SUM(CASE WHEN remaining > 0 THEN remaining ELSE 0 END), 0) AS outstandingTotal
         FROM (${SHOP_ADVANCE_SELECT}) a
        WHERE a.isDeleted = 0`,
    )
    .get() as {
      openCount: number;
      totalAdvanced: number;
      totalReceived: number;
      outstandingTotal: number;
    };

  const rows = db
    .prepare(
      `SELECT * FROM (${SHOP_ADVANCE_SELECT}) a
       ${whereSql}
       ORDER BY a.advanceDate DESC, a.createdAt DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, query.pageSize, query.page * query.pageSize) as ShopAdvanceRow[];

  return {
    rows,
    total: countRow.total,
    openCount: summary.openCount,
    totalAdvanced: summary.totalAdvanced,
    totalReceived: summary.totalReceived,
    outstandingTotal: summary.outstandingTotal,
  };
}

export function createShopAdvance(
  input: CreateShopAdvanceInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): ShopAdvanceRow {
  return transaction(() => {
    if (input.amount <= 0) {
      throw errors.validation('Amount must be more than zero.', {
        amount: 'Required',
      });
    }

    let fromBankName: string | null = null;
    let fromBankKey: string | null = null;
    let fromAccountNumber: string | null = null;
    let fromAccountName: string | null = null;
    let fromShopAccountId: string | null = null;

    if (input.fromType === 'CASH') {
      const cash = cashInHand(db);
      if (input.amount > cash.amount) {
        throw errors.validation(
          `Cannot advance more than current cash in hand balance (${formatMoney(cash.amount)}).`,
          { amount: `Exceeds cash in hand balance of ${formatMoney(cash.amount)}` },
        );
      }
    } else {
      if (!input.fromShopAccountId) {
        throw errors.validation('Choose a shop account to transfer from.', {
          fromShopAccountId: 'Required',
        });
      }
      const fromShopAccount = getShopBankAccount(input.fromShopAccountId, db);
      if (!fromShopAccount.isActive) {
        throw errors.validation('The source account is inactive.', {
          fromShopAccountId: 'Account is inactive',
        });
      }
      if (input.amount > fromShopAccount.balance) {
        throw errors.validation(
          `Cannot advance more than current balance (${formatMoney(fromShopAccount.balance)}) of "${fromShopAccount.accountName}".`,
          { amount: `Exceeds current balance of ${formatMoney(fromShopAccount.balance)}` },
        );
      }
      fromShopAccountId = fromShopAccount.id;
      fromBankName = fromShopAccount.bankName;
      fromBankKey = fromShopAccount.bankKey;
      fromAccountNumber = fromShopAccount.accountNumber;
      fromAccountName = fromShopAccount.accountName;
    }

    let toBankName: string | null = null;
    let toAccountNumber: string | null = null;
    let toAccountName: string | null = null;

    if (input.toType === 'ACCOUNT') {
      if (!input.toAccountNumber?.trim()) {
        throw errors.validation('Enter recipient account number.', {
          toAccountNumber: 'Required',
        });
      }
      toBankName = input.toBankName?.trim() || null;
      toAccountNumber = input.toAccountNumber.trim();
      toAccountName = input.toAccountName?.trim() || null;
    }

    const id = newId();
    const advanceNumber = nextNumber('banking', db);
    const now = nowInstant();
    const advanceDate = localDateTimeToInstant(input.advanceAt);
    const advanceDay = localDateTimeToDay(input.advanceAt);

    db.prepare(
      `INSERT INTO "ShopAdvance" (
         id, advanceNumber, advanceDate, advanceDay,
         fromType, fromShopAccountId,
         fromBankName, fromBankKey, fromAccountNumber, fromAccountName,
         toType, recipientName, recipientPhone,
         toBankName, toAccountNumber, toAccountName,
         amount, notes,
         isDeleted, deletedReason,
         createdBy, createdAt, updatedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`,
    ).run(
      id,
      advanceNumber,
      advanceDate,
      advanceDay,
      input.fromType,
      fromShopAccountId,
      fromBankName,
      fromBankKey,
      fromAccountNumber,
      fromAccountName,
      input.toType,
      input.recipientName.trim(),
      input.recipientPhone?.trim() || null,
      toBankName,
      toAccountNumber,
      toAccountName,
      input.amount,
      input.notes?.trim() || null,
      actor.id,
      now,
      now,
    );

    if (input.fromType === 'CASH') {
      adjustCashInHand(
        -input.amount,
        `Shop Advance · ${advanceNumber} (${input.recipientName.trim()})`,
        actor.id,
        db,
      );
    } else if (fromShopAccountId) {
      db.prepare(`UPDATE "ShopBankAccount" SET balance = balance - ?, updatedAt = ? WHERE id = ?`).run(
        input.amount,
        now,
        fromShopAccountId,
      );
    }

    recordAudit(
      {
        userId: actor.id,
        action: 'CREATE',
        entityName: 'ShopAdvance',
        entityId: id,
        summary: `Created shop advance ${advanceNumber} of ${formatMoney(input.amount)} to ${input.recipientName.trim()}`,
        newValues: input,
      },
      db,
    );

    return getShopAdvance(id, db).advance;
  }, db);
}

export function receiveShopAdvance(
  input: ReceiveShopAdvanceInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): { advance: ShopAdvanceRow; settlement: ShopAdvanceSettlementRow } {
  return transaction(() => {
    const { advance } = getShopAdvance(input.shopAdvanceId, db);
    if (advance.isDeleted) {
      throw errors.invalidState('This advance has been deleted.');
    }
    if (advance.status === 'SETTLED' || advance.remaining <= 0) {
      throw errors.invalidState('This advance has already been fully settled.');
    }
    if (input.amount <= 0) {
      throw errors.validation('Amount must be more than zero.', { amount: 'Required' });
    }
    if (input.amount > advance.remaining) {
      throw errors.validation(
        `Repayment amount cannot exceed remaining balance of ${formatMoney(advance.remaining)}.`,
        { amount: `Maximum is ${formatMoney(advance.remaining)}` },
      );
    }

    let toBankName: string | null = null;
    let toBankKey: string | null = null;
    let toAccountNumber: string | null = null;
    let toAccountName: string | null = null;
    let toShopAccountId: string | null = null;

    if (input.toType === 'SHOP_ACCOUNT') {
      if (!input.toShopAccountId) {
        throw errors.validation('Choose a shop account to receive into.', {
          toShopAccountId: 'Required',
        });
      }
      const toShopAccount = getShopBankAccount(input.toShopAccountId, db);
      if (!toShopAccount.isActive) {
        throw errors.validation('The destination account is inactive.', {
          toShopAccountId: 'Account is inactive',
        });
      }
      toShopAccountId = toShopAccount.id;
      toBankName = toShopAccount.bankName;
      toBankKey = toShopAccount.bankKey;
      toAccountNumber = toShopAccount.accountNumber;
      toAccountName = toShopAccount.accountName;
    }

    const settlementId = newId();
    const settlementNumber = nextNumber('banking', db);
    const now = nowInstant();
    const settlementDate = localDateTimeToInstant(input.receivedAt);
    const settlementDay = localDateTimeToDay(input.receivedAt);

    db.prepare(
      `INSERT INTO "ShopAdvanceSettlement" (
         id, shopAdvanceId, settlementNumber, settlementDate, settlementDay,
         toType, toShopAccountId,
         toBankName, toBankKey, toAccountNumber, toAccountName,
         amount, notes,
         isDeleted, deletedReason,
         createdBy, createdAt, updatedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`,
    ).run(
      settlementId,
      advance.id,
      settlementNumber,
      settlementDate,
      settlementDay,
      input.toType,
      toShopAccountId,
      toBankName,
      toBankKey,
      toAccountNumber,
      toAccountName,
      input.amount,
      input.notes?.trim() || null,
      actor.id,
      now,
      now,
    );

    if (input.toType === 'CASH') {
      adjustCashInHand(
        input.amount,
        `Shop Advance Repayment · ${settlementNumber} (${advance.advanceNumber})`,
        actor.id,
        db,
      );
    } else if (toShopAccountId) {
      db.prepare(`UPDATE "ShopBankAccount" SET balance = balance + ?, updatedAt = ? WHERE id = ?`).run(
        input.amount,
        now,
        toShopAccountId,
      );
    }

    recordAudit(
      {
        userId: actor.id,
        action: 'CREATE',
        entityName: 'ShopAdvanceSettlement',
        entityId: settlementId,
        summary: `Received repayment ${settlementNumber} of ${formatMoney(input.amount)} for advance ${advance.advanceNumber}`,
        newValues: input,
      },
      db,
    );

    const updated = getShopAdvance(advance.id, db);
    const settlement = updated.settlements.find((s) => s.id === settlementId)!;
    return { advance: updated.advance, settlement };
  }, db);
}

export function deleteShopAdvanceSettlement(
  id: string,
  reason: string,
  actor: SessionUser,
  db: Db = getDatabase(),
): { deleted: true } {
  return transaction(() => {
    const settlement = db
      .prepare(`${SHOP_ADVANCE_SETTLEMENT_SELECT} WHERE sas.id = ?`)
      .get(id) as ShopAdvanceSettlementRow | undefined;
    if (!settlement) throw errors.notFound('shop advance repayment');
    if (settlement.isDeleted) {
      throw errors.invalidState('This repayment has already been deleted.');
    }

    const now = nowInstant();

    db.prepare(
      `UPDATE "ShopAdvanceSettlement"
          SET isDeleted = 1, deletedReason = ?, updatedAt = ?
        WHERE id = ?`,
    ).run(reason, now, id);

    if (settlement.toType === 'CASH') {
      adjustCashInHand(
        -settlement.amount,
        `Deleted repayment ${settlement.settlementNumber} (${reason})`,
        actor.id,
        db,
      );
    } else if (settlement.toShopAccountId) {
      db.prepare(`UPDATE "ShopBankAccount" SET balance = balance - ?, updatedAt = ? WHERE id = ?`).run(
        settlement.amount,
        now,
        settlement.toShopAccountId,
      );
    }

    recordAudit(
      {
        userId: actor.id,
        action: 'DELETE',
        entityName: 'ShopAdvanceSettlement',
        entityId: id,
        summary: `Deleted repayment ${settlement.settlementNumber} of ${formatMoney(settlement.amount)}: ${reason}`,
        oldValues: settlement,
      },
      db,
    );

    return { deleted: true };
  }, db);
}

export function deleteShopAdvance(
  id: string,
  reason: string,
  actor: SessionUser,
  db: Db = getDatabase(),
): { deleted: true } {
  return transaction(() => {
    const { advance, settlements } = getShopAdvance(id, db);
    if (advance.isDeleted) {
      throw errors.invalidState('This advance has already been deleted.');
    }
    if (settlements.length > 0) {
      throw errors.invalidState(
        'Cannot delete a shop advance that has repayments recorded. Delete the repayments first.',
      );
    }

    const now = nowInstant();

    db.prepare(
      `UPDATE "ShopAdvance"
          SET isDeleted = 1, deletedReason = ?, updatedAt = ?
        WHERE id = ?`,
    ).run(reason, now, id);

    if (advance.fromType === 'CASH') {
      adjustCashInHand(
        advance.amount,
        `Deleted shop advance ${advance.advanceNumber} (${reason})`,
        actor.id,
        db,
      );
    } else if (advance.fromShopAccountId) {
      db.prepare(`UPDATE "ShopBankAccount" SET balance = balance + ?, updatedAt = ? WHERE id = ?`).run(
        advance.amount,
        now,
        advance.fromShopAccountId,
      );
    }

    recordAudit(
      {
        userId: actor.id,
        action: 'DELETE',
        entityName: 'ShopAdvance',
        entityId: id,
        summary: `Deleted shop advance ${advance.advanceNumber} of ${formatMoney(advance.amount)}: ${reason}`,
        oldValues: advance,
      },
      db,
    );

    return { deleted: true };
  }, db);
}
