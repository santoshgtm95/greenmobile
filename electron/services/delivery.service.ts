/**
 * Turning a described report into a file on disk or a page in the printer.
 *
 * Extracted so the Reports screen (spec §90) and the list exports (spec §56)
 * share one path: the same Save As behaviour, the same folder, the same
 * extensions, the same audit entry. Two copies of this would eventually drift,
 * and the second one would be the one nobody tested.
 */
import { dialog } from 'electron';
import path from 'node:path';
import type { ExportFormat, Report } from '../../shared/report';
import { exportsDir } from '../utils/paths';
import { getShopSettings } from './settings.service';
import { printDocument, savePdf } from './print.service';
import { reportToCsv, reportToHtml, reportToXlsx } from './export.service';

export interface DeliverOptions {
  report: Report;
  format: ExportFormat;
  /** Filename without extension. */
  stem: string;
  /** Opens a Save As dialog instead of writing straight to the exports folder. */
  chooseLocation?: boolean;
  /** Printer name for PRINT. Empty uses the shop default. */
  deviceName?: string;
}

export interface DeliverResult {
  saved: boolean;
  path: string | null;
}

const EXTENSIONS: Record<Exclude<ExportFormat, 'PRINT'>, string> = {
  XLSX: 'xlsx',
  CSV: 'csv',
  PDF: 'pdf',
};

export async function deliverReport(options: DeliverOptions): Promise<DeliverResult> {
  const settings = getShopSettings();
  const { report, format } = options;

  if (format === 'PRINT') {
    await printDocument(reportToHtml(report, settings.shopName), {
      deviceName: options.deviceName || settings.defaultPrinter || undefined,
      // Only go straight to a printer when one has actually been named;
      // otherwise show the dialog rather than firing at whatever is default.
      silent: Boolean(options.deviceName || settings.defaultPrinter),
      pageSize: 'A4',
    });
    return { saved: false, path: null };
  }

  const extension = EXTENSIONS[format];
  let target = path.join(exportsDir(), `${options.stem}.${extension}`);

  if (options.chooseLocation) {
    const result = await dialog.showSaveDialog({
      title: `Save ${report.title}`,
      defaultPath: target,
      filters: [{ name: format, extensions: [extension] }],
    });
    // Cancelling is a normal outcome, not a failure.
    if (result.canceled || !result.filePath) return { saved: false, path: null };
    target = result.filePath;
  }

  if (format === 'XLSX') {
    await reportToXlsx(report, target);
  } else if (format === 'CSV') {
    reportToCsv(report, target);
  } else {
    await savePdf(reportToHtml(report, settings.shopName), target, { pageSize: 'A4' });
  }

  return { saved: true, path: target };
}
