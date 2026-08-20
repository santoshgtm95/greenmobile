/**
 * Document numbers: invoices, service jobs, expenses, returns, customer codes.
 *
 * The counter lives in the Setting table and is bumped with a single atomic
 * UPDATE ... RETURNING. Callers must already be inside the same transaction as
 * the record being created, so a rolled-back sale never burns an invoice number
 * and two tills can never be handed the same one.
 *
 * Format: <PREFIX>-<YYYYMM>-<0001>  e.g. INV-202608-0001
 */
import type { Database as Db } from 'better-sqlite3';
import { getDatabase } from '../database/connection';
import { DEFAULT_SETTINGS, type SettingKey } from '../../shared/settings';

export type SequenceName = 'invoice' | 'service' | 'expense' | 'return' | 'customer' | 'banking';

const SEQUENCES: Record<SequenceName, { counter: SettingKey; prefix: SettingKey }> = {
  invoice: { counter: 'invoiceNumber', prefix: 'invoicePrefix' },
  service: { counter: 'serviceNumber', prefix: 'servicePrefix' },
  expense: { counter: 'expenseNumber', prefix: 'expensePrefix' },
  return: { counter: 'returnNumber', prefix: 'returnPrefix' },
  customer: { counter: 'customerNumber', prefix: 'customerPrefix' },
  banking: { counter: 'bankingNumber', prefix: 'bankingPrefix' },
};

/**
 * Reserves and returns the next document number for `name`.
 * Call inside the transaction that writes the document.
 */
export function nextNumber(name: SequenceName, db: Db = getDatabase()): string {
  const { counter, prefix } = SEQUENCES[name];

  // Single statement: read, increment and return without a gap for a second
  // writer to slip into.
  const row = db
    .prepare(
      `UPDATE "Setting"
          SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
        WHERE key = ?
        RETURNING value`,
    )
    .get(counter) as { value: string } | undefined;

  if (!row) {
    throw new Error(`Sequence "${counter}" is missing from the Setting table`);
  }

  const sequence = Number.parseInt(row.value, 10);
  const prefixRow = db.prepare(`SELECT value FROM "Setting" WHERE key = ?`).get(prefix) as
    | { value: string }
    | undefined;
  const prefixText = (prefixRow?.value ?? DEFAULT_SETTINGS[prefix]).trim() || 'DOC';

  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

  return `${prefixText}-${yearMonth}-${String(sequence).padStart(4, '0')}`;
}

/** Current counter value without consuming one. For the settings screen. */
export function peekNumber(name: SequenceName, db: Db = getDatabase()): number {
  const { counter } = SEQUENCES[name];
  const row = db.prepare(`SELECT value FROM "Setting" WHERE key = ?`).get(counter) as
    | { value: string }
    | undefined;
  return Number.parseInt(row?.value ?? '0', 10) || 0;
}
