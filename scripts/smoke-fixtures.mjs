/**
 * Files the in-app smoke test expects to find on disk before it starts.
 *
 * Written from Node rather than from the application, so the shipped code
 * carries no test-only file-writing path. The renderer locates them from the
 * userDataDir that app.getInfo() reports.
 *
 * Used by both scripts/smoke.mjs and scripts/screenshot.mjs — the screenshot
 * run drives the same script, so it needs the same fixtures.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Three rows: two importable, one missing its SKU so the preview has a refusal. */
const PRODUCT_IMPORT_CSV = [
  'SKU,Barcode,Product Name,Category,Brand,Purchase Price,Selling Price,Stock,Minimum Stock',
  'SMOKE-IMP-1,,Imported Screen Protector,Screen Protectors,Generic,20,60,40,5',
  'SMOKE-IMP-2,,Imported Car Charger,Chargers,Generic,90,220,15,3',
  ',,Row with no SKU,,,10,20,1,0',
  '',
].join('\r\n');

export function writeSmokeFixtures(userDataDir) {
  const target = path.join(userDataDir, 'exports', 'smoke-import.csv');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, PRODUCT_IMPORT_CSV, 'utf8');
  return { productImportCsv: target };
}
