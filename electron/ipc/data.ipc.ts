/**
 * List export and product import (spec §56, §57).
 *
 * Export is read-only and needs whatever permission the underlying screen needs
 * — a cashier who may see the product list may take it away as a spreadsheet.
 * Import writes to the catalogue, so it needs `products.import`.
 */
import { dialog } from 'electron';
import path from 'node:path';
import { z } from 'zod';
import { handle } from './registry';
import { CHANNELS } from '../../shared/channels';
import {
  zBankTransactionListQuery,
  zCustomerListQuery,
  zExpenseListQuery,
  zImportPreview,
  zNoPayload,
  zProductListQuery,
  zSaleListQuery,
} from '../../shared/validation';
import { EXPORT_FORMATS } from '../../shared/report';
import {
  buildListExport,
  listFileStem,
  type ListExportQuery,
} from '../services/list-export.service';
import { deliverReport } from '../services/delivery.service';
import {
  commitProductImport,
  forgetParse,
  previewProductImport,
  writeImportTemplate,
} from '../services/import.service';
import { recordAudit } from '../services/audit.service';
import { exportsDir } from '../utils/paths';
import { requireUser, requirePermission } from '../session';
import { errors } from '../../shared/errors';
import { logger } from '../utils/logger';
import type { Permission } from '../../shared/domain';

/**
 * A discriminated union rather than a loose `query: any`: each dataset is
 * validated by the same schema its own list channel uses, so an export can
 * never reach the database with a filter the list itself would have rejected.
 */
const deliveryFields = {
  format: z.enum(EXPORT_FORMATS),
  chooseLocation: z.boolean().default(false),
  deviceName: z.string().max(200).optional(),
};

const zExportList = z.discriminatedUnion('dataset', [
  z.object({ dataset: z.literal('PRODUCT_LIST'), query: zProductListQuery, ...deliveryFields }),
  z.object({ dataset: z.literal('CUSTOMER_LIST'), query: zCustomerListQuery, ...deliveryFields }),
  z.object({ dataset: z.literal('SALE_LIST'), query: zSaleListQuery, ...deliveryFields }),
  z.object({ dataset: z.literal('EXPENSE_LIST'), query: zExpenseListQuery, ...deliveryFields }),
  z.object({
    dataset: z.literal('BANK_TRANSACTION_LIST'),
    query: zBankTransactionListQuery,
    ...deliveryFields,
  }),
  z.object({
    dataset: z.literal('INVENTORY_LIST'),
    query: z.object({}).default({}),
    ...deliveryFields,
  }),
]);

/** Seeing a list is what entitles you to export it. */
const DATASET_PERMISSION: Record<string, Permission> = {
  PRODUCT_LIST: 'products.view',
  CUSTOMER_LIST: 'customers.view',
  SALE_LIST: 'sales.view',
  EXPENSE_LIST: 'expenses.view',
  BANK_TRANSACTION_LIST: 'banking.view',
  INVENTORY_LIST: 'inventory.view',
};

const SPREADSHEET_FILTERS = [
  { name: 'Spreadsheets', extensions: ['xlsx', 'csv'] },
  { name: 'Excel workbook', extensions: ['xlsx'] },
  { name: 'CSV file', extensions: ['csv'] },
];

export function registerDataIpc(): void {
  /**
   * Exports a list screen (spec §56).
   *
   * Registered as `authenticated` and then checked per dataset, because the
   * permission depends on which list is being asked for. The registry's own
   * check cannot express that, so it happens explicitly on the first line.
   */
  handle(
    CHANNELS.data.exportList,
    { access: 'authenticated' },
    zExportList,
    async (input) => {
      const actor = requirePermission(DATASET_PERMISSION[input.dataset]);

      const report = buildListExport({
        dataset: input.dataset,
        query: input.query,
      } as ListExportQuery);

      const result = await deliverReport({
        report,
        format: input.format,
        stem: listFileStem(input.dataset),
        chooseLocation: input.chooseLocation,
        deviceName: input.deviceName,
      });

      recordAudit({
        userId: actor.id,
        action: 'EXPORT',
        entityName: 'List',
        entityId: input.dataset,
        summary:
          input.format === 'PRINT'
            ? `Printed the ${report.title}`
            : `Exported the ${report.title} as ${input.format}`,
      });

      return result;
    },
  );

  /**
   * Reads a spreadsheet and reports what importing it would do (spec §57).
   * Writes nothing.
   */
  handle(
    CHANNELS.data.importPreview,
    { access: 'permission', permission: 'products.import' },
    zImportPreview,
    async (input) => {
      let file = input?.path;

      if (!file) {
        const result = await dialog.showOpenDialog({
          title: 'Choose a product list to import',
          properties: ['openFile'],
          filters: SPREADSHEET_FILTERS,
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        file = result.filePaths[0];
      }

      const extension = path.extname(file).toLowerCase();
      if (!['.xlsx', '.csv'].includes(extension)) {
        throw errors.importFailed('Choose an .xlsx or .csv file.');
      }

      return previewProductImport(file);
    },
  );

  /** Writes the previewed import (spec §57). */
  handle(
    CHANNELS.data.importCommit,
    { access: 'permission', permission: 'products.import' },
    z.object({ importId: z.string().min(1).max(64) }),
    (input) => commitProductImport(input.importId, requireUser()),
  );

  /** The user pressed Cancel — let go of the parsed file. */
  handle(
    CHANNELS.data.importCancel,
    { access: 'permission', permission: 'products.import' },
    z.object({ importId: z.string().min(1).max(64) }),
    (input) => {
      forgetParse(input.importId);
      return { cancelled: true as const };
    },
  );

  /** Saves a blank spreadsheet with the right columns to fill in. */
  handle(
    CHANNELS.data.importTemplate,
    { access: 'permission', permission: 'products.import' },
    zNoPayload,
    async () => {
      const suggested = path.join(exportsDir(), 'product-import-template.xlsx');
      const result = await dialog.showSaveDialog({
        title: 'Save the product import template',
        defaultPath: suggested,
        filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
      });
      if (result.canceled || !result.filePath) return { saved: false as const, path: null };

      await writeImportTemplate(result.filePath);
      logger.info('Import template saved', { path: result.filePath });
      return { saved: true as const, path: result.filePath };
    },
  );
}
