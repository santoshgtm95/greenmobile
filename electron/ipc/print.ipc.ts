/**
 * Printing, reprinting and PDF export of sale documents (spec §37, §38).
 *
 * The renderer never sends document markup: it names a sale and a format, and
 * the main process builds the document from the database. That keeps the printed
 * record faithful to what was actually stored.
 */
import { dialog, shell } from 'electron';
import path from 'node:path';
import { z } from 'zod';
import { handle } from './registry';
import { CHANNELS } from '../../shared/channels';
import { zNoPayload, zId } from '../../shared/validation';
import { getSale } from '../services/sale.service';
import { getShopSettings } from '../services/settings.service';
import {
  renderA4Invoice,
  renderThermalReceipt,
  receiptPageSize,
} from '../services/document.service';
import { listPrinters, printDocument, savePdf } from '../services/print.service';
import { recordAudit } from '../services/audit.service';
import { invoicesDir } from '../utils/paths';
import { requireUser } from '../session';
import { logger } from '../utils/logger';

const zPrintSale = z.object({
  saleId: zId,
  format: z.enum(['A4', 'RECEIPT']).default('RECEIPT'),
  /** Windows printer name. Empty means use the shop default, then the system default. */
  deviceName: z.string().max(200).optional(),
  /** false opens the Windows print dialog. */
  silent: z.boolean().default(false),
  reprint: z.boolean().default(false),
  copies: z.number().int().min(1).max(10).default(1),
});

const zSavePdf = z.object({
  saleId: zId,
  format: z.enum(['A4', 'RECEIPT']).default('A4'),
  /** true opens a Save As dialog instead of writing to the invoices folder. */
  chooseLocation: z.boolean().default(false),
});

export function registerPrintIpc(): void {
  handle(CHANNELS.print.listPrinters, { access: 'authenticated' }, zNoPayload, () => listPrinters());

  handle(CHANNELS.print.sale, { access: 'permission', permission: 'sales.view' }, zPrintSale, async (input) => {
    const actor = requireUser();
    const settings = getShopSettings();
    const sale = getSale(input.saleId);

    const html =
      input.format === 'A4'
        ? renderA4Invoice({ sale, settings, reprint: input.reprint })
        : renderThermalReceipt({ sale, settings, reprint: input.reprint });

    await printDocument(html, {
      deviceName: input.deviceName || settings.defaultPrinter || undefined,
      silent: input.silent,
      copies: input.copies,
      pageSize: input.format === 'A4' ? 'A4' : receiptPageSize(settings.receiptWidth),
    });

    recordAudit({
      userId: actor.id,
      action: 'EXPORT',
      entityName: 'Sale',
      entityId: sale.sale.id,
      summary: `${input.reprint ? 'Reprinted' : 'Printed'} ${
        input.format === 'A4' ? 'invoice' : 'receipt'
      } ${sale.sale.invoiceNumber}`,
    });

    return { invoiceNumber: sale.sale.invoiceNumber };
  });

  handle(CHANNELS.print.savePdf, { access: 'permission', permission: 'sales.view' }, zSavePdf, async (input) => {
    const actor = requireUser();
    const settings = getShopSettings();
    const sale = getSale(input.saleId);

    const html =
      input.format === 'A4'
        ? renderA4Invoice({ sale, settings })
        : renderThermalReceipt({ sale, settings });

    const fileName = `${sale.sale.invoiceNumber}.pdf`;
    let target = path.join(invoicesDir(), fileName);

    if (input.chooseLocation) {
      const result = await dialog.showSaveDialog({
        title: 'Save invoice as PDF',
        defaultPath: target,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) {
        return { saved: false as const, path: null };
      }
      target = result.filePath;
    }

    await savePdf(html, target, {
      pageSize: input.format === 'A4' ? 'A4' : receiptPageSize(settings.receiptWidth),
    });

    recordAudit({
      userId: actor.id,
      action: 'EXPORT',
      entityName: 'Sale',
      entityId: sale.sale.id,
      summary: `Saved invoice ${sale.sale.invoiceNumber} as PDF`,
    });

    return { saved: true as const, path: target };
  });

  /** Opens a produced file with whatever Windows uses for it. */
  handle(
    CHANNELS.print.openFile,
    { access: 'authenticated' },
    z.object({ path: z.string().min(1).max(1000) }),
    async ({ path: target }) => {
      // Only files this application generated are ever opened this way.
      const allowedRoot = invoicesDir();
      const resolved = path.resolve(target);
      if (!resolved.toLowerCase().startsWith(path.resolve(allowedRoot).toLowerCase())) {
        logger.warn('Refused to open a file outside the invoices folder', { resolved });
        return { opened: false };
      }
      const error = await shell.openPath(resolved);
      return { opened: error === '' };
    },
  );
}
