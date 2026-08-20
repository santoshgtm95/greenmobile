/**
 * Customers (spec §14, §41, §42, §91).
 *
 * A customer is optional at the till: an anonymous sale records the walk-in name
 * on the invoice without creating a record (spec §35).
 */
import type { Database as Db } from 'better-sqlite3';
import { getDatabase, transaction } from '../database/connection';
import { newId } from '../utils/id';
import { nowInstant } from '../../shared/datetime';
import { errors } from '../../shared/errors';
import { recordAudit } from './audit.service';
import { nextNumber } from './sequence.service';
import type { SessionUser } from '../session';
import type { CreateCustomerInput, UpdateCustomerInput, PagingInput } from '../../shared/validation';

export const WALK_IN_CUSTOMER_NAME = 'Walk-in Customer';

export interface CustomerRow {
  id: string;
  customerCode: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: number;
  totalOrders: number;
  totalSpent: number;
  lastPurchaseAt: string | null;
  createdAt: string;
}

/**
 * Totals come from COMPLETED and partially refunded sales, net of refunds, so
 * the "total spent" a shop sees matches what the customer actually kept.
 */
const CUSTOMER_SELECT = `
  SELECT c.id, c.customerCode, c.name, c.phone, c.email, c.address, c.notes, c.isActive,
         c.createdAt,
         (SELECT COUNT(*) FROM "Sale" s
           WHERE s.customerId = c.id AND s.status <> 'CANCELLED') AS totalOrders,
         COALESCE((SELECT SUM(s.grandTotal - s.refundedAmount) FROM "Sale" s
           WHERE s.customerId = c.id AND s.status <> 'CANCELLED'), 0) AS totalSpent,
         (SELECT MAX(s.saleDate) FROM "Sale" s
           WHERE s.customerId = c.id AND s.status <> 'CANCELLED') AS lastPurchaseAt
    FROM "Customer" c
`;

export function listCustomers(
  query: PagingInput & { includeInactive?: boolean },
  db: Db = getDatabase(),
): { rows: CustomerRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (!query.includeInactive) where.push('c.isActive = 1');

  if (query.search) {
    where.push(
      '(c.name LIKE ? COLLATE NOCASE OR c.phone LIKE ? OR c.customerCode LIKE ? COLLATE NOCASE)',
    );
    const like = `%${query.search}%`;
    params.push(like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM "Customer" c ${whereSql}`).get(...params) as { n: number }
  ).n;

  const rows = db
    .prepare(`${CUSTOMER_SELECT} ${whereSql} ORDER BY c.name ASC LIMIT ? OFFSET ?`)
    .all(...params, query.pageSize, query.page * query.pageSize) as CustomerRow[];

  return { rows, total };
}

export function getCustomer(id: string, db: Db = getDatabase()): CustomerRow {
  const row = db.prepare(`${CUSTOMER_SELECT} WHERE c.id = ?`).get(id) as CustomerRow | undefined;
  if (!row) throw errors.notFound('customer');
  return row;
}

export function createCustomer(
  input: CreateCustomerInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): CustomerRow {
  return transaction(() => {
    const id = newId();
    const now = nowInstant();
    const code = nextNumber('customer', db);

    db.prepare(
      `INSERT INTO "Customer" (id, customerCode, name, phone, email, address, notes, isActive,
         createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(
      id,
      code,
      input.name,
      input.phone ?? null,
      input.email ?? null,
      input.address ?? null,
      input.notes ?? null,
      now,
      now,
    );

    recordAudit(
      {
        userId: actor.id,
        action: 'CREATE',
        entityName: 'Customer',
        entityId: id,
        summary: `Created customer "${input.name}" (${code})`,
        newValues: input,
      },
      db,
    );

    return getCustomer(id, db);
  }, db);
}

export function updateCustomer(
  input: UpdateCustomerInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): CustomerRow {
  return transaction(() => {
    const before = getCustomer(input.id, db);

    db.prepare(
      `UPDATE "Customer"
          SET name = ?, phone = ?, email = ?, address = ?, notes = ?, isActive = ?, updatedAt = ?
        WHERE id = ?`,
    ).run(
      input.name,
      input.phone ?? null,
      input.email ?? null,
      input.address ?? null,
      input.notes ?? null,
      input.isActive ? 1 : 0,
      nowInstant(),
      input.id,
    );

    recordAudit(
      {
        userId: actor.id,
        action: 'UPDATE',
        entityName: 'Customer',
        entityId: input.id,
        summary: `Updated customer "${input.name}"`,
        oldValues: before,
        newValues: input,
      },
      db,
    );

    return getCustomer(input.id, db);
  }, db);
}

export interface CustomerPurchaseRow {
  saleId: string;
  invoiceNumber: string;
  saleDate: string;
  saleDay: string;
  grandTotal: number;
  refundedAmount: number;
  status: string;
  paymentStatus: string;
  itemCount: number;
  productSummary: string;
  serials: string | null;
  paymentMethods: string | null;
}

/** Purchase history for the customer detail screen (spec §42, §91). */
export function purchaseHistory(
  customerId: string,
  limit = 100,
  db: Db = getDatabase(),
): CustomerPurchaseRow[] {
  return db
    .prepare(
      `SELECT s.id AS saleId, s.invoiceNumber, s.saleDate, s.saleDay, s.grandTotal,
              s.refundedAmount, s.status, s.paymentStatus,
              (SELECT COUNT(*) FROM "SaleItem" i WHERE i.saleId = s.id) AS itemCount,
              (SELECT GROUP_CONCAT(i.productName, ', ') FROM "SaleItem" i WHERE i.saleId = s.id)
                AS productSummary,
              (SELECT GROUP_CONCAT(COALESCE(ps.imei1, ps.serialNumber), ', ')
                 FROM "SaleItem" i
                 JOIN "ProductSerial" ps ON ps.saleItemId = i.id
                WHERE i.saleId = s.id) AS serials,
              (SELECT GROUP_CONCAT(DISTINCT p.paymentMethod) FROM "Payment" p WHERE p.saleId = s.id)
                AS paymentMethods
         FROM "Sale" s
        WHERE s.customerId = ?
        ORDER BY s.saleDate DESC
        LIMIT ?`,
    )
    .all(customerId, limit) as CustomerPurchaseRow[];
}

export interface CustomerServiceRow {
  id: string;
  serviceNumber: string;
  deviceBrand: string;
  deviceModel: string;
  imei: string | null;
  status: string;
  finalCost: number;
  receivedDate: string;
  completedDate: string | null;
}

export function serviceHistory(
  customerId: string,
  limit = 100,
  db: Db = getDatabase(),
): CustomerServiceRow[] {
  return db
    .prepare(
      `SELECT id, serviceNumber, deviceBrand, deviceModel, imei, status, finalCost,
              receivedDate, completedDate
         FROM "ServiceOrder"
        WHERE customerId = ?
        ORDER BY receivedDate DESC
        LIMIT ?`,
    )
    .all(customerId, limit) as CustomerServiceRow[];
}
