/**
 * Dashboard, trading reports and report export (spec §28, §31, §72, §90).
 *
 * Everything here is read-only aggregation. The dashboard is available to anyone
 * who can see sales, because a cashier needs to know how the day is going; the
 * detailed reports need reports.view, since they expose margins and costs.
 */
import { shell } from 'electron';
import { z } from 'zod';
import { handle } from './registry';
import { CHANNELS } from '../../shared/channels';
import { zDayRange } from '../../shared/validation';
import { REPORT_KINDS, EXPORT_FORMATS } from '../../shared/report';
import { dashboard, profitAndLoss, salesSummary } from '../services/report.service';
import { buildReport } from '../services/report-builder.service';
import { reportFileStem } from '../services/export.service';
import { deliverReport } from '../services/delivery.service';
import { recordAudit } from '../services/audit.service';
import { exportsDir } from '../utils/paths';
import { requireUser } from '../session';
import { logger } from '../utils/logger';

const zReportRequest = z.object({
  kind: z.enum(REPORT_KINDS),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const zExportRequest = zReportRequest.extend({
  format: z.enum(EXPORT_FORMATS),
  /** Opens a Save As dialog instead of writing to the exports folder. */
  chooseLocation: z.boolean().default(false),
  /** Printer name for the PRINT format. Empty uses the shop default. */
  deviceName: z.string().max(200).optional(),
});

export function registerReportsIpc(): void {
  handle(CHANNELS.reports.dashboard, { access: 'permission', permission: 'sales.view' }, zDayRange, (range) =>
    dashboard(range),
  );

  handle(CHANNELS.reports.sales, { access: 'permission', permission: 'reports.view' }, zDayRange, (range) =>
    salesSummary(range),
  );

  handle(CHANNELS.reports.profitAndLoss, { access: 'permission', permission: 'reports.view' }, zDayRange, (range) =>
    profitAndLoss(range),
  );

  handle(
    CHANNELS.reports.build,
    { access: 'permission', permission: 'reports.view' },
    zReportRequest,
    ({ kind, from, to }) => buildReport(kind, { from, to }),
  );

  /**
   * Renders a report to Excel, CSV, PDF or a printer.
   *
   * The renderer names a report and a format; the document is produced here from
   * the database, so an export can never disagree with what the screen showed.
   */
  handle(
    CHANNELS.reports.export,
    { access: 'permission', permission: 'reports.view' },
    zExportRequest,
    async (input) => {
      const actor = requireUser();
      const report = buildReport(input.kind, { from: input.from, to: input.to });

      const result = await deliverReport({
        report,
        format: input.format,
        stem: reportFileStem(report),
        chooseLocation: input.chooseLocation,
        deviceName: input.deviceName,
      });

      recordAudit({
        userId: actor.id,
        action: 'EXPORT',
        entityName: 'Report',
        entityId: input.kind,
        summary:
          input.format === 'PRINT'
            ? `Printed the ${report.title} for ${report.periodLabel}`
            : `Exported the ${report.title} for ${report.periodLabel} as ${input.format}`,
      });

      return result;
    },
  );

  /** Opens the exports folder in Windows Explorer. */
  handle(CHANNELS.reports.openExportsFolder, { access: 'permission', permission: 'reports.view' }, z.undefined().or(z.null()), async () => {
    const folder = exportsDir();
    const error = await shell.openPath(folder);
    if (error) logger.warn('Could not open the exports folder', { folder, error });
    return { opened: error === '', path: folder };
  });
}
