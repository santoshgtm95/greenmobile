/**
 * Service / repair jobs (spec §28, §51, §52, §93).
 *
 * A cashier can take a device in and record progress (services.manage), because
 * that is counter work. Nothing here can change stock except through the parts
 * lines, which go via the same inventory ledger as everything else.
 */
import path from 'node:path';
import { z } from 'zod';
import { handle } from './registry';
import { CHANNELS } from '../../shared/channels';
import {
  zCreateServiceOrder,
  zUpdateServiceOrder,
  zServiceListQuery,
  zAddServiceItem,
  zAddServicePayment,
  zChangeServiceStatus,
  zServiceOrderId,
  zIdOnly,
  zNoPayload,
  zDayRange,
} from '../../shared/validation';
import {
  createServiceOrder,
  updateServiceOrder,
  listServiceOrders,
  getServiceOrder,
  addServiceItem,
  removeServiceItem,
  addServicePayment,
  changeServiceStatus,
  serviceBoardCounts,
  serviceSummary,
} from '../services/service.service';
import { renderServiceDocument } from '../services/service-document.service';
import { getShopSettings } from '../services/settings.service';
import { printDocument, savePdf } from '../services/print.service';
import { recordAudit } from '../services/audit.service';
import { invoicesDir } from '../utils/paths';
import { requireUser } from '../session';

const zPrintServiceDocument = z.object({
  serviceOrderId: z.string().min(1).max(64),
  kind: z.enum(['JOB_SHEET', 'COMPLETION']).default('JOB_SHEET'),
  deviceName: z.string().max(200).optional(),
  silent: z.boolean().default(false),
  reprint: z.boolean().default(false),
  /** Write a PDF instead of printing. */
  asPdf: z.boolean().default(false),
});

export function registerServicesIpc(): void {
  handle(CHANNELS.services.list, { access: 'permission', permission: 'services.view' }, zServiceListQuery, (q) =>
    listServiceOrders(q),
  );

  handle(
    CHANNELS.services.get,
    { access: 'permission', permission: 'services.view' },
    zServiceOrderId,
    ({ serviceOrderId }) => getServiceOrder(serviceOrderId),
  );

  handle(CHANNELS.services.board, { access: 'permission', permission: 'services.view' }, zNoPayload, () =>
    serviceBoardCounts(),
  );

  handle(CHANNELS.services.summary, { access: 'permission', permission: 'services.view' }, zDayRange, (range) =>
    serviceSummary(range),
  );

  handle(
    CHANNELS.services.create,
    { access: 'permission', permission: 'services.manage' },
    zCreateServiceOrder,
    (input) => createServiceOrder(input, requireUser()),
  );

  handle(
    CHANNELS.services.update,
    { access: 'permission', permission: 'services.manage' },
    zUpdateServiceOrder,
    (input) => updateServiceOrder(input, requireUser()),
  );

  handle(
    CHANNELS.services.addItem,
    { access: 'permission', permission: 'services.manage' },
    zAddServiceItem,
    (input) => addServiceItem(input, requireUser()),
  );

  handle(
    CHANNELS.services.removeItem,
    { access: 'permission', permission: 'services.manage' },
    zIdOnly,
    ({ id }) => removeServiceItem(id, requireUser()),
  );

  handle(
    CHANNELS.services.addPayment,
    { access: 'permission', permission: 'services.manage' },
    zAddServicePayment,
    (input) => addServicePayment(input, requireUser()),
  );

  handle(
    CHANNELS.services.changeStatus,
    { access: 'permission', permission: 'services.manage' },
    zChangeServiceStatus,
    (input) => changeServiceStatus(input, requireUser()),
  );

  /** Job sheet or completion receipt — printed, or saved as a PDF. */
  handle(
    CHANNELS.services.printDocument,
    { access: 'permission', permission: 'services.view' },
    zPrintServiceDocument,
    async (input) => {
      const actor = requireUser();
      const settings = getShopSettings();
      const detail = getServiceOrder(input.serviceOrderId);

      const html = renderServiceDocument({
        detail,
        settings,
        kind: input.kind,
        reprint: input.reprint,
      });

      const label = input.kind === 'JOB_SHEET' ? 'job sheet' : 'completion receipt';

      if (input.asPdf) {
        const suffix = input.kind === 'JOB_SHEET' ? 'job-sheet' : 'completion';
        const target = path.join(invoicesDir(), `${detail.order.serviceNumber}-${suffix}.pdf`);
        await savePdf(html, target, { pageSize: 'A4' });

        recordAudit({
          userId: actor.id,
          action: 'EXPORT',
          entityName: 'ServiceOrder',
          entityId: detail.order.id,
          summary: `Saved ${label} for ${detail.order.serviceNumber} as PDF`,
        });

        return { printed: false as const, path: target };
      }

      await printDocument(html, {
        deviceName: input.deviceName || settings.defaultPrinter || undefined,
        silent: input.silent,
        pageSize: 'A4',
      });

      recordAudit({
        userId: actor.id,
        action: 'EXPORT',
        entityName: 'ServiceOrder',
        entityId: detail.order.id,
        summary: `${input.reprint ? 'Reprinted' : 'Printed'} ${label} for ${detail.order.serviceNumber}`,
      });

      return { printed: true as const, path: null };
    },
  );
}
