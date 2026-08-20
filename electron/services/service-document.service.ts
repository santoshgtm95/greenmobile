/**
 * Printable service documents (spec §93).
 *
 * An offline shop cannot text a customer, so the paper trail is the whole
 * notification mechanism:
 *
 *   JOB SHEET  — given to the customer when the device is taken in. It is the
 *                receipt for their handset, so it records the fault, the state
 *                the device arrived in, the estimate and any deposit.
 *   COMPLETION — given when the device is collected: what was done, the parts
 *                and labour, what was paid and what (if anything) is owed.
 *
 * Both fit the shop's thermal roll as well as A4, so they can be printed on
 * whichever printer is at the counter.
 */
import { formatMoney } from '../../shared/money';
import { formatInstant } from '../../shared/datetime';
import { PAYMENT_METHOD_LABELS, SERVICE_STATUS_LABELS, type PaymentMethod } from '../../shared/domain';
import type { ShopSettings } from '../../shared/settings';
import type { ServiceOrderDetail } from './service.service';
// Same header treatment as the invoice, so the two documents match.
import { logoTag } from './document.service';

function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type ServiceDocumentKind = 'JOB_SHEET' | 'COMPLETION';

interface Context {
  detail: ServiceOrderDetail;
  settings: ShopSettings;
  kind: ServiceDocumentKind;
  reprint?: boolean;
}

function money(minor: number, settings: ShopSettings): string {
  return formatMoney(minor, settings.currency);
}

export function renderServiceDocument({ detail, settings, kind, reprint }: Context): string {
  const { order, items, payments } = detail;
  const isJobSheet = kind === 'JOB_SHEET';

  const parts = items.filter((i) => i.type === 'PART');
  const labour = items.filter((i) => i.type !== 'PART');

  const itemRows = (list: typeof items) =>
    list
      .map(
        (item) => `
        <tr>
          <td>${esc(item.description)}</td>
          <td class="c">${item.quantity}</td>
          <td class="r num">${money(item.sellingPrice, settings)}</td>
          <td class="r num b">${money(item.total, settings)}</td>
        </tr>`,
      )
      .join('');

  const paymentRows = payments
    .map(
      (payment) => `
      <tr>
        <td>${esc(formatInstant(payment.paymentDate))}</td>
        <td>${esc(PAYMENT_METHOD_LABELS[payment.paymentMethod as PaymentMethod] ?? payment.paymentMethod)}${
          payment.isDeposit ? ' <span class="muted">(deposit)</span>' : ''
        }</td>
        <td class="r num">${money(payment.amount, settings)}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${isJobSheet ? 'Service Job Sheet' : 'Service Completion'} ${esc(order.serviceNumber)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font: 11pt/1.45 "Segoe UI", system-ui, sans-serif;
    color: #111;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  @page { size: A4; margin: 14mm; }
  table { border-collapse: collapse; width: 100%; }
  .r { text-align: right; } .c { text-align: center; } .b { font-weight: 700; }
  .muted { color: #555; } .num { font-variant-numeric: tabular-nums; }

  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14mm; }

  /* Matches the invoice header. Slightly smaller, because a job sheet has more
     to fit above the fold. */
  .brand { display: flex; align-items: flex-start; gap: 3.5mm; }
  .brand img { width: 16mm; height: 16mm; object-fit: contain; }

  .shop-name { font-size: 16pt; font-weight: 700; }
  .shop-meta { font-size: 9.5pt; color: #444; white-space: pre-line; margin-top: 1.5mm; }
  .doc-title { font-size: 17pt; font-weight: 700; text-align: right; }
  .doc-meta { font-size: 9.5pt; text-align: right; margin-top: 2.5mm; }
  .rule { border-top: 2px solid #111; margin: 5mm 0; }

  .grid { display: grid; grid-template-columns: 34mm 1fr 30mm 1fr; gap: 2mm 4mm; font-size: 10pt; }
  .label { color: #666; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .4px; }

  h3 { font-size: 9.5pt; text-transform: uppercase; letter-spacing: .5px; color: #555;
       margin: 6mm 0 2mm; }
  .box { border: 1px solid #ccc; border-radius: 1.5mm; padding: 3mm; font-size: 10pt;
         white-space: pre-line; min-height: 12mm; }

  thead th { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .4px; color: #333;
             border-bottom: 1.5px solid #111; padding: 2mm 1.5mm; text-align: left; }
  tbody td { padding: 2mm 1.5mm; border-bottom: 1px solid #e0e0e0; }

  .totals { margin-top: 4mm; display: flex; justify-content: flex-end; }
  .totals table { width: 82mm; }
  .totals td { padding: 1.3mm 1.5mm; }
  .totals .grand td { border-top: 1.5px solid #111; font-size: 12.5pt; font-weight: 700; }
  .owing td { color: #b71c1c; font-weight: 700; }

  .terms { margin-top: 7mm; font-size: 8.5pt; color: #444; line-height: 1.5; }
  .signs { margin-top: 12mm; display: flex; justify-content: space-between; gap: 20mm; }
  .sign { flex: 1; border-top: 1px solid #999; padding-top: 1.5mm; font-size: 9pt;
          text-align: center; color: #555; }
  .reprint { color: #b71c1c; font-weight: 700; font-size: 8.5pt; }
  .status { display: inline-block; border: 1.5px solid #111; padding: 1mm 3mm;
            font-weight: 700; font-size: 9.5pt; }
</style>
</head>
<body>
  <div class="head">
    <div class="brand">
      ${logoTag(settings)}
      <div>
        <div class="shop-name">${esc(settings.shopName)}</div>
        <div class="shop-meta">${esc(
          [settings.shopAddress, settings.shopPhone && `Tel ${settings.shopPhone}`]
            .filter(Boolean)
            .join('\n'),
        )}</div>
      </div>
    </div>
    <div>
      <div class="doc-title">${isJobSheet ? 'SERVICE JOB SHEET' : 'SERVICE COMPLETION'}</div>
      <div class="doc-meta">
        <div><span class="muted">No.</span> <span class="b">${esc(order.serviceNumber)}</span></div>
        <div><span class="muted">Received</span> ${esc(formatInstant(order.receivedDate))}</div>
        ${
          order.deliveredDate
            ? `<div><span class="muted">Delivered</span> ${esc(formatInstant(order.deliveredDate))}</div>`
            : ''
        }
        ${reprint ? '<div class="reprint">REPRINT</div>' : ''}
      </div>
    </div>
  </div>

  <div class="rule"></div>

  <div class="grid">
    <div class="label">Customer</div>
    <div class="b">${esc(order.customerName)}</div>
    <div class="label">Phone</div>
    <div>${esc(order.customerPhone ?? '—')}</div>

    <div class="label">Device</div>
    <div class="b">${esc(order.deviceBrand)} ${esc(order.deviceModel)}</div>
    <div class="label">Status</div>
    <div><span class="status">${esc(SERVICE_STATUS_LABELS[order.status])}</span></div>

    <div class="label">IMEI</div>
    <div>${esc(order.imei ?? '—')}</div>
    <div class="label">Serial</div>
    <div>${esc(order.serialNumber ?? '—')}</div>

    ${
      isJobSheet
        ? `<div class="label">Est. cost</div>
           <div class="b">${money(order.estimatedCost, settings)}</div>
           <div class="label">Expected</div>
           <div>${esc(order.expectedDate ? formatInstant(order.expectedDate) : 'To be advised')}</div>`
        : ''
    }
  </div>

  <h3>Reported fault</h3>
  <div class="box">${esc(order.problemDescription)}</div>

  ${
    order.initialCondition
      ? `<h3>Condition on arrival</h3><div class="box">${esc(order.initialCondition)}</div>`
      : ''
  }

  ${
    order.diagnosis
      ? `<h3>Diagnosis${isJobSheet ? '' : ' and work carried out'}</h3><div class="box">${esc(order.diagnosis)}</div>`
      : ''
  }

  ${
    !isJobSheet && parts.length > 0
      ? `<h3>Parts</h3>
         <table>
           <thead><tr><th>Item</th><th class="c" style="width:14mm">Qty</th>
             <th class="r" style="width:26mm">Price</th><th class="r" style="width:28mm">Amount</th></tr></thead>
           <tbody>${itemRows(parts)}</tbody>
         </table>`
      : ''
  }

  ${
    !isJobSheet && labour.length > 0
      ? `<h3>Labour and other charges</h3>
         <table>
           <thead><tr><th>Item</th><th class="c" style="width:14mm">Qty</th>
             <th class="r" style="width:26mm">Price</th><th class="r" style="width:28mm">Amount</th></tr></thead>
           <tbody>${itemRows(labour)}</tbody>
         </table>`
      : ''
  }

  ${
    !isJobSheet
      ? `<div class="totals">
           <table>
             <tr><td>Total charge</td><td class="r num">${money(order.finalCost, settings)}</td></tr>
             ${
               payments.length > 0
                 ? `<tr><td>Paid${
                     order.depositAmount > 0
                       ? ` <span class="muted">(incl. deposit ${money(order.depositAmount, settings)})</span>`
                       : ''
                   }</td><td class="r num">${money(order.amountPaid, settings)}</td></tr>`
                 : ''
             }
             ${
               order.balance > 0
                 ? `<tr class="owing"><td>STILL OWING</td><td class="r num">${money(order.balance, settings)}</td></tr>`
                 : `<tr class="grand"><td>PAID IN FULL</td><td class="r num">${money(order.finalCost, settings)}</td></tr>`
             }
           </table>
         </div>`
      : order.depositAmount > 0
        ? `<div class="totals">
             <table>
               <tr class="grand"><td>Deposit received</td>
                 <td class="r num">${money(order.depositAmount, settings)}</td></tr>
             </table>
           </div>`
        : ''
  }

  ${
    !isJobSheet && payments.length > 0
      ? `<h3>Payments</h3>
         <table>
           <thead><tr><th>Date</th><th>Method</th><th class="r" style="width:30mm">Amount</th></tr></thead>
           <tbody>${paymentRows}</tbody>
         </table>`
      : ''
  }

  <div class="terms">
    ${
      isJobSheet
        ? `Please keep this job sheet — it is your receipt for the device and will be
           asked for on collection. Any estimate given is subject to change once the
           fault has been diagnosed; we will contact you for approval before
           exceeding it. Devices not collected within 90 days of notification may be
           subject to storage charges.`
        : `Repairs are guaranteed against a recurrence of the same fault for 30 days
           from collection. The guarantee does not cover accidental damage, liquid
           damage, or a different fault arising later. Please check the device before
           leaving the shop.`
    }
  </div>

  <div class="signs">
    <div class="sign">${isJobSheet ? 'Received by (shop)' : 'Released by (shop)'}</div>
    <div class="sign">${isJobSheet ? 'Customer signature' : 'Collected by (customer)'}</div>
  </div>
</body>
</html>`;
}
