/**
 * Service / repair jobs (spec §21–§23, §51, §52, §93).
 *
 * A job sheet is a live document while the device is in the shop, then becomes a
 * financial record once it is delivered. Three rules hold that together:
 *
 *   1. Status only moves along the workflow in shared/domain.ts. A job cannot
 *      jump from RECEIVED to DELIVERED without passing through repair.
 *   2. A part taken from stock is a real stock movement (SERVICE_USAGE), so the
 *      shelf count and the inventory ledger stay honest. Removing the line puts
 *      it back.
 *   3. Once DELIVERED or CANCELLED the job is frozen — no more edits to lines.
 *
 * Money: finalCost is derived from the lines, never typed in, so the total the
 * customer is charged always equals what is itemised on the job sheet.
 */
import type { Database as Db } from 'better-sqlite3';
import { getDatabase, transaction } from '../database/connection';
import { newId } from '../utils/id';
import { nowInstant, businessDay } from '../../shared/datetime';
import { errors } from '../../shared/errors';
import { addMoney, multiplyMoney, subtractMoney } from '../../shared/money';
import { recordAudit } from './audit.service';
import { nextNumber } from './sequence.service';
import { getShopSettings } from './settings.service';
import { applyStockMovement } from './inventory.service';
import { WALK_IN_CUSTOMER_NAME } from './customer.service';
import {
  SERVICE_STATUS_TRANSITIONS,
  SERVICE_STATUS_LABELS,
  type PaymentMethod,
  type ServiceItemType,
  type ServiceStatus,
} from '../../shared/domain';
import type { SessionUser } from '../session';
import type {
  CreateServiceOrderInput,
  UpdateServiceOrderInput,
  ServiceListQuery,
  AddServiceItemInput,
  AddServicePaymentInput,
  ChangeServiceStatusInput,
} from '../../shared/validation';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ServiceOrderRow {
  id: string;
  serviceNumber: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  deviceBrand: string;
  deviceModel: string;
  imei: string | null;
  serialNumber: string | null;
  problemDescription: string;
  initialCondition: string | null;
  diagnosis: string | null;
  estimatedCost: number;
  finalCost: number;
  depositAmount: number;
  partsCost: number;
  status: ServiceStatus;
  receivedDate: string;
  receivedDay: string;
  expectedDate: string | null;
  completedDate: string | null;
  deliveredDate: string | null;
  notes: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  /** Derived: total taken so far, including the deposit. */
  amountPaid: number;
  /** Derived: finalCost - amountPaid, never negative. */
  balance: number;
}

export interface ServiceItemRow {
  id: string;
  serviceOrderId: string;
  productId: string | null;
  productName: string | null;
  description: string;
  quantity: number;
  unitCost: number;
  sellingPrice: number;
  total: number;
  type: ServiceItemType;
  createdAt: string;
}

export interface ServicePaymentRow {
  id: string;
  amount: number;
  paymentMethod: PaymentMethod;
  referenceNumber: string | null;
  paymentDate: string;
  isDeposit: number;
  notes: string | null;
  createdByName: string | null;
}

export interface ServiceOrderDetail {
  order: ServiceOrderRow;
  items: ServiceItemRow[];
  payments: ServicePaymentRow[];
}

const ORDER_SELECT = `
  SELECT s.id, s.serviceNumber, s.customerId, s.customerName, s.customerPhone,
         s.deviceBrand, s.deviceModel, s.imei, s.serialNumber, s.problemDescription,
         s.initialCondition, s.diagnosis, s.estimatedCost, s.finalCost, s.depositAmount,
         s.partsCost, s.status, s.receivedDate, s.receivedDay, s.expectedDate,
         s.completedDate, s.deliveredDate, s.notes, s.createdBy, u.fullName AS createdByName,
         s.createdAt,
         COALESCE((SELECT SUM(p.amount) FROM "ServicePayment" p WHERE p.serviceOrderId = s.id), 0)
           AS amountPaid,
         MAX(0, s.finalCost -
             COALESCE((SELECT SUM(p.amount) FROM "ServicePayment" p WHERE p.serviceOrderId = s.id), 0))
           AS balance
    FROM "ServiceOrder" s
    LEFT JOIN "User" u ON u.id = s.createdBy
`;

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

export function getServiceOrder(id: string, db: Db = getDatabase()): ServiceOrderDetail {
  const order = db.prepare(`${ORDER_SELECT} WHERE s.id = ?`).get(id) as ServiceOrderRow | undefined;
  if (!order) throw errors.notFound('service order');

  const items = db
    .prepare(
      `SELECT i.id, i.serviceOrderId, i.productId, p.name AS productName, i.description,
              i.quantity, i.unitCost, i.sellingPrice, i.total, i.type, i.createdAt
         FROM "ServiceItem" i
         LEFT JOIN "Product" p ON p.id = i.productId
        WHERE i.serviceOrderId = ?
        ORDER BY i.createdAt ASC`,
    )
    .all(id) as ServiceItemRow[];

  const payments = db
    .prepare(
      `SELECT p.id, p.amount, p.paymentMethod, p.referenceNumber, p.paymentDate, p.isDeposit,
              p.notes, u.fullName AS createdByName
         FROM "ServicePayment" p
         LEFT JOIN "User" u ON u.id = p.createdBy
        WHERE p.serviceOrderId = ?
        ORDER BY p.paymentDate ASC`,
    )
    .all(id) as ServicePaymentRow[];

  return { order, items, payments };
}

export function listServiceOrders(
  query: ServiceListQuery,
  db: Db = getDatabase(),
): { rows: ServiceOrderRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.status) {
    where.push('s.status = ?');
    params.push(query.status);
  }
  if (query.openOnly) {
    // Everything still the shop's responsibility.
    where.push(`s.status NOT IN ('DELIVERED', 'CANCELLED')`);
  }
  if (query.customerId) {
    where.push('s.customerId = ?');
    params.push(query.customerId);
  }
  if (query.from) {
    where.push('s.receivedDay >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('s.receivedDay <= ?');
    params.push(query.to);
  }
  if (query.search) {
    where.push(
      `(s.serviceNumber LIKE ? COLLATE NOCASE
        OR s.customerName LIKE ? COLLATE NOCASE
        OR s.customerPhone LIKE ?
        OR s.imei = ?
        OR s.deviceModel LIKE ? COLLATE NOCASE)`,
    );
    const like = `%${query.search}%`;
    params.push(like, like, like, query.search, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM "ServiceOrder" s ${whereSql}`).get(...params) as {
      n: number;
    }
  ).n;

  const rows = db
    .prepare(`${ORDER_SELECT} ${whereSql} ORDER BY s.receivedDate DESC LIMIT ? OFFSET ?`)
    .all(...params, query.pageSize, query.page * query.pageSize) as ServiceOrderRow[];

  return { rows, total };
}

/** Counts per status, for the service dashboard columns (spec §51). */
export function serviceBoardCounts(db: Db = getDatabase()): Record<string, number> {
  const rows = db
    .prepare(`SELECT status, COUNT(*) AS n FROM "ServiceOrder" GROUP BY status`)
    .all() as { status: string; n: number }[];
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = row.n;
  return counts;
}

// -----------------------------------------------------------------------------
// Creating and editing
// -----------------------------------------------------------------------------

export function createServiceOrder(
  input: CreateServiceOrderInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): ServiceOrderDetail {
  return transaction(() => {
    const customer = input.customerId
      ? (db.prepare(`SELECT id, name, phone FROM "Customer" WHERE id = ?`).get(input.customerId) as
          | { id: string; name: string; phone: string | null }
          | undefined)
      : undefined;
    if (input.customerId && !customer) throw errors.notFound('customer');

    const id = newId();
    const serviceNumber = nextNumber('service', db);
    const now = nowInstant();

    db.prepare(
      `INSERT INTO "ServiceOrder" (id, serviceNumber, customerId, customerName, customerPhone,
         deviceBrand, deviceModel, imei, serialNumber, problemDescription, initialCondition,
         diagnosis, estimatedCost, finalCost, depositAmount, partsCost, status,
         receivedDate, receivedDay, expectedDate, completedDate, deliveredDate, notes,
         createdBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, 0, 0, 'RECEIVED',
               ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    ).run(
      id,
      serviceNumber,
      customer?.id ?? null,
      // Snapshot, so the job sheet stays truthful if the customer is renamed.
      customer?.name ?? input.customerName ?? WALK_IN_CUSTOMER_NAME,
      customer?.phone ?? input.customerPhone ?? null,
      input.deviceBrand,
      input.deviceModel,
      input.imei ?? null,
      input.serialNumber ?? null,
      input.problemDescription,
      input.initialCondition ?? null,
      input.estimatedCost,
      now,
      businessDay(),
      input.expectedDate ?? null,
      input.notes ?? null,
      actor.id,
      now,
      now,
    );

    // A deposit taken at the counter is recorded as a payment, so the money is
    // never only a number on the header.
    if (input.depositAmount > 0) {
      addPaymentInternal(
        {
          serviceOrderId: id,
          amount: input.depositAmount,
          paymentMethod: input.depositMethod ?? 'CASH',
          referenceNumber: undefined,
          notes: 'Deposit taken on receipt',
          isDeposit: true,
        },
        actor,
        db,
      );
      db.prepare(`UPDATE "ServiceOrder" SET depositAmount = ? WHERE id = ?`).run(
        input.depositAmount,
        id,
      );
    }

    recordAudit(
      {
        userId: actor.id,
        action: 'CREATE',
        entityName: 'ServiceOrder',
        entityId: id,
        summary: `Service ${serviceNumber} received — ${input.deviceBrand} ${input.deviceModel}`,
        newValues: input,
      },
      db,
    );

    return getServiceOrder(id, db);
  }, db);
}

export function updateServiceOrder(
  input: UpdateServiceOrderInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): ServiceOrderDetail {
  return transaction(() => {
    const { order } = getServiceOrder(input.id, db);
    assertEditable(order);

    db.prepare(
      `UPDATE "ServiceOrder"
          SET deviceBrand = ?, deviceModel = ?, imei = ?, serialNumber = ?,
              problemDescription = ?, initialCondition = ?, diagnosis = ?,
              estimatedCost = ?, expectedDate = ?, notes = ?, updatedAt = ?
        WHERE id = ?`,
    ).run(
      input.deviceBrand,
      input.deviceModel,
      input.imei ?? null,
      input.serialNumber ?? null,
      input.problemDescription,
      input.initialCondition ?? null,
      input.diagnosis ?? null,
      input.estimatedCost,
      input.expectedDate ?? null,
      input.notes ?? null,
      nowInstant(),
      input.id,
    );

    recordAudit(
      {
        userId: actor.id,
        action: 'UPDATE',
        entityName: 'ServiceOrder',
        entityId: input.id,
        summary: `Updated service ${order.serviceNumber}`,
        oldValues: order,
        newValues: input,
      },
      db,
    );

    return getServiceOrder(input.id, db);
  }, db);
}

function assertEditable(order: ServiceOrderRow): void {
  if (order.status === 'DELIVERED') {
    throw errors.invalidState(
      `Service ${order.serviceNumber} has been delivered and is now a closed record.`,
    );
  }
  if (order.status === 'CANCELLED') {
    throw errors.invalidState(`Service ${order.serviceNumber} was cancelled.`);
  }
}

// -----------------------------------------------------------------------------
// Parts and labour
// -----------------------------------------------------------------------------

/** Recomputes finalCost and partsCost from the lines. Call after any line change. */
function recalculateTotals(serviceOrderId: string, db: Db): void {
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(total), 0) AS finalCost,
              COALESCE(SUM(CASE WHEN type = 'PART' THEN unitCost * quantity ELSE 0 END), 0)
                AS partsCost
         FROM "ServiceItem" WHERE serviceOrderId = ?`,
    )
    .get(serviceOrderId) as { finalCost: number; partsCost: number };

  db.prepare(`UPDATE "ServiceOrder" SET finalCost = ?, partsCost = ?, updatedAt = ? WHERE id = ?`).run(
    totals.finalCost,
    totals.partsCost,
    nowInstant(),
    serviceOrderId,
  );
}

export function addServiceItem(
  input: AddServiceItemInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): ServiceOrderDetail {
  const settings = getShopSettings(db);

  return transaction(() => {
    const { order } = getServiceOrder(input.serviceOrderId, db);
    assertEditable(order);

    let unitCost = input.unitCost;
    let description = input.description;

    // A part drawn from stock is priced and costed from the product, and taken
    // off the shelf with a ledger entry naming the job.
    if (input.productId) {
      const product = db
        .prepare(
          `SELECT id, name, purchasePrice, sellingPrice, isSerialized FROM "Product" WHERE id = ?`,
        )
        .get(input.productId) as
        | { id: string; name: string; purchasePrice: number; sellingPrice: number; isSerialized: number }
        | undefined;
      if (!product) throw errors.productGone();
      if (product.isSerialized) {
        throw errors.invalidState(
          `"${product.name}" is tracked by IMEI and cannot be consumed as a spare part.`,
        );
      }

      unitCost = product.purchasePrice;
      if (!description.trim()) description = product.name;

      applyStockMovement(
        {
          productId: product.id,
          quantity: -input.quantity,
          transactionType: 'SERVICE_USAGE',
          reason: `Used on service ${order.serviceNumber}`,
          createdBy: actor.id,
          unitCost: product.purchasePrice,
          referenceType: 'SERVICE_ORDER',
          referenceId: order.id,
        },
        { allowNegativeStock: settings.allowNegativeStock },
        db,
      );
    }

    const total = multiplyMoney(input.sellingPrice, input.quantity);
    const itemId = newId();

    db.prepare(
      `INSERT INTO "ServiceItem" (id, serviceOrderId, productId, description, quantity,
         unitCost, sellingPrice, total, type, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      itemId,
      input.serviceOrderId,
      input.productId ?? null,
      description,
      input.quantity,
      unitCost,
      input.sellingPrice,
      total,
      input.type,
      nowInstant(),
    );

    recalculateTotals(input.serviceOrderId, db);

    recordAudit(
      {
        userId: actor.id,
        action: 'UPDATE',
        entityName: 'ServiceOrder',
        entityId: input.serviceOrderId,
        summary: `Added ${input.type.toLowerCase()} "${description}" to ${order.serviceNumber}`,
        newValues: { ...input, total },
      },
      db,
    );

    return getServiceOrder(input.serviceOrderId, db);
  }, db);
}

export function removeServiceItem(
  itemId: string,
  actor: SessionUser,
  db: Db = getDatabase(),
): ServiceOrderDetail {
  const settings = getShopSettings(db);

  return transaction(() => {
    const item = db
      .prepare(
        `SELECT id, serviceOrderId, productId, description, quantity, unitCost, type
           FROM "ServiceItem" WHERE id = ?`,
      )
      .get(itemId) as
      | {
          id: string;
          serviceOrderId: string;
          productId: string | null;
          description: string;
          quantity: number;
          unitCost: number;
          type: string;
        }
      | undefined;
    if (!item) throw errors.notFound('service line');

    const { order } = getServiceOrder(item.serviceOrderId, db);
    assertEditable(order);

    // Putting the line back must put the stock back too.
    if (item.productId) {
      applyStockMovement(
        {
          productId: item.productId,
          quantity: item.quantity,
          transactionType: 'SERVICE_USAGE',
          reason: `Returned to stock from service ${order.serviceNumber}`,
          createdBy: actor.id,
          unitCost: item.unitCost,
          referenceType: 'SERVICE_ORDER',
          referenceId: order.id,
          allowNegative: true,
        },
        { allowNegativeStock: settings.allowNegativeStock },
        db,
      );
    }

    db.prepare(`DELETE FROM "ServiceItem" WHERE id = ?`).run(itemId);
    recalculateTotals(item.serviceOrderId, db);

    recordAudit(
      {
        userId: actor.id,
        action: 'UPDATE',
        entityName: 'ServiceOrder',
        entityId: item.serviceOrderId,
        summary: `Removed "${item.description}" from ${order.serviceNumber}`,
        oldValues: item,
      },
      db,
    );

    return getServiceOrder(item.serviceOrderId, db);
  }, db);
}

// -----------------------------------------------------------------------------
// Payments
// -----------------------------------------------------------------------------

function addPaymentInternal(
  input: {
    serviceOrderId: string;
    amount: number;
    paymentMethod: PaymentMethod;
    referenceNumber?: string;
    notes?: string;
    isDeposit: boolean;
  },
  actor: SessionUser,
  db: Db,
): void {
  const now = nowInstant();
  db.prepare(
    `INSERT INTO "ServicePayment" (id, serviceOrderId, amount, paymentMethod, referenceNumber,
       paymentDate, paymentDay, isDeposit, notes, createdBy, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(),
    input.serviceOrderId,
    input.amount,
    input.paymentMethod,
    input.referenceNumber ?? null,
    now,
    businessDay(),
    input.isDeposit ? 1 : 0,
    input.notes ?? null,
    actor.id,
    now,
  );
}

export function addServicePayment(
  input: AddServicePaymentInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): ServiceOrderDetail {
  return transaction(() => {
    const { order } = getServiceOrder(input.serviceOrderId, db);
    if (order.status === 'CANCELLED') {
      throw errors.invalidState('This job was cancelled. No further payment can be taken.');
    }

    // Taking more than is owed would leave the books showing a liability that
    // does not exist; the counter should give change instead.
    if (order.balance > 0 && input.amount > order.balance) {
      throw errors.validation(
        `Only ${order.balance} is still owing on this job. Enter that or less.`,
        { amount: 'More than the outstanding balance' },
      );
    }
    if (order.balance === 0) {
      throw errors.invalidState('This job is already paid in full.');
    }

    addPaymentInternal({ ...input, isDeposit: false }, actor, db);

    recordAudit(
      {
        userId: actor.id,
        action: 'UPDATE',
        entityName: 'ServiceOrder',
        entityId: input.serviceOrderId,
        summary: `Payment of ${input.amount} taken on ${order.serviceNumber}`,
        newValues: input,
      },
      db,
    );

    return getServiceOrder(input.serviceOrderId, db);
  }, db);
}

// -----------------------------------------------------------------------------
// Status workflow (spec §52)
// -----------------------------------------------------------------------------

export function changeServiceStatus(
  input: ChangeServiceStatusInput,
  actor: SessionUser,
  db: Db = getDatabase(),
): ServiceOrderDetail {
  return transaction(() => {
    const { order } = getServiceOrder(input.serviceOrderId, db);

    if (order.status === input.status) return getServiceOrder(input.serviceOrderId, db);

    const allowed = SERVICE_STATUS_TRANSITIONS[order.status];
    if (!allowed.includes(input.status)) {
      throw errors.invalidState(
        `A job that is ${SERVICE_STATUS_LABELS[order.status]} cannot move straight to ${
          SERVICE_STATUS_LABELS[input.status]
        }.`,
      );
    }

    // Handing the device back is the point at which the money must be settled.
    if (input.status === 'DELIVERED' && order.balance > 0) {
      throw errors.invalidState(
        `${order.balance} is still owing on this job. Record the payment before marking it delivered.`,
      );
    }

    const now = nowInstant();
    const completedDate =
      input.status === 'COMPLETED' ? now : input.status === 'REPAIRING' ? null : order.completedDate;
    const deliveredDate = input.status === 'DELIVERED' ? now : order.deliveredDate;

    db.prepare(
      `UPDATE "ServiceOrder"
          SET status = ?, completedDate = ?, deliveredDate = ?,
              notes = CASE WHEN ? IS NULL THEN notes
                           ELSE COALESCE(notes || ' | ', '') || ? END,
              updatedAt = ?
        WHERE id = ?`,
    ).run(
      input.status,
      completedDate,
      deliveredDate,
      input.note ?? null,
      input.note ?? null,
      now,
      input.serviceOrderId,
    );

    recordAudit(
      {
        userId: actor.id,
        action: input.status === 'CANCELLED' ? 'CANCEL' : 'UPDATE',
        entityName: 'ServiceOrder',
        entityId: input.serviceOrderId,
        summary: `Service ${order.serviceNumber}: ${SERVICE_STATUS_LABELS[order.status]} → ${
          SERVICE_STATUS_LABELS[input.status]
        }${input.note ? ` (${input.note})` : ''}`,
        oldValues: { status: order.status },
        newValues: { status: input.status, note: input.note },
      },
      db,
    );

    return getServiceOrder(input.serviceOrderId, db);
  }, db);
}

/** Which statuses this job may move to next, for the UI. */
export function allowedTransitions(status: ServiceStatus): ServiceStatus[] {
  return [...SERVICE_STATUS_TRANSITIONS[status]];
}

// -----------------------------------------------------------------------------
// Summary — for the service report and dashboard
// -----------------------------------------------------------------------------

export interface ServiceSummary {
  received: number;
  delivered: number;
  /** Money charged on jobs delivered in the period. */
  revenue: number;
  /** Cost of the parts consumed on those jobs. */
  partsCost: number;
  /** revenue - partsCost. Labour is profit; the shop's own time is not a cost here. */
  grossProfit: number;
  /** Still owed on jobs that are not cancelled. */
  outstanding: number;
  byStatus: Array<{ status: string; count: number }>;
}

export function serviceSummary(
  range: { from: string; to: string },
  db: Db = getDatabase(),
): ServiceSummary {
  const received = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM "ServiceOrder" WHERE receivedDay BETWEEN ? AND ?`)
      .get(range.from, range.to) as { n: number }
  ).n;

  const delivered = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(finalCost), 0) AS revenue,
              COALESCE(SUM(partsCost), 0) AS partsCost
         FROM "ServiceOrder"
        WHERE status = 'DELIVERED' AND date(deliveredDate) BETWEEN ? AND ?`,
    )
    .get(range.from, range.to) as { n: number; revenue: number; partsCost: number };

  const outstanding = (
    db
      .prepare(
        `SELECT COALESCE(SUM(MAX(0, s.finalCost -
                 COALESCE((SELECT SUM(p.amount) FROM "ServicePayment" p
                            WHERE p.serviceOrderId = s.id), 0))), 0) AS total
           FROM "ServiceOrder" s
          WHERE s.status <> 'CANCELLED'`,
      )
      .get() as { total: number }
  ).total;

  const byStatus = db
    .prepare(`SELECT status, COUNT(*) AS count FROM "ServiceOrder" GROUP BY status`)
    .all() as ServiceSummary['byStatus'];

  return {
    received,
    delivered: delivered.n,
    revenue: delivered.revenue,
    partsCost: delivered.partsCost,
    grossProfit: subtractMoney(delivered.revenue, delivered.partsCost),
    outstanding,
    byStatus,
  };
}

/** Total taken across a job's payments. Exported for the job-sheet document. */
export function paidTotal(payments: ServicePaymentRow[]): number {
  return addMoney(...payments.map((p) => p.amount), 0);
}
