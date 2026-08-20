/**
 * Invoice and receipt documents (spec §37).
 *
 * Documents are plain self-contained HTML, rendered in a hidden window and then
 * either sent to a Windows printer or turned into a PDF. That keeps everything
 * offline, gives real typography and page breaks, and means the A4 invoice and
 * the thermal receipt share one source of truth for the figures.
 *
 * ALL interpolated shop data is escaped: a product called `Cable <b>` must print
 * as text, never as markup.
 */
import { formatMoney, decimalsFor } from '../../shared/money';
import { formatInstant } from '../../shared/datetime';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '../../shared/domain';
import type { ShopSettings } from '../../shared/settings';
import { LOGO_DATA_URI } from '../../shared/logo';
import type { SaleDetail } from './sale.service';

/** Escapes text for HTML. Applied to every value that comes from the database. */
function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type ReceiptWidth = '58mm' | '80mm';

interface DocumentContext {
  sale: SaleDetail;
  settings: ShopSettings;
  /** Marks a second or later printing, so nobody mistakes it for the original. */
  reprint?: boolean;
}

function money(minor: number, settings: ShopSettings): string {
  return formatMoney(minor, settings.currency);
}

function paymentLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method;
}

/** Shared reset. Printed output must not depend on any external resource. */
const BASE_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table { border-collapse: collapse; width: 100%; }
  .r { text-align: right; }
  .c { text-align: center; }
  .b { font-weight: 700; }
  .muted { color: #555; }
  .num { font-variant-numeric: tabular-nums; }
`;

// -----------------------------------------------------------------------------
// A4 invoice
// -----------------------------------------------------------------------------

/**
 * The shop logo for a document header (spec §35, §58).
 *
 * Falls back to the mark bundled with the application. `shopLogo` is the override
 * point for a shop that wants its own — it is read here so that wiring it up
 * later is a settings screen and nothing else. Whoever adds that screen will need
 * to raise the 20,000-character cap on a setting value first: a data URI for even
 * a small PNG does not fit.
 */
export function logoTag(settings: ShopSettings): string {
  // Only a data URI is accepted, and it is escaped like every other value that
  // comes from the database: an attribute is as injectable as a text node, and a
  // setting is not more trustworthy than a product name just because no screen
  // writes it yet.
  const source = settings.shopLogo.startsWith('data:image/') ? settings.shopLogo : LOGO_DATA_URI;
  // Decorative: the shop name is right beside it in text.
  return `<img src="${esc(source)}" alt="">`;
}

export function renderA4Invoice({ sale, settings, reprint }: DocumentContext): string {
  const { sale: header, items, payments } = sale;
  const decimals = decimalsFor(settings.currency);

  const itemRows = items
    .map(
      (item, index) => `
      <tr>
        <td class="c">${index + 1}</td>
        <td>
          ${esc(item.productName)}
          <div class="muted sku">${esc(item.sku)}${item.serials ? ` · IMEI ${esc(item.serials)}` : ''}</div>
        </td>
        <td class="c num">${item.quantity}</td>
        <td class="r num">${money(item.unitPrice, settings)}</td>
        <td class="r num">${item.discountAmount > 0 ? '-' + money(item.discountAmount, settings) : '—'}</td>
        <td class="r num">${item.taxAmount > 0 ? money(item.taxAmount, settings) : '—'}</td>
        <td class="r num b">${money(item.totalAmount, settings)}</td>
      </tr>`,
    )
    .join('');

  const paymentRows = payments
    .map(
      (payment) => `
      <tr>
        <td>${esc(paymentLabel(payment.paymentMethod))}${
          payment.referenceNumber ? ` <span class="muted">(${esc(payment.referenceNumber)})</span>` : ''
        }</td>
        <td class="r num">${money(payment.amount, settings)}</td>
      </tr>`,
    )
    .join('');

  const statusBanner =
    header.status === 'COMPLETED'
      ? ''
      : `<div class="banner">${esc(header.status.replace(/_/g, ' '))}</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Invoice ${esc(header.invoiceNumber)}</title>
<style>
  ${BASE_CSS}
  @page { size: A4; margin: 14mm 14mm 16mm; }
  body { font: 11pt/1.45 "Segoe UI", system-ui, sans-serif; color: #111; }

  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16mm; }

  /* Spec §35: the A4 invoice carries the shop logo. Inlined as a data URI, so a
     document rendered from a temp directory cannot lose it. */
  .brand { display: flex; align-items: flex-start; gap: 4mm; }
  .brand img { width: 18mm; height: 18mm; object-fit: contain; }

  .shop-name { font-size: 17pt; font-weight: 700; }
  .shop-meta { font-size: 9.5pt; color: #444; margin-top: 2mm; white-space: pre-line; }
  .doc-title { font-size: 20pt; font-weight: 700; letter-spacing: .5px; text-align: right; }
  .doc-meta { font-size: 9.5pt; margin-top: 3mm; text-align: right; }
  .doc-meta div { margin-bottom: 1mm; }

  .rule { border-top: 2px solid #111; margin: 6mm 0 5mm; }

  .parties { display: flex; gap: 12mm; margin-bottom: 6mm; }
  .party { flex: 1; }
  .party-label { font-size: 8pt; text-transform: uppercase; letter-spacing: .6px; color: #666; }
  .party-value { margin-top: 1mm; }

  thead th {
    font-size: 8.5pt; text-transform: uppercase; letter-spacing: .4px;
    border-bottom: 1.5px solid #111; padding: 2mm 1.5mm; text-align: left; color: #333;
  }
  tbody td { padding: 2.2mm 1.5mm; border-bottom: 1px solid #e0e0e0; vertical-align: top; }
  .sku { font-size: 8.5pt; margin-top: .6mm; }

  .totals { margin-top: 5mm; display: flex; justify-content: flex-end; }
  .totals table { width: 78mm; }
  .totals td { padding: 1.4mm 1.5mm; }
  .totals .grand td { border-top: 1.5px solid #111; font-size: 13pt; font-weight: 700; padding-top: 2.5mm; }

  .pay { margin-top: 6mm; display: flex; gap: 12mm; }
  .pay-box { flex: 1; }
  .pay-box h3 { font-size: 9pt; text-transform: uppercase; letter-spacing: .5px; color: #666; margin: 0 0 2mm; }
  .pay-box td { padding: 1.2mm 0; font-size: 10pt; }

  .notes { margin-top: 6mm; font-size: 9.5pt; }
  .foot { margin-top: 12mm; display: flex; justify-content: space-between; font-size: 9pt; color: #555; }
  .sign { width: 60mm; border-top: 1px solid #999; padding-top: 1.5mm; text-align: center; }

  .banner {
    margin: 4mm 0; padding: 2mm 3mm; border: 1.5px solid #b71c1c; color: #b71c1c;
    font-weight: 700; letter-spacing: 1px; text-align: center;
  }
  .reprint { font-size: 8.5pt; color: #b71c1c; font-weight: 700; }
</style>
</head>
<body>
  <div class="head">
    <div class="brand">
      ${logoTag(settings)}
      <div>
        <div class="shop-name">${esc(settings.shopName)}</div>
        <div class="shop-meta">${esc(
          [settings.shopAddress, settings.shopPhone && `Tel ${settings.shopPhone}`, settings.shopEmail]
            .filter(Boolean)
            .join('\n'),
        )}</div>
      </div>
    </div>
    <div>
      <div class="doc-title">INVOICE</div>
      <div class="doc-meta">
        <div><span class="muted">No.</span> <span class="b">${esc(header.invoiceNumber)}</span></div>
        <div><span class="muted">Date</span> ${esc(formatInstant(header.saleDate))}</div>
        <div><span class="muted">Cashier</span> ${esc(header.cashierName ?? '—')}</div>
        ${reprint ? '<div class="reprint">REPRINT</div>' : ''}
      </div>
    </div>
  </div>

  <div class="rule"></div>
  ${statusBanner}

  <div class="parties">
    <div class="party">
      <div class="party-label">Customer</div>
      <div class="party-value b">${esc(header.customerName)}</div>
      ${header.customerPhone ? `<div class="party-value">${esc(header.customerPhone)}</div>` : ''}
    </div>
    <div class="party">
      <div class="party-label">Payment status</div>
      <div class="party-value">${esc(header.paymentStatus.replace(/_/g, ' '))}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:8mm" class="c">#</th>
        <th>Description</th>
        <th style="width:14mm" class="c">Qty</th>
        <th style="width:26mm" class="r">Unit price</th>
        <th style="width:24mm" class="r">Discount</th>
        <th style="width:22mm" class="r">Tax</th>
        <th style="width:28mm" class="r">Amount</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals">
    <table>
      <tr><td>Subtotal</td><td class="r num">${money(header.subtotal, settings)}</td></tr>
      ${
        header.discountAmount > 0
          ? `<tr><td>Discount</td><td class="r num">-${money(header.discountAmount, settings)}</td></tr>`
          : ''
      }
      <tr><td>Tax</td><td class="r num">${money(header.taxAmount, settings)}</td></tr>
      <tr class="grand"><td>GRAND TOTAL</td><td class="r num">${money(header.grandTotal, settings)}</td></tr>
      ${
        header.refundedAmount > 0
          ? `<tr><td>Refunded</td><td class="r num">-${money(header.refundedAmount, settings)}</td></tr>`
          : ''
      }
    </table>
  </div>

  <div class="pay">
    <div class="pay-box">
      <h3>Payment</h3>
      <table>
        ${paymentRows || '<tr><td class="muted">No payment recorded</td><td></td></tr>'}
        <tr><td class="b">Amount received</td><td class="r num b">${money(header.amountPaid, settings)}</td></tr>
        ${
          header.changeAmount > 0
            ? `<tr><td>Change</td><td class="r num">${money(header.changeAmount, settings)}</td></tr>`
            : ''
        }
      </table>
    </div>
    <div class="pay-box">
      ${
        header.notes
          ? `<h3>Notes</h3><div class="notes">${esc(header.notes)}</div>`
          : ''
      }
    </div>
  </div>

  <div class="foot">
    <div>
      <div>Prices shown in ${esc(settings.currency)}${decimals === 0 ? ' (no decimals)' : ''}.</div>
      <div>Thank you for your business.</div>
    </div>
    <div class="sign">Received by</div>
  </div>
</body>
</html>`;
}

// -----------------------------------------------------------------------------
// Thermal receipt (58 mm / 80 mm)
// -----------------------------------------------------------------------------

/** Printable width inside the paper, allowing for the printer's margins. */
const RECEIPT_GEOMETRY: Record<ReceiptWidth, { paper: string; body: string; font: string }> = {
  '58mm': { paper: '58mm', body: '48mm', font: '8.5pt' },
  '80mm': { paper: '80mm', body: '72mm', font: '9.5pt' },
};

export function renderThermalReceipt({ sale, settings, reprint }: DocumentContext): string {
  const { sale: header, items, payments } = sale;
  const geometry = RECEIPT_GEOMETRY[settings.receiptWidth] ?? RECEIPT_GEOMETRY['80mm'];

  const itemRows = items
    .map(
      (item) => `
      <tr class="item">
        <td colspan="2">${esc(item.productName)}</td>
      </tr>
      ${item.serials ? `<tr><td colspan="2" class="serial">IMEI ${esc(item.serials)}</td></tr>` : ''}
      <tr>
        <td class="qty">${item.quantity} × ${money(item.unitPrice, settings)}${
          item.discountAmount > 0 ? ` <span class="disc">-${money(item.discountAmount, settings)}</span>` : ''
        }</td>
        <td class="r num b">${money(item.totalAmount, settings)}</td>
      </tr>`,
    )
    .join('');

  const paymentRows = payments
    .map(
      (payment) =>
        `<tr><td>${esc(paymentLabel(payment.paymentMethod))}</td><td class="r num">${money(
          payment.amount,
          settings,
        )}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Receipt ${esc(header.invoiceNumber)}</title>
<style>
  ${BASE_CSS}
  /* 'auto' height lets the roll cut at the end of the content. */
  @page { size: ${geometry.paper} auto; margin: 0; }
  body {
    width: ${geometry.body};
    margin: 0 auto;
    padding: 3mm 0 6mm;
    font: ${geometry.font}/1.35 "Consolas", "Courier New", monospace;
    color: #000;
  }
  .shop { text-align: center; }
  .shop-name { font-size: 11pt; font-weight: 700; }
  .shop-meta { font-size: 7.5pt; white-space: pre-line; margin-top: .8mm; }
  .sep { border-top: 1px dashed #000; margin: 2mm 0; }
  .meta td { font-size: 7.8pt; padding: .2mm 0; }
  .item td { padding-top: 1.2mm; font-weight: 600; }
  .qty { font-size: 8pt; }
  .serial { font-size: 7.2pt; }
  .disc { font-size: 7.2pt; }
  .grand td { font-size: 12pt; font-weight: 700; padding-top: 1.5mm; }
  .foot { text-align: center; margin-top: 3mm; font-size: 7.8pt; white-space: pre-line; }
  .reprint { text-align: center; font-weight: 700; margin-top: 1.5mm; }
  .status { text-align: center; font-weight: 700; border: 1px solid #000; padding: 1mm; margin: 2mm 0; }
</style>
</head>
<body>
  <div class="shop">
    <div class="shop-name">${esc(settings.shopName)}</div>
    <div class="shop-meta">${esc(
      [settings.shopAddress, settings.shopPhone && `Tel ${settings.shopPhone}`]
        .filter(Boolean)
        .join('\n'),
    )}</div>
  </div>

  <div class="sep"></div>

  <table class="meta">
    <tr><td>Invoice</td><td class="r">${esc(header.invoiceNumber)}</td></tr>
    <tr><td>Date</td><td class="r">${esc(formatInstant(header.saleDate))}</td></tr>
    <tr><td>Cashier</td><td class="r">${esc(header.cashierName ?? '—')}</td></tr>
    <tr><td>Customer</td><td class="r">${esc(header.customerName)}</td></tr>
    ${header.customerPhone ? `<tr><td>Phone</td><td class="r">${esc(header.customerPhone)}</td></tr>` : ''}
  </table>

  ${header.status !== 'COMPLETED' ? `<div class="status">${esc(header.status.replace(/_/g, ' '))}</div>` : ''}

  <div class="sep"></div>

  <table>${itemRows}</table>

  <div class="sep"></div>

  <table>
    <tr><td>Subtotal</td><td class="r num">${money(header.subtotal, settings)}</td></tr>
    ${
      header.discountAmount > 0
        ? `<tr><td>Discount</td><td class="r num">-${money(header.discountAmount, settings)}</td></tr>`
        : ''
    }
    ${
      header.taxAmount > 0
        ? `<tr><td>Tax</td><td class="r num">${money(header.taxAmount, settings)}</td></tr>`
        : ''
    }
    <tr class="grand"><td>TOTAL</td><td class="r num">${money(header.grandTotal, settings)}</td></tr>
  </table>

  <div class="sep"></div>

  <table>
    ${paymentRows}
    <tr><td>Received</td><td class="r num">${money(header.amountPaid, settings)}</td></tr>
    ${
      header.changeAmount > 0
        ? `<tr><td class="b">Change</td><td class="r num b">${money(header.changeAmount, settings)}</td></tr>`
        : ''
    }
  </table>

  ${reprint ? '<div class="reprint">*** REPRINT ***</div>' : ''}

  <div class="foot">${esc(settings.receiptFooter)}</div>
</body>
</html>`;
}

/** Page geometry for Electron's print/printToPDF, in microns. */
export function receiptPageSize(width: ReceiptWidth): { width: number; height: number } {
  // Height is generous; the roll printer cuts at the end of the content.
  return width === '58mm'
    ? { width: 58_000, height: 297_000 }
    : { width: 80_000, height: 297_000 };
}
