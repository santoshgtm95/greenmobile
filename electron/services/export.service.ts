/**
 * Report output: Excel, CSV, PDF and print (spec §56, §90).
 *
 * All four read the same Report structure, so a report is described once and
 * every format follows. Nothing here touches the network.
 *
 * MONEY IN SPREADSHEETS
 *
 * Money is stored as integer minor units. Excel and CSV receive real NUMBERS in
 * major units with a currency format applied — never a pre-formatted string.
 * A spreadsheet full of text that looks like money cannot be summed, which
 * defeats the point of exporting it.
 */
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { toMajor, decimalsFor } from "../../shared/money";
import {
  formatBusinessDay,
  formatInstant,
  nowInstant,
} from "../../shared/datetime";
import type {
  CellValue,
  ColumnType,
  Report,
  ReportTable,
} from "../../shared/report";
import { logger } from "../utils/logger";

/** Excel number formats per column type, built for the shop's currency. */
function excelFormat(type: ColumnType, currency: string): string | undefined {
  const decimals = decimalsFor(currency);
  switch (type) {
    case "money":
      return decimals === 0 ? "#,##0" : "#,##0.00";
    case "number":
      return "#,##0";
    case "percent":
      return '0.0"%"';
    default:
      return undefined;
  }
}

/** Converts a stored cell into the value the target format should hold. */
function cellForExport(
  value: CellValue,
  type: ColumnType,
): string | number | null {
  if (value === null || value === undefined) return null;
  switch (type) {
    case "money":
      return typeof value === "number" ? toMajor(value) : value;
    case "day":
      return typeof value === "string" ? formatBusinessDay(value) : value;
    case "instant":
      return typeof value === "string" ? formatInstant(value) : value;
    default:
      return value;
  }
}

// -----------------------------------------------------------------------------
// Excel
// -----------------------------------------------------------------------------

export async function reportToXlsx(
  report: Report,
  targetPath: string,
): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Green Mobile";
  workbook.created = new Date();

  const summary = workbook.addWorksheet("Summary");
  summary.columns = [
    { header: "Figure", key: "label", width: 34 },
    { header: "Value", key: "value", width: 20 },
  ];
  summary.getRow(1).font = { bold: true };

  summary.addRow({ label: report.title, value: "" }).font = {
    bold: true,
    size: 13,
  };
  summary.addRow({ label: "Period", value: report.periodLabel });
  summary.addRow({ label: "Currency", value: report.currency });
  summary.addRow({ label: "", value: "" });

  for (const figure of report.figures) {
    const row = summary.addRow({
      label: figure.label,
      value:
        figure.type === "money" && typeof figure.value === "number"
          ? toMajor(figure.value)
          : figure.value,
    });
    const format = excelFormat(figure.type, report.currency);
    if (format) row.getCell("value").numFmt = format;
    if (figure.emphasis) row.font = { bold: true };
  }

  for (const table of report.tables) {
    // Excel sheet names cannot exceed 31 characters or contain : \ / ? * [ ]
    const name = table.title.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);
    const sheet = workbook.addWorksheet(name || "Table");

    sheet.columns = table.columns.map((column) => ({
      header: column.label,
      key: column.key,
      width: column.width ?? 16,
    }));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    for (const row of table.rows) {
      const values: Record<string, string | number | null> = {};
      for (const column of table.columns) {
        values[column.key] = cellForExport(
          row[column.key] ?? null,
          column.type,
        );
      }
      const added = sheet.addRow(values);
      for (const column of table.columns) {
        const format = excelFormat(column.type, report.currency);
        if (format) added.getCell(column.key).numFmt = format;
      }
    }

    if (table.totals) {
      const values: Record<string, string | number | null> = {};
      let labelled = false;
      for (const column of table.columns) {
        const total = table.totals[column.key];
        if (total !== undefined) {
          values[column.key] = column.type === "money" ? toMajor(total) : total;
        } else if (!labelled) {
          values[column.key] = "Total";
          labelled = true;
        }
      }
      const totalRow = sheet.addRow(values);
      totalRow.font = { bold: true };
      totalRow.border = { top: { style: "thin" } };
      for (const column of table.columns) {
        const format = excelFormat(column.type, report.currency);
        if (format) totalRow.getCell(column.key).numFmt = format;
      }
    }
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  await workbook.xlsx.writeFile(targetPath);
  logger.info("Report exported to Excel", {
    targetPath,
    tables: report.tables.length,
  });
  return targetPath;
}

// -----------------------------------------------------------------------------
// CSV
// -----------------------------------------------------------------------------

function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // Quote when the value could otherwise break the row or be misread.
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * One file containing every table, separated by a blank line and a heading.
 * A single CSV keeps the export to one artefact the shop can email or archive.
 */
export function reportToCsv(report: Report, targetPath: string): string {
  const lines: string[] = [];

  lines.push(csvCell(report.title));
  lines.push(`${csvCell("Period")},${csvCell(report.periodLabel)}`);
  lines.push(`${csvCell("Currency")},${csvCell(report.currency)}`);
  lines.push("");

  for (const figure of report.figures) {
    const value =
      figure.type === "money" && typeof figure.value === "number"
        ? toMajor(figure.value)
        : figure.value;
    lines.push(`${csvCell(figure.label)},${csvCell(value)}`);
  }

  for (const table of report.tables) {
    lines.push("");
    lines.push(csvCell(table.title));
    lines.push(table.columns.map((column) => csvCell(column.label)).join(","));

    for (const row of table.rows) {
      lines.push(
        table.columns
          .map((column) =>
            csvCell(cellForExport(row[column.key] ?? null, column.type)),
          )
          .join(","),
      );
    }

    if (table.totals) {
      lines.push(
        table.columns
          .map((column, index) => {
            const total = table.totals?.[column.key];
            if (total !== undefined) {
              return csvCell(column.type === "money" ? toMajor(total) : total);
            }
            return index === 0 ? csvCell("Total") : "";
          })
          .join(","),
      );
    }
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  // A BOM so Excel opens UTF-8 CSV without mangling non-ASCII shop names.
  fs.writeFileSync(targetPath, "﻿" + lines.join("\r\n"), "utf8");
  logger.info("Report exported to CSV", { targetPath });
  return targetPath;
}

// -----------------------------------------------------------------------------
// Printable / PDF document
// -----------------------------------------------------------------------------

function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Formats a cell for the printed page, where strings are what we want. */
function cellForPrint(
  value: CellValue,
  type: ColumnType,
  currency: string,
): string {
  if (value === null || value === undefined || value === "")
    return type === "text" ? "" : "—";
  switch (type) {
    case "money": {
      if (typeof value !== "number") return esc(value);
      const decimals = decimalsFor(currency);
      return toMajor(value).toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    }
    case "number":
      return typeof value === "number"
        ? value.toLocaleString("en-US")
        : esc(value);
    case "percent":
      return typeof value === "number" ? `${value}%` : esc(value);
    case "day":
      return esc(formatBusinessDay(String(value)));
    case "instant":
      return esc(formatInstant(String(value)));
    default:
      return esc(value);
  }
}

const NUMERIC_TYPES: ColumnType[] = ["money", "number", "percent"];

function renderTable(table: ReportTable, currency: string): string {
  if (table.rows.length === 0) {
    return `
      <section class="table">
        <h2>${esc(table.title)}</h2>
        ${table.subtitle ? `<p class="sub">${esc(table.subtitle)}</p>` : ""}
        <p class="empty">${esc(table.emptyMessage ?? "Nothing to report.")}</p>
      </section>`;
  }

  const head = table.columns
    .map(
      (column) =>
        `<th class="${NUMERIC_TYPES.includes(column.type) ? "r" : ""}">${esc(column.label)}</th>`,
    )
    .join("");

  const body = table.rows
    .map((row) => {
      const cells = table.columns
        .map((column) => {
          const numeric = NUMERIC_TYPES.includes(column.type);
          return `<td class="${numeric ? "r num" : ""}">${cellForPrint(
            row[column.key] ?? null,
            column.type,
            currency,
          )}</td>`;
        })
        .join("");
      // A blank leading cell marks a spacer row in the P&L statement.
      const isSpacer = table.columns.every((column) => {
        const value = row[column.key];
        return value === null || value === undefined || value === "";
      });
      return `<tr class="${isSpacer ? "spacer" : ""}">${cells}</tr>`;
    })
    .join("");

  const totals = table.totals
    ? `<tfoot><tr>${table.columns
        .map((column, index) => {
          const total = table.totals?.[column.key];
          const numeric = NUMERIC_TYPES.includes(column.type);
          if (total !== undefined) {
            return `<td class="${numeric ? "r num" : ""}">${cellForPrint(total, column.type, currency)}</td>`;
          }
          return `<td>${index === 0 ? "Total" : ""}</td>`;
        })
        .join("")}</tr></tfoot>`
    : "";

  return `
    <section class="table">
      <h2>${esc(table.title)}</h2>
      ${table.subtitle ? `<p class="sub">${esc(table.subtitle)}</p>` : ""}
      <table>
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
        ${totals}
      </table>
    </section>`;
}

/**
 * A printable report (spec §90).
 *
 * Long tables break across pages with the header repeated, which is what makes
 * a multi-page stock valuation readable on paper.
 */
export function reportToHtml(report: Report, shopName: string): string {
  const figures = report.figures
    .map(
      (figure) => `
      <div class="figure ${figure.emphasis ? "emphasis" : ""}">
        <div class="figure-label">${esc(figure.label)}</div>
        <div class="figure-value">${cellForPrint(
          typeof figure.value === "number"
            ? figure.value
            : String(figure.value),
          figure.type,
          report.currency,
        )}</div>
        ${figure.hint ? `<div class="figure-hint">${esc(figure.hint)}</div>` : ""}
      </div>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(report.title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font: 10.5pt/1.45 "Segoe UI", system-ui, sans-serif;
    color: #111;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  @page { size: A4; margin: 13mm; }

  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12mm;
          border-bottom: 2px solid #111; padding-bottom: 4mm; margin-bottom: 5mm; }
  .shop { font-size: 15pt; font-weight: 700; }
  .doc-title { font-size: 15pt; font-weight: 700; text-align: right; }
  .doc-meta { font-size: 9pt; color: #555; text-align: right; margin-top: 1.5mm; }

  .figures { display: flex; flex-wrap: wrap; gap: 3mm; margin-bottom: 6mm; }
  .figure { border: 1px solid #ddd; border-radius: 1.5mm; padding: 2.5mm 3.5mm; min-width: 38mm; }
  .figure.emphasis { border-color: #111; border-width: 1.5px; }
  .figure-label { font-size: 7.8pt; text-transform: uppercase; letter-spacing: .4px; color: #666; }
  .figure-value { font-size: 13pt; font-weight: 700; margin-top: .8mm;
                  font-variant-numeric: tabular-nums; }
  .figure-hint { font-size: 7.5pt; color: #777; margin-top: .5mm; }

  .table { margin-bottom: 7mm; break-inside: auto; }
  .table h2 { font-size: 10.5pt; margin: 0 0 1mm; text-transform: uppercase;
              letter-spacing: .5px; color: #333; }
  .table .sub { font-size: 8.5pt; color: #666; margin: 0 0 2mm; }
  .table .empty { font-size: 9pt; color: #777; font-style: italic; margin: 0; }

  table { border-collapse: collapse; width: 100%; }
  /* Repeat the header on every page a long table spills onto. */
  thead { display: table-header-group; }
  tfoot { display: table-row-group; }
  th { font-size: 8pt; text-transform: uppercase; letter-spacing: .3px; color: #333;
       border-bottom: 1.2px solid #111; padding: 1.6mm 1.4mm; text-align: left; }
  td { padding: 1.5mm 1.4mm; border-bottom: 1px solid #e8e8e8; }
  tr { break-inside: avoid; }
  tr.spacer td { border-bottom: none; height: 2mm; padding: 0; }
  tfoot td { font-weight: 700; border-top: 1.2px solid #111; border-bottom: none; }
  .r { text-align: right; }
  .num { font-variant-numeric: tabular-nums; }

  .foot { margin-top: 8mm; padding-top: 3mm; border-top: 1px solid #ddd;
          font-size: 8pt; color: #666; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <div class="shop">${esc(shopName)}</div>
      <div class="doc-meta" style="text-align:left">${esc(report.periodLabel)}</div>
    </div>
    <div>
      <div class="doc-title">${esc(report.title.toUpperCase())}</div>
      <div class="doc-meta">
        <div>Generated ${esc(formatInstant(nowInstant()))}</div>
        <div>Amounts in ${esc(report.currency)}</div>
      </div>
    </div>
  </div>

  <div class="figures">${figures}</div>

  ${report.tables.map((table) => renderTable(table, report.currency)).join("")}

  <div class="foot">
    <span>${esc(report.title)} · ${esc(report.periodLabel)}</span>
    <span>${esc(shopName)}</span>
  </div>
</body>
</html>`;
}

/** Filename stem for an exported report, safe on Windows. */
export function reportFileStem(report: Report): string {
  const kind = report.kind.toLowerCase().replace(/_/g, "-");
  return `${kind}-report_${report.range.from}_to_${report.range.to}`;
}
