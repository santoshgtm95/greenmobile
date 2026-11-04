/**
 * Where the money from a sale, service payment, expense, product purchase or
 * refund actually goes: cash in hand, or one of the shop's registered accounts.
 *
 * One function, so every module moves money the same way and each movement
 * lands in the matching history — the cash in hand history or that account's.
 * Runs inside the caller's database transaction.
 */
import type { Database as Db } from 'better-sqlite3';
import { newId } from '../utils/id';
import { businessDay, nowInstant } from '../../shared/datetime';
import { errors } from '../../shared/errors';
import { adjustCashInHand, ensureAvailable, getShopBankAccount } from './banking.service';
import type { SessionUser } from '../session';

export function moveMoney(
  move: {
    /** Null or undefined: cash in hand. */
    shopAccountId: string | null | undefined;
    /** Minor units: positive in, negative out. */
    amount: number;
    /** Sale, Service payment, Expense, Product purchase, Refund, Reversal, … */
    source: string;
    /** The invoice / expense / service / SKU number it belongs to. */
    reference: string;
    notes?: string | null;
    /** Undoing an earlier movement: allowed even if the account was switched off since. */
    reversal?: boolean;
  },
  actor: SessionUser,
  db: Db,
): void {
  if (move.amount === 0) return;
  // Money going out cannot exceed what is there; undoing an old movement can.
  if (move.amount < 0 && !move.reversal) ensureAvailable(move.shopAccountId, -move.amount, db);

  if (!move.shopAccountId) {
    adjustCashInHand(
      move.amount,
      move.source,
      move.notes ? `${move.reference} · ${move.notes}` : move.reference,
      actor.id,
      db,
    );
    return;
  }

  const account = getShopBankAccount(move.shopAccountId, db);
  if (!account.isActive && !move.reversal) {
    throw errors.invalidState(
      `"${account.bankName} ${account.accountNumber}" is switched off. Choose another account.`,
    );
  }
  const now = nowInstant();
  db.prepare(
    `INSERT INTO "ShopAccountEntry" (id, shopAccountId, entryDate, entryDay, amount, source,
       reference, notes, createdBy, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(),
    account.id,
    now,
    businessDay(),
    move.amount,
    move.source,
    move.reference,
    move.notes ?? null,
    actor.id,
    now,
  );
}
