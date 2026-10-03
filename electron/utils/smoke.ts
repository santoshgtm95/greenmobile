/**
 * Build-verification hook, enabled only when POS_SMOKE=1.
 *
 * Launches the real window against a throwaway data directory and drives the
 * live contextBridge exactly as the UI does: first-run setup, sign out, sign in,
 * a rejected bad password, and a permission check. This proves the packaged
 * wiring works end to end in a headless environment, where nobody can look at
 * the screen.
 */
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger';
import { CHANNELS } from '../../shared/channels';

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

export function runSmokeTest(win: BrowserWindow): void {
  const finish = (checks: Check[], fatal?: string) => {
    for (const check of checks) {
      console.log(`[smoke] ${check.pass ? 'ok  ' : 'FAIL'} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
    }
    if (fatal) console.error(`[smoke] FAIL ${fatal}`);
    const failed = checks.filter((c) => !c.pass).length;
    const ok = !fatal && failed === 0 && checks.length > 0;
    console.log(`[smoke] ${ok ? 'PASS' : 'FAILED'} — ${checks.length - failed}/${checks.length} checks passed`);
    if (!ok) logger.error('Smoke test failed', { failed, fatal });
    app.exit(ok ? 0 : 1);
  };

  const timeout = setTimeout(() => finish([], 'renderer did not report within 60s'), 60_000);

  win.webContents.once('did-fail-load', (_e, code, desc) => {
    clearTimeout(timeout);
    finish([], `renderer failed to load (${code} ${desc})`);
  });

  win.webContents.once('did-finish-load', () => {
    void (async () => {
      let checks: Check[];
      try {
        checks = (await win.webContents.executeJavaScript(SCRIPT)) as Check[];
      } catch (err) {
        clearTimeout(timeout);
        finish([], `executeJavaScript threw: ${String(err)}`);
        return;
      }
      clearTimeout(timeout);

      checks.push(await proveSessionBlocksNetwork());

      // Optional: capture what the seeded UI actually looks like. The palette
      // validator checks colour, not layout — only a real render shows label
      // collisions, clipped axes and overflow.
      //
      // Reported as its own check rather than as a fatal: a screenshot problem
      // must never discard the verification results that already passed, which
      // is exactly what an earlier version of this did.
      if (process.env.POS_SCREENSHOT) {
        // The loop reloads deliberately, so the startup did-fail-load guard
        // would otherwise fire on our own navigation.
        win.webContents.removeAllListeners('did-fail-load');
        try {
          checks.push(...(await captureScreens(win, process.env.POS_SCREENSHOT)));
          checks.push({ name: 'screenshots captured', pass: true });
        } catch (err) {
          checks.push({
            name: 'screenshots captured',
            pass: false,
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      }

      finish(checks);
    })();
  });
}

/**
 * Proves the *session* refuses network requests (spec §4, §83).
 *
 * The renderer's own checks cannot show this. The application's page carries a
 * Content-Security-Policy of `connect-src 'self'`, so a fetch from React is
 * refused by the CSP before the network layer ever sees it — which is the right
 * outcome, and the reason there are two layers, but it means those checks prove
 * the outer layer only.
 *
 * So this probes from outside any page: a bare window with no CSP navigating to a
 * public host. That request reaches the session, is denied by onBeforeRequest, and
 * increments the counter — which is what distinguishes "this application refuses
 * to reach out" from "this machine happened to have no internet".
 */
async function proveSessionBlocksNetwork(): Promise<Check> {
  const { blockedRequestCount } = await import('../security');
  const before = blockedRequestCount();

  const probe = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, javascript: false, offscreen: true },
  });

  let reached = false;
  try {
    await probe.loadURL('https://example.com/');
    reached = true;
  } catch {
    // ERR_BLOCKED_BY_CLIENT — exactly what should happen.
  } finally {
    if (!probe.isDestroyed()) probe.destroy();
  }

  const blocked = blockedRequestCount() - before;
  return {
    name: 'session refuses a request made outside any page CSP',
    pass: !reached && blocked >= 1,
    detail: reached ? 'the request went through' : `${blocked} refused by the session`,
  };
}

/**
 * Reloads the renderer so React picks up the now-seeded, signed-in state, then
 * photographs each screen.
 *
 * Returns checks for the dialogs it opens, because a dialog is only worth
 * photographing if it actually opened — otherwise the file quietly contains the
 * page behind it and the next person reviewing the screenshots believes the
 * modal is fine.
 */
async function captureScreens(win: BrowserWindow, outDir: string): Promise<Check[]> {
  fs.mkdirSync(outDir, { recursive: true });
  const checks: Check[] = [];

  // capturePage photographs the viewport, so the window itself has to be tall
  // enough. A maximised window ignores setSize, hence the unmaximize first.
  win.unmaximize();
  win.setSize(1500, 1900);

  const screens: Array<{ name: string; hash: string }> = [
    { name: 'dashboard', hash: '#/' },
    { name: 'pos', hash: '#/pos' },
    { name: 'products', hash: '#/products' },
    { name: 'sales', hash: '#/sales' },
    { name: 'services', hash: '#/services' },
    { name: 'expenses', hash: '#/expenses' },
    { name: 'banking', hash: '#/banking' },
    { name: 'customers', hash: '#/customers' },
    { name: 'inventory', hash: '#/inventory' },
    { name: 'inventory-movements', hash: '#/inventory/movements' },
    { name: 'reports', hash: '#/reports' },
    { name: 'users', hash: '#/users' },
    { name: 'settings-shop', hash: '#/settings/shop' },
    { name: 'settings-money', hash: '#/settings/money' },
    { name: 'settings-printing', hash: '#/settings/printing' },
    { name: 'settings-documents', hash: '#/settings/documents' },
    { name: 'settings-backup', hash: '#/settings/backup' },
  ];

  for (const screen of screens) {
    await win.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(screen.hash)}`);
    await win.webContents.reload();
    await new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()));
    // Let the queries resolve and the charts lay out before photographing.
    await new Promise((resolve) => setTimeout(resolve, 1800));

    const image = await win.webContents.capturePage();
    const file = path.join(outDir, `${screen.name}.png`);
    fs.writeFileSync(file, image.toPNG());
    console.log(`[smoke] screenshot ${screen.name} -> ${file}`);
  }

  /*
    The Banking dialogs (spec: the new-transaction modal, and the account
    registry). Both are the point of the screen rather than decoration, and a
    modal is the one thing a page screenshot cannot show — the clipped
    date-and-time control and the wrapped key hint were both found this way and
    would not have failed any assertion.

    Each is opened by its button and then CONFIRMED open, so a renamed button
    turns into a failing check instead of a screenshot of the page behind it.
  */
  for (const dialog of [
    { name: 'banking-new-transaction', button: 'New Transaction', title: 'New transaction' },
    { name: 'banking-accounts', button: 'Banks & Payments', title: 'Banks and mobile payments' },
  ]) {
    await win.webContents.executeJavaScript(`window.location.hash = '#/banking'`);
    await win.webContents.reload();
    await new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 1600));

    const opened = (await win.webContents.executeJavaScript(
      `(() => {
         const button = [...document.querySelectorAll('button')]
           .find((b) => b.textContent.includes(${JSON.stringify(dialog.button)}));
         if (!button) return 'no button';
         button.click();
         return 'clicked';
       })()`,
    )) as string;
    await new Promise((resolve) => setTimeout(resolve, 900));

    const title = (await win.webContents.executeJavaScript(
      `document.querySelector('[role="dialog"]')?.textContent ?? ''`,
    )) as string;

    checks.push({
      name: `${dialog.name} dialog opens`,
      pass: opened === 'clicked' && title.includes(dialog.title),
      detail: opened === 'clicked' ? undefined : opened,
    });

    const shot = await win.webContents.capturePage();
    const file = path.join(outDir, `${dialog.name}.png`);
    fs.writeFileSync(file, shot.toPNG());
    console.log(`[smoke] screenshot ${dialog.name} -> ${file}`);
  }

  /*
    The new-transaction form with figures actually typed into it.

    The empty dialog above shows that the boxes exist; it cannot show that they
    calculate. This fills in the shop's own example — 1,000,000 at 0.5% — and
    reads the two derived boxes back out of the DOM, so "Fees" and "Actual
    amount" are asserted through the real React component rather than trusted
    because the arithmetic is unit-tested somewhere else.

    Both directions are checked from the one filled form, because the difference
    between them IS the feature: the same fee added when it is received and
    subtracted when it is paid.
  */
  await win.webContents.executeJavaScript(`window.location.hash = '#/banking'`);
  await win.webContents.reload();
  await new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()));
  await new Promise((resolve) => setTimeout(resolve, 1600));

  const filled = (await win.webContents.executeJavaScript(
    `(async () => {
       const wait = (ms) => new Promise((r) => setTimeout(r, ms));
       const open = [...document.querySelectorAll('button')]
         .find((b) => b.textContent.includes('New Transaction'));
       if (!open) return { error: 'no New Transaction button' };
       open.click();
       await wait(700);

       const dialog = document.querySelector('[role="dialog"]');
       if (!dialog) return { error: 'dialog did not open' };

       // React tracks the previous value on the DOM node, so assigning .value
       // directly is swallowed. The native setter is what a real keystroke goes
       // through, which is why this is not just input.value = x.
       const setter = Object.getOwnPropertyDescriptor(
         window.HTMLInputElement.prototype, 'value').set;
       const field = (label) => {
         const found = [...dialog.querySelectorAll('label')]
           .find((l) => l.textContent.trim().replace(/\\s*\\*$/, '') === label);
         return found && found.control;
       };
       const type = (label, value) => {
         const input = field(label);
         if (!input) return false;
         setter.call(input, value);
         input.dispatchEvent(new Event('input', { bubbles: true }));
         return true;
       };

       if (!type('Amount', '1000000')) return { error: 'no Amount field' };
       if (!type('Percentage', '0.5')) return { error: 'no Percentage field' };
       await wait(400);

       const read = (label) => { const i = field(label); return i ? i.value : null; };
       const received = { fee: read('Fees'), actual: read('Actual amount') };

       const pay = dialog.querySelector('input[type="radio"][value="PAY"]');
       if (!pay) return { error: 'no Pay radio' };
       pay.click();
       await wait(400);
       const paid = { fee: read('Fees'), actual: read('Actual amount') };

       return { received, paid };
     })()`,
  )) as {
    error?: string;
    received?: { fee: string | null; actual: string | null };
    paid?: { fee: string | null; actual: string | null };
  };

  checks.push({
    name: 'the form works the fee out as you type — 0.5% of 1,000,000 is 5,000',
    pass: filled.received?.fee === '5,000.00',
    detail: filled.error ?? `fee ${filled.received?.fee}`,
  });
  checks.push({
    name: 'a fee received is added — actual amount 1,005,000',
    pass: filled.received?.actual === '1,005,000.00',
    detail: filled.error ?? `actual ${filled.received?.actual}`,
  });
  checks.push({
    name: 'a fee paid is subtracted — actual amount 995,000',
    pass: filled.paid?.actual === '995,000.00',
    detail: filled.error ?? `actual ${filled.paid?.actual}`,
  });
  checks.push({
    name: 'switching direction does not change the fee itself',
    pass: filled.paid?.fee === '5,000.00',
    detail: filled.error ?? `fee ${filled.paid?.fee}`,
  });

  const filledShot = await win.webContents.capturePage();
  const filledFile = path.join(outDir, 'banking-new-transaction-filled.png');
  fs.writeFileSync(filledFile, filledShot.toPNG());
  console.log(`[smoke] screenshot banking-new-transaction-filled -> ${filledFile}`);

  // Last, because it signs out: the sign-in screen is the first thing a shop
  // sees and carries the shop logo (spec §29), so it is worth looking at too.
  await win.webContents.executeJavaScript('window.posBridge.auth.logout()');
  await win.webContents.executeJavaScript('window.location.hash = "#/"');
  await win.webContents.reload();
  await new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()));
  await new Promise((resolve) => setTimeout(resolve, 900));

  const login = await win.webContents.capturePage();
  const loginFile = path.join(outDir, 'login.png');
  fs.writeFileSync(loginFile, login.toPNG());
  console.log(`[smoke] screenshot login -> ${loginFile}`);

  return checks;
}

/**
 * Runs inside the renderer, so it can only touch what the preload actually
 * exposed — which is the point: if the bridge is wrong, this fails.
 */
const EXPECTED_NAMESPACES = Object.keys(CHANNELS).sort().join(',');

const SCRIPT = `
(async () => {
  const EXPECTED_NAMESPACES = ${JSON.stringify(EXPECTED_NAMESPACES)};
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass, detail });
  const b = window.posBridge;

  // ok(result) unwraps a success envelope; err(result) reads the error code.
  const ok = (r) => (r && r.ok ? r.data : null);
  const err = (r) => (r && !r.ok ? r.error : null);

  add('React mounted', (document.getElementById('root')?.childElementCount ?? 0) > 0);
  add('bridge exposed', typeof b === 'object' && b !== null);
  add('Node not reachable from renderer',
      typeof window.require === 'undefined' && typeof window.process === 'undefined');
  // The expected list is injected from shared/channels.ts, so this check cannot
  // go stale as namespaces are added — it only fails if the bridge and the
  // manifest actually disagree.
  add('bridge exposes exactly the manifest namespaces',
      Object.keys(b).sort().join(',') === EXPECTED_NAMESPACES,
      Object.keys(b).sort().join(','));

  const info = ok(await b.app.getInfo());
  add('app.getInfo', Boolean(info && info.version && info.databaseFile),
      info ? 'schema v' + info.schemaVersion : 'no data');
  // The real invariant (spec §7, §85): the database lives under the user-data
  // directory and never inside the installation folder. Paths are normalised
  // because Windows accepts both separators.
  const norm = (p) => String(p).replace(/\\\\/g, '/').toLowerCase();
  add('database kept outside the install directory',
      Boolean(info) &&
        norm(info.databaseFile).startsWith(norm(info.userDataDir)) &&
        !/program files|win-unpacked|\\/resources\\/|app\\.asar/.test(norm(info.databaseFile)),
      info && info.databaseFile);

  const before = ok(await b.auth.status());
  add('fresh shop needs first-run setup', before?.requiresFirstRunSetup === true);
  add('nobody signed in yet', before?.user === null);

  // Settings must be unreachable before signing in.
  const blocked = err(await b.settings.getShop());
  add('settings blocked before sign-in', blocked?.code === 'NOT_AUTHENTICATED', blocked?.code);

  const setupResult = await b.auth.completeFirstRunSetup({
    shopName: 'Smoke Test Shop',
    shopAddress: '1 Test Road',
    shopPhone: '0800000000',
    shopEmail: '',
    fullName: 'Smoke Admin',
    username: 'smokeadmin',
    password: 'smoke-pass-1',
    confirmPassword: 'smoke-pass-1',
    currency: 'THB',
    taxEnabled: true,
    taxRate: 700,
    taxMode: 'EXCLUSIVE',
    receiptWidth: '80mm',
    backupLocation: '',
  });
  const after = ok(setupResult);
  add('first-run setup creates admin', after?.user?.role === 'ADMIN',
      after ? after.user.username : err(setupResult)?.message);
  add('setup no longer required', after?.requiresFirstRunSetup === false);
  add('admin has settings.manage', Boolean(after?.permissions.includes('settings.manage')));

  const settings = ok(await b.settings.getShop());
  add('settings persisted', settings?.shopName === 'Smoke Test Shop', settings?.shopName);
  add('tax settings persisted', settings?.taxEnabled === true && settings?.taxRate === 700);
  add('currency persisted', settings?.currency === 'THB');

  await b.auth.logout();
  add('logout clears the session', ok(await b.auth.status())?.user === null);

  const badLogin = err(await b.auth.login({ username: 'smokeadmin', password: 'wrong-password' }));
  add('wrong password rejected', badLogin?.code === 'INVALID_CREDENTIALS', badLogin?.code);

  const goodLogin = ok(await b.auth.login({ username: 'smokeadmin', password: 'smoke-pass-1' }));
  add('correct password signs in', goodLogin?.user?.username === 'smokeadmin');

  // Validation must reject junk at the boundary rather than storing it.
  const junk = err(await b.settings.update({ values: { currency: 123 } }));
  add('invalid payload rejected', junk?.code === 'VALIDATION', junk?.code);

  // An unknown setting key must not be written into the settings table.
  const unknownKey = err(await b.settings.update({ values: { evilKey: 'x' } }));
  add('unknown setting key rejected', unknownKey?.code === 'VALIDATION', unknownKey?.code);

  // --- Settings screens (spec 58-62, 67) --------------------------------------
  //
  // A PARTIAL save. Every settings panel sends only the fields it owns, and this
  // is the check that was missing: the payload schema used to demand all
  // thirty-odd keys, so saving one field was refused at the boundary while the
  // compiler saw nothing wrong.
  const onePart = ok(await b.settings.update({ values: { receiptFooter: 'Come again!' } }));
  add('a partial settings save is accepted', onePart?.receiptFooter === 'Come again!',
      onePart?.receiptFooter);
  const untouched = ok(await b.settings.getShop());
  add('a partial save leaves the other settings alone',
      untouched?.shopName === 'Smoke Test Shop' && untouched?.currency === 'THB',
      untouched?.shopName + ' / ' + untouched?.currency);

  // The backup schedule is the caller that was broken by the above.
  const schedule = ok(await b.settings.update({
    values: { autoBackupFrequency: 'WEEKLY', autoBackupKeep: '20' },
  }));
  add('the backup schedule can be saved',
      schedule?.autoBackupFrequency === 'WEEKLY' && schedule?.autoBackupKeep === 20,
      schedule?.autoBackupFrequency + ' / ' + schedule?.autoBackupKeep);

  // A logo is stored inline, so it is the one setting big enough to matter and the
  // one that reaches an <img src> on a printed invoice.
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
    'AAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  const withLogo = ok(await b.settings.update({ values: { shopLogo: tinyPng } }));
  add('a logo image can be stored', withLogo?.shopLogo === tinyPng,
      String(withLogo?.shopLogo?.length) + ' chars');

  const bigLogo = ok(await b.settings.update({
    values: { shopLogo: 'data:image/png;base64,' + 'A'.repeat(200000) },
  }));
  add('a realistic logo size is allowed', (bigLogo?.shopLogo?.length ?? 0) > 200000,
      String(bigLogo?.shopLogo?.length));

  let hostileRefused = true;
  let acceptedLogo = '';
  for (const hostile of [
    'javascript:alert(1)',
    'https://example.com/logo.png',
    'data:text/html;base64,PHNjcmlwdD48L3NjcmlwdD4=',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  ]) {
    const rejected = err(await b.settings.update({ values: { shopLogo: hostile } }));
    if (rejected?.code !== 'VALIDATION') { hostileRefused = false; acceptedLogo = hostile; }
  }
  add('a logo that is not an inlined image is refused', hostileRefused, acceptedLogo);

  // Long values are capped per key, so the generous logo limit is not a hole.
  const longCurrency = err(await b.settings.update({ values: { currency: 'x'.repeat(300) } }));
  add('an over-long setting value is refused', longCurrency?.code === 'VALIDATION',
      longCurrency?.code);

  ok(await b.settings.update({ values: { shopLogo: '' } }));

  // --- Catalogue and the till ------------------------------------------------

  const categories = ok(await b.categories.list({ includeInactive: false }));
  add('default categories seeded', (categories?.length ?? 0) === 10, String(categories?.length));

  const cable = ok(await b.products.create({
    sku: 'SMOKE-CABLE', barcode: '5901234123457', name: 'USB-C Cable',
    purchasePrice: 80000, sellingPrice: 100000, taxRate: 0, taxRateOverride: false,
    minimumStock: 2, unit: 'pcs', isSerialized: false, warrantyMonths: 0, initialStock: 10,
  }));
  add('product created with opening stock', cable?.stockQuantity === 10, 'stock ' + cable?.stockQuantity);

  const scanned = ok(await b.products.findByCode({ code: '5901234123457' }));
  add('barcode lookup finds the product', scanned?.id === cable?.id);

  const missing = ok(await b.products.findByCode({ code: 'NO-SUCH-BARCODE' }));
  add('unknown barcode returns null, not an error', missing === null);

  const phone = ok(await b.products.create({
    sku: 'SMOKE-PHONE', name: 'iPhone 15',
    purchasePrice: 2500000, sellingPrice: 3000000, taxRate: 0, taxRateOverride: false,
    minimumStock: 0, unit: 'pcs', isSerialized: true, warrantyMonths: 12, initialStock: 0,
  }));
  const withImei = ok(await b.serials.add({
    productId: phone.id, serials: [{ imei1: '354121080000001' }],
  }));
  add('adding an IMEI adds one unit of stock', withImei?.stockQuantity === 1);

  const dupImei = err(await b.serials.add({
    productId: phone.id, serials: [{ imei1: '354121080000001' }],
  }));
  add('duplicate IMEI rejected', dupImei?.code === 'DUPLICATE', dupImei?.code);

  const serials = ok(await b.serials.list({ productId: phone.id, status: 'AVAILABLE' }));
  const imeiId = serials?.[0]?.id;

  // Quoting must not write anything.
  const quote = ok(await b.sales.quote({
    items: [{ productId: cable.id, quantity: 2 }], discountAmount: 0, payments: [],
  }));
  // This shop was set up with 7% exclusive tax, so 2 x 1,000.00 = 2,000.00 + 140.00.
  add('quote prices from the database', quote?.grandTotal === 214000, String(quote?.grandTotal));
  add('quote adds exclusive tax', quote?.taxAmount === 14000, String(quote?.taxAmount));
  const afterQuote = ok(await b.products.get({ id: cable.id }));
  add('quoting does not move stock', afterQuote?.stockQuantity === 10);

  const sale = ok(await b.sales.create({
    items: [
      { productId: cable.id, quantity: 2 },
      { productId: phone.id, quantity: 1, productSerialId: imeiId },
    ],
    discountAmount: 0,
    payments: [{ amount: 3500000, paymentMethod: 'CASH' }],
  }));
  add('sale completes', sale?.sale?.status === 'COMPLETED', sale?.sale?.invoiceNumber);
  // (2 x 1,000.00) + 30,000.00 = 32,000.00, +7% tax = 34,240.00
  add('sale total correct', sale?.sale?.grandTotal === 3424000, String(sale?.sale?.grandTotal));
  add('cost of goods frozen on the sale', sale?.sale?.costTotal === 2660000, String(sale?.sale?.costTotal));
  // Paid 35,000.00 against 34,240.00.
  add('change calculated', sale?.sale?.changeAmount === 76000, String(sale?.sale?.changeAmount));

  const cableAfter = ok(await b.products.get({ id: cable.id }));
  add('stock reduced by the sale', cableAfter?.stockQuantity === 8, 'stock ' + cableAfter?.stockQuantity);

  const soldSerial = ok(await b.serials.findByCode({ code: '354121080000001' }));
  add('IMEI marked SOLD', soldSerial?.status === 'SOLD', soldSerial?.status);
  add('warranty recorded', Boolean(soldSerial?.warrantyEndDate));

  // Selling the same handset again must be refused.
  const resell = err(await b.sales.create({
    items: [{ productId: phone.id, quantity: 1, productSerialId: imeiId }],
    discountAmount: 0, payments: [],
  }));
  add('IMEI cannot be sold twice', resell?.code === 'SERIAL_UNAVAILABLE', resell?.message);

  // Overselling must be refused, and must leave nothing behind.
  const oversell = err(await b.sales.create({
    items: [{ productId: cable.id, quantity: 999 }], discountAmount: 0, payments: [],
  }));
  add('overselling blocked', oversell?.code === 'INSUFFICIENT_STOCK', oversell?.code);
  const cableStill = ok(await b.products.get({ id: cable.id }));
  add('failed sale left stock untouched', cableStill?.stockQuantity === 8);

  // Refund one cable.
  const cableLine = sale.items.find((i) => i.productId === cable.id);
  const refund = ok(await b.sales.refund({
    saleId: sale.sale.id,
    items: [{ saleItemId: cableLine.id, quantity: 1, isDefective: false }],
    reason: 'Smoke test refund', refundMethod: 'CASH',
  }));
  // One cable at 1,000.00 including its 70.00 of tax.
  add('refund recorded', refund?.refundAmount === 107000, String(refund?.refundAmount));
  add('sale marked partially refunded',
      refund?.sale?.sale?.status === 'PARTIALLY_REFUNDED', refund?.sale?.sale?.status);
  const cableRefunded = ok(await b.products.get({ id: cable.id }));
  add('refund restored stock', cableRefunded?.stockQuantity === 9, 'stock ' + cableRefunded?.stockQuantity);

  // Inventory ledger must account for every movement.
  const history = ok(await b.inventory.history({ productId: cable.id, limit: 100, offset: 0 }));
  add('every stock movement is in the ledger', history?.total === 3, String(history?.total));
  add('ledger entries all carry a reason',
      (history?.rows ?? []).every((r) => Boolean(r.reason)));

  const lowStock = ok(await b.inventory.lowStock());
  add('low stock query works', Array.isArray(lowStock));

  // The figures above the Inventory screen. Reachable with inventory.view alone,
  // so a cashier is not refused the totals on a page they may open.
  const stock = ok(await b.inventory.summary());
  // 9 cables on the shelf: 10 received, 2 sold, 1 refunded back. At 800.00 cost
  // and 1,000.00 retail that is 7,200.00 held against 9,000.00 potential.
  add('stock summary values the shelf',
      stock?.unitsHeld === 9 && stock?.stockValueAtCost === 720000 &&
        stock?.potentialRevenue === 900000,
      JSON.stringify(stock));
  // The handset was sold, so the serialized product is out of stock and no IMEI
  // remains available.
  add('stock summary counts what is out of stock', stock?.outOfStockCount === 1,
      String(stock?.outOfStockCount));
  add('stock summary counts available handsets', stock?.availableSerials === 0,
      String(stock?.availableSerials));
  add('stock summary agrees with the low stock list',
      (stock?.lowStockCount ?? 0) + (stock?.outOfStockCount ?? 0) === lowStock.length,
      stock?.lowStockCount + ' low + ' + stock?.outOfStockCount + ' out vs ' + lowStock.length);

  // Customers.
  const customer = ok(await b.customers.create({ name: 'Nok', phone: '0812345678' }));
  add('customer created with a code', Boolean(customer?.customerCode), customer?.customerCode);

  const custSale = ok(await b.sales.create({
    customerId: customer.id,
    items: [{ productId: cable.id, quantity: 1 }],
    discountAmount: 0,
    payments: [{ amount: 107000, paymentMethod: 'CASH' }],
  }));
  add('sale snapshots the customer', custSale?.sale?.customerName === 'Nok');

  const custHistory = ok(await b.customers.history({ id: customer.id }));
  add('customer purchase history', custHistory?.purchases?.length === 1);
  add('customer totals', custHistory?.customer?.totalSpent === 107000,
      String(custHistory?.customer?.totalSpent));

  // --- Expenses --------------------------------------------------------------

  const expenseCats = ok(await b.expenseCategories.list({ includeInactive: false }));
  add('default expense categories seeded', (expenseCats?.length ?? 0) === 10, String(expenseCats?.length));

  const rent = (expenseCats ?? []).find((c) => c.name === 'Rent');
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const todayDay = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());

  const expense = ok(await b.expenses.create({
    categoryId: rent.id, expenseDay: todayDay, description: 'Monthly shop rent',
    amount: 1500000, paymentMethod: 'CASH',
  }));
  // Checked with plain string operations rather than a regex: this script lives
  // inside a template literal, where a lone \\d is not a valid escape and would
  // silently collapse to "d".
  add('expense created with a number',
      (expense?.expenseNumber ?? '').startsWith('EXP-') &&
        (expense?.expenseNumber ?? '').endsWith('-0001'),
      expense?.expenseNumber);

  const zeroAmount = err(await b.expenses.create({
    categoryId: rent.id, expenseDay: todayDay, description: 'Nothing', amount: 0,
    paymentMethod: 'CASH',
  }));
  add('zero-amount expense rejected', zeroAmount?.code === 'VALIDATION', zeroAmount?.code);

  const expSummary = ok(await b.expenses.summary({ from: todayDay, to: todayDay }));
  add('expense summary totals', expSummary?.total === 1500000, String(expSummary?.total));
  add('expense summary by category', expSummary?.byCategory?.[0]?.categoryName === 'Rent');

  // Soft delete: the figure leaves the reports but the record survives.
  await b.expenses.delete({ id: expense.id, reason: 'Smoke test cleanup' });
  const afterDelete = ok(await b.expenses.summary({ from: todayDay, to: todayDay }));
  add('deleted expense leaves the reports', afterDelete?.total === 0, String(afterDelete?.total));
  const withDeleted = ok(await b.expenses.list({
    includeDeleted: true, page: 0, pageSize: 50,
  }));
  add('deleted expense is still on record', withDeleted?.total === 1, String(withDeleted?.total));

  // --- Banking (banks and mobile payments) ------------------------------------

  const noAccountsYet = ok(await b.banking.listAccounts({ includeInactive: true }));
  add('a fresh shop has no bank accounts', (noAccountsYet?.length ?? 0) === 0,
      String(noAccountsYet?.length));

  const kbz = ok(await b.banking.saveAccount({
    name: 'Kanbawza', key: 'Kpay', isActive: true,
  }));
  add('bank account registered with its key', kbz?.key === 'Kpay' && kbz?.name === 'Kanbawza',
      kbz?.name + ' / ' + kbz?.key);
  add('a new account can be deleted', kbz?.canDelete === true);

  const ayaAcct = ok(await b.banking.saveAccount({
    name: 'AYA Bank', key: 'AYAPay', isActive: true,
  }));

  const dupKey = err(await b.banking.saveAccount({
    name: 'Another Bank', key: 'kpay', isActive: true,
  }));
  add('duplicate account key rejected', dupKey?.code === 'VALIDATION', dupKey?.code);

  // The key labels every transaction already recorded, so it is a one-way door.
  const keyChange = err(await b.banking.saveAccount({
    id: kbz.id, name: 'Kanbawza', key: 'KpayNew', isActive: true,
  }));
  add('account key cannot be changed', keyChange?.code === 'INVALID_STATE', keyChange?.code);
  const unchanged = ok(await b.banking.listAccounts({ includeInactive: true }));
  add('the old key survived the attempt',
      (unchanged ?? []).some((a) => a.key === 'Kpay') &&
        !(unchanged ?? []).some((a) => a.key === 'KpayNew'));

  // An unused account really can go, and its key becomes free again.
  const throwaway = ok(await b.banking.saveAccount({
    name: 'Wrong Bank', key: 'Oops', isActive: true,
  }));
  ok(await b.banking.deleteAccount({ id: throwaway.id }));
  const afterAccountDelete = ok(await b.banking.listAccounts({ includeInactive: true }));
  add('an unused account is deleted', (afterAccountDelete?.length ?? 0) === 2,
      String(afterAccountDelete?.length));

  const bankAt = todayDay + 'T10:30';

  const received = ok(await b.banking.createTransaction({
    type: 'RECEIVE', transactionAt: bankAt, toAccountId: kbz.id,
    fromAccountNumber: '09-111-2222', fromName: 'Ma Hla',
    toAccountNumber: '001-22-3333', toName: 'Green Mobile',
    amount: 1500000,
  }));
  add('receive recorded with a number',
      (received?.transactionNumber ?? '').startsWith('BNK-') &&
        (received?.transactionNumber ?? '').endsWith('-0001'),
      received?.transactionNumber);
  add('receive resolved the account name', received?.toAccountKey === 'Kpay');
  // Per transaction, not per bank: one wallet serves many account numbers.
  add('account number recorded on the transaction',
      received?.fromAccountNumber === '09-111-2222' &&
        received?.toAccountNumber === '001-22-3333',
      received?.fromAccountNumber + ' -> ' + received?.toAccountNumber);

  const noNumber = err(await b.banking.createTransaction({
    type: 'RECEIVE', transactionAt: bankAt, toAccountId: kbz.id,
    fromAccountNumber: '', fromName: 'Ma Hla',
    toAccountNumber: '001-22-3333', toName: 'Green Mobile',
    amount: 1000,
  }));
  add('account number is required', noNumber?.code === 'VALIDATION', noNumber?.code);

  const noHolder = err(await b.banking.createTransaction({
    type: 'RECEIVE', transactionAt: bankAt, toAccountId: kbz.id,
    fromAccountNumber: '09-111-2222', fromName: '   ',
    toAccountNumber: '001-22-3333', toName: 'Green Mobile',
    amount: 1000,
  }));
  add('account name is required', noHolder?.code === 'VALIDATION', noHolder?.code);

  ok(await b.banking.createTransaction({
    type: 'TRANSFER', transactionAt: bankAt, fromAccountId: kbz.id,
    fromAccountNumber: '001-22-3333', fromName: 'Green Mobile',
    toAccountNumber: '09-333-4444', toName: 'A supplier',
    amount: 400000,
  }));

  // A transfer must leave one of the shop's own accounts, or the headline totals
  // would move while no balance did.
  const noOwnSide = err(await b.banking.createTransaction({
    type: 'TRANSFER', transactionAt: bankAt,
    fromAccountNumber: '1', fromName: 'X', toAccountNumber: '2', toName: 'Y',
    amount: 1000,
  }));
  add('transfer with no account of ours rejected', noOwnSide?.code === 'VALIDATION', noOwnSide?.code);

  // Once used, the account can only be switched off.
  const deleteUsed = err(await b.banking.deleteAccount({ id: kbz.id }));
  add('a used account cannot be deleted', deleteUsed?.code === 'INVALID_STATE', deleteUsed?.code);

  // Kpay to Kpay: allowed, and it must leave that account's balance alone.
  const sameAccount = ok(await b.banking.createTransaction({
    type: 'TRANSFER', transactionAt: bankAt, fromAccountId: kbz.id, toAccountId: kbz.id,
    fromAccountNumber: '001-22-3333', fromName: 'Green Mobile',
    toAccountNumber: '001-22-3333', toName: 'Green Mobile',
    amount: 50000,
  }));
  add('a movement within one account is allowed',
      sameAccount?.fromAccountId === kbz.id && sameAccount?.toAccountId === kbz.id);

  const banking = ok(await b.banking.overview({ from: todayDay, to: todayDay }));
  const kbzPosition = (banking?.accounts ?? []).find((a) => a.key === 'Kpay');
  add('per-bank received and transferred',
      kbzPosition?.received === 1500000 && kbzPosition?.transferred === 450000,
      kbzPosition?.received + ' in / ' + kbzPosition?.transferred + ' out');
  add('remaining is received less transferred', kbzPosition?.balance === 1050000,
      String(kbzPosition?.balance));

  // A transfer is money OUT, whatever bank is named on the other side: the type
  // the user chose is the only thing that says which way the money went.
  ok(await b.banking.createTransaction({
    type: 'TRANSFER', transactionAt: bankAt, fromAccountId: kbz.id, toAccountId: ayaAcct.id,
    fromAccountNumber: '001-22-3333', fromName: 'Green Mobile',
    toAccountNumber: '09-777-8888', toName: 'Green Mobile',
    amount: 100000,
  }));
  const afterInternal = ok(await b.banking.overview({ from: todayDay, to: todayDay }));
  add('a transfer naming another bank still counts as money out',
      afterInternal?.bankBalance === 950000, String(afterInternal?.bankBalance));
  add('each movement counts once', afterInternal?.totals?.count === 4,
      String(afterInternal?.totals?.count));
  // The bug this pins: the strip summed by DIRECTION while the list summed by
  // TYPE, so rows with the same bank on both sides showed as money in AND out.
  add('the strip and the list report the same split',
      afterInternal?.totals?.received === 1500000 &&
        afterInternal?.totals?.transferred === 550000,
      afterInternal?.totals?.received + ' in / ' + afterInternal?.totals?.transferred + ' out');
  const columnsAddUp = (afterInternal?.accounts ?? []).reduce((t, a) => t + a.balance, 0);
  add('the per-bank column adds up to the bank total',
      columnsAddUp === afterInternal?.bankBalance, String(columnsAddUp));

  // Cash in hand is recorded, not calculated — and "never counted" is not zero.
  add('cash in hand starts unrecorded', afterInternal?.cashInHand?.recorded === false);
  const counted = ok(await b.banking.saveCashCount({ amount: 275000, notes: 'Smoke count' }));
  add('cash in hand saved', counted?.amount === 275000 && counted?.recorded === true,
      String(counted?.amount));
  const withCash = ok(await b.banking.overview({ from: todayDay, to: todayDay }));
  add('cash in hand travels with the overview', withCash?.cashInHand?.amount === 275000);

  // Filtering: yesterday holds nothing, today holds all three.
  const yesterdayDate = new Date(today.getTime() - 86400000);
  const yesterdayDay = yesterdayDate.getFullYear() + '-' + pad(yesterdayDate.getMonth() + 1) +
    '-' + pad(yesterdayDate.getDate());
  const todayBank = ok(await b.banking.listTransactions({
    from: todayDay, to: todayDay, includeDeleted: false, page: 0, pageSize: 50,
  }));
  const yesterdayBank = ok(await b.banking.listTransactions({
    from: yesterdayDay, to: yesterdayDay, includeDeleted: false, page: 0, pageSize: 50,
  }));
  add('banking date filter works', todayBank?.total === 4 && yesterdayBank?.total === 0,
      todayBank?.total + ' today / ' + yesterdayBank?.total + ' yesterday');
  add('listed figures split by type',
      todayBank?.receiveTotal === 1500000 && todayBank?.transferTotal === 550000,
      todayBank?.receiveTotal + ' / ' + todayBank?.transferTotal);

  // Deleting keeps the row and removes the money from the balances.
  await b.banking.deleteTransaction({ id: received.id, reason: 'Smoke test cleanup' });
  const afterBankDelete = ok(await b.banking.overview({ from: todayDay, to: todayDay }));
  add('deleting a transaction changes the balance',
      afterBankDelete?.bankBalance === -550000, String(afterBankDelete?.bankBalance));
  const bankWithDeleted = ok(await b.banking.listTransactions({
    from: todayDay, to: todayDay, includeDeleted: true, page: 0, pageSize: 50,
  }));
  add('a deleted transaction is still on record', bankWithDeleted?.total === 4,
      String(bankWithDeleted?.total));

  // The fee: the rate crosses the bridge, the money is worked out in the main
  // process. 1,000,000.00 at 0.5% is 5,000.00 — the figure the form shows while
  // the user types, proved here end to end against a real database.
  const withFee = ok(await b.banking.createTransaction({
    type: 'RECEIVE', transactionAt: bankAt, toAccountId: kbz.id,
    fromAccountNumber: '09-111-2222', fromName: 'A customer',
    toAccountNumber: '001-22-3333', toName: 'Green Mobile',
    amount: 100000000, feeBasisPoints: 50, feeDirection: 'RECEIVE',
  }));
  add('0.5% of 1,000,000 is stored as a 5,000 fee',
      withFee?.feeAmount === 500000 && withFee?.feeBasisPoints === 50,
      'fee ' + withFee?.feeAmount + ' at ' + withFee?.feeBasisPoints + 'bp');
  add('the fee direction is kept', withFee?.feeDirection === 'RECEIVE', withFee?.feeDirection);

  // Sent a fee in money rather than a rate: it must be ignored, not stored.
  const feeNotTrusted = ok(await b.banking.createTransaction({
    type: 'RECEIVE', transactionAt: bankAt, toAccountId: kbz.id,
    fromAccountNumber: '09-111-2222', fromName: 'A customer',
    toAccountNumber: '001-22-3333', toName: 'Green Mobile',
    amount: 100000, feeBasisPoints: 100, feeDirection: 'PAY',
    feeAmount: 99999999,
  }));
  add('a fee sent as money is ignored and recalculated',
      feeNotTrusted?.feeAmount === 1000, String(feeNotTrusted?.feeAmount));

  const feeTooHigh = err(await b.banking.createTransaction({
    type: 'RECEIVE', transactionAt: bankAt, toAccountId: kbz.id,
    fromAccountNumber: '09-111-2222', fromName: 'A customer',
    toAccountNumber: '001-22-3333', toName: 'Green Mobile',
    amount: 100000, feeBasisPoints: 10001, feeDirection: 'PAY',
  }));
  add('a fee rate above 100% is refused', feeTooHigh?.code === 'VALIDATION', feeTooHigh?.code);

  /*
    The three fee figures on the summary strip.

    By this point the shop has a 5,000 fee received (on the 1,000,000 receipt)
    and a 1,000 fee paid (on the 100,000 receipt). Note that the PAID one sits on
    a RECEIVE row: totalling fees by the row's type instead of the fee's own
    direction would file it as money earned, which is the mistake these pin.
  */
  const withFees = ok(await b.banking.overview({ from: todayDay, to: todayDay }));
  add('fees earned are totalled on their own',
      withFees?.totals?.feeReceived === 500000, String(withFees?.totals?.feeReceived));
  add('a fee paid on a receipt counts as paid, not earned',
      withFees?.totals?.feePaid === 1000, String(withFees?.totals?.feePaid));
  add('the actual total is the net with fees on the right side',
      withFees?.totals?.netAfterFees ===
        (withFees?.totals?.net ?? 0) + 500000 - 1000,
      withFees?.totals?.net + ' net -> ' + withFees?.totals?.netAfterFees + ' actual');

  // --- Service / repair ------------------------------------------------------

  const part = ok(await b.products.create({
    sku: 'SMOKE-SCREEN', name: 'Galaxy S24 Screen',
    purchasePrice: 120000, sellingPrice: 200000, taxRate: 0, taxRateOverride: false,
    minimumStock: 0, unit: 'pcs', isSerialized: false, warrantyMonths: 0, initialStock: 3,
  }));

  const job = ok(await b.services.create({
    customerName: 'Repair Walk-in', customerPhone: '0877777777',
    deviceBrand: 'Samsung', deviceModel: 'Galaxy S24', imei: '356938035643809',
    problemDescription: 'Cracked screen', initialCondition: 'Scratched frame',
    estimatedCost: 350000, depositAmount: 100000, depositMethod: 'CASH',
  }));
  add('service job created', job?.order?.status === 'RECEIVED', job?.order?.serviceNumber);
  add('deposit stored as a payment', job?.payments?.length === 1 && job.payments[0].isDeposit === 1);
  add('job starts with nothing charged', job?.order?.finalCost === 0);

  // Fitting a part must come off the shelf.
  const withPart = ok(await b.services.addItem({
    serviceOrderId: job.order.id, productId: part.id, description: '',
    quantity: 1, unitCost: 0, sellingPrice: 200000, type: 'PART',
  }));
  add('part added to the job', withPart?.order?.finalCost === 200000, String(withPart?.order?.finalCost));
  add('part cost taken from the product', withPart?.order?.partsCost === 120000);
  const partAfter = ok(await b.products.get({ id: part.id }));
  add('fitting a part reduces stock', partAfter?.stockQuantity === 2, 'stock ' + partAfter?.stockQuantity);

  const withLabour = ok(await b.services.addItem({
    serviceOrderId: job.order.id, description: 'Screen fitting labour',
    quantity: 1, unitCost: 0, sellingPrice: 150000, type: 'LABOR',
  }));
  add('labour added', withLabour?.order?.finalCost === 350000, String(withLabour?.order?.finalCost));
  add('balance accounts for the deposit', withLabour?.order?.balance === 250000,
      String(withLabour?.order?.balance));

  // The workflow must be followed, not skipped.
  const skip = err(await b.services.changeStatus({
    serviceOrderId: job.order.id, status: 'DELIVERED',
  }));
  add('cannot skip straight to delivered', skip?.code === 'INVALID_STATE', skip?.code);

  await b.services.changeStatus({ serviceOrderId: job.order.id, status: 'REPAIRING' });
  const completed = ok(await b.services.changeStatus({
    serviceOrderId: job.order.id, status: 'COMPLETED',
  }));
  add('job can be completed', completed?.order?.status === 'COMPLETED');

  // Handing the device back requires the money to be settled.
  const owing = err(await b.services.changeStatus({
    serviceOrderId: job.order.id, status: 'DELIVERED',
  }));
  add('cannot deliver with money owing', owing?.code === 'INVALID_STATE', owing?.message);

  const overpay = err(await b.services.addPayment({
    serviceOrderId: job.order.id, amount: 999999999, paymentMethod: 'CASH',
  }));
  add('cannot take more than is owed', overpay?.code === 'VALIDATION', overpay?.code);

  const settled = ok(await b.services.addPayment({
    serviceOrderId: job.order.id, amount: 250000, paymentMethod: 'CASH',
  }));
  add('final payment settles the job', settled?.order?.balance === 0);

  const delivered = ok(await b.services.changeStatus({
    serviceOrderId: job.order.id, status: 'DELIVERED',
  }));
  add('job delivered once paid', delivered?.order?.status === 'DELIVERED');
  add('delivery date stamped', Boolean(delivered?.order?.deliveredDate));

  // A delivered job is a closed record.
  const frozen = err(await b.services.addItem({
    serviceOrderId: job.order.id, description: 'Sneaky extra',
    quantity: 1, unitCost: 0, sellingPrice: 1000, type: 'LABOR',
  }));
  add('delivered job is frozen', frozen?.code === 'INVALID_STATE', frozen?.code);

  const board = ok(await b.services.board());
  add('service board counts by status', board?.DELIVERED === 1, JSON.stringify(board));

  const svcSummary = ok(await b.services.summary({ from: todayDay, to: todayDay }));
  add('service summary revenue', svcSummary?.revenue === 350000, String(svcSummary?.revenue));
  add('service summary gross profit', svcSummary?.grossProfit === 230000, String(svcSummary?.grossProfit));
  add('service summary has nothing outstanding', svcSummary?.outstanding === 0);

  const jobSheet = ok(await b.services.printDocument({
    serviceOrderId: job.order.id, kind: 'JOB_SHEET', asPdf: true,
  }));
  add('job sheet saved as PDF', jobSheet?.printed === false && Boolean(jobSheet?.path), jobSheet?.path);

  const completionDoc = ok(await b.services.printDocument({
    serviceOrderId: job.order.id, kind: 'COMPLETION', asPdf: true,
  }));
  add('completion receipt saved as PDF', Boolean(completionDoc?.path), completionDoc?.path);

  // --- Reports and export ----------------------------------------------------

  const REPORT_KINDS = ['SALES','REVENUE','EXPENSES','PROFIT_LOSS','INVENTORY','PRODUCTS','CUSTOMERS','SERVICES'];
  let allBuilt = true;
  let badTable = '';
  for (const kind of REPORT_KINDS) {
    const built = ok(await b.reports.build({ kind, from: todayDay, to: todayDay }));
    if (!built || built.kind !== kind || !Array.isArray(built.tables) || built.tables.length === 0) {
      allBuilt = false; badTable = kind; break;
    }
    // Every column a renderer will read must exist on every row.
    for (const table of built.tables) {
      for (const row of table.rows) {
        for (const column of table.columns) {
          if (!Object.prototype.hasOwnProperty.call(row, column.key)) {
            allBuilt = false; badTable = kind + '.' + table.title + '.' + column.key;
          }
        }
      }
    }
    if (!allBuilt) break;
  }
  add('all eight reports build with complete rows', allBuilt, badTable || '8 reports');

  const sales = ok(await b.reports.build({ kind: 'SALES', from: todayDay, to: todayDay }));
  const figure = (label) => (sales?.figures ?? []).find((f) => f.label === label)?.value;
  add('sales report net sales', figure('Net sales') === 3200000, String(figure('Net sales')));
  add('sales report COGS from frozen cost', figure('Cost of goods sold') === 2660000,
      String(figure('Cost of goods sold')));

  const pl = ok(await b.reports.build({ kind: 'PROFIT_LOSS', from: todayDay, to: todayDay }));
  const plFigure = (label) => (pl?.figures ?? []).find((f) => f.label === label)?.value;
  // Goods profit 5,400.00 + repair profit 2,300.00, with the 15,000.00 rent
  // expense deleted earlier in this run, so nothing is deducted.
  add('P&L reaches a net profit', plFigure('Net profit') === 770000, String(plFigure('Net profit')));

  const inventory = ok(await b.reports.build({ kind: 'INVENTORY', from: todayDay, to: todayDay }));
  add('inventory report values the shelf',
      (inventory?.figures ?? []).some((f) => f.label === 'Stock value at cost' && f.value > 0));

  // Each format must produce a real file on disk; the Node side verifies them.
  const xlsx = ok(await b.reports.export({
    kind: 'SALES', from: todayDay, to: todayDay, format: 'XLSX', chooseLocation: false,
  }));
  add('report exported to Excel', xlsx?.saved === true && /\.xlsx$/.test(xlsx?.path ?? ''), xlsx?.path);

  const csv = ok(await b.reports.export({
    kind: 'PROFIT_LOSS', from: todayDay, to: todayDay, format: 'CSV', chooseLocation: false,
  }));
  add('report exported to CSV', csv?.saved === true && /\.csv$/.test(csv?.path ?? ''), csv?.path);

  const reportPdf = ok(await b.reports.export({
    kind: 'INVENTORY', from: todayDay, to: todayDay, format: 'PDF', chooseLocation: false,
  }));
  add('report exported to PDF', reportPdf?.saved === true && /\.pdf$/.test(reportPdf?.path ?? ''),
      reportPdf?.path);

  // --- Documents -------------------------------------------------------------

  const printers = ok(await b.print.listPrinters());
  add('printer list retrievable', Array.isArray(printers), (printers?.length ?? 0) + ' printer(s)');

  // Exercises the whole document pipeline: HTML template -> hidden window ->
  // Chromium print-to-PDF -> bytes on disk. The Node side then checks the file.
  const a4 = ok(await b.print.savePdf({ saleId: sale.sale.id, format: 'A4', chooseLocation: false }));
  add('A4 invoice saved as PDF', a4?.saved === true && /\.pdf$/i.test(a4?.path ?? ''), a4?.path);

  const receiptPdf = ok(await b.print.savePdf({
    saleId: custSale.sale.id, format: 'RECEIPT', chooseLocation: false,
  }));
  add('thermal receipt saved as PDF', receiptPdf?.saved === true, receiptPdf?.path);

  // openFile must refuse anything outside the invoices folder.
  const escapeAttempt = ok(await b.print.openFile({ path: 'C:\Windows\System32\calc.exe' }));
  add('openFile refuses paths outside the invoices folder', escapeAttempt?.opened === false);

  // --- List export (spec §56) -------------------------------------------------

  // Paths are built with fromCharCode rather than an escape: this script lives
  // inside a template literal, where a lone backslash is not a valid escape.
  const SEP = String.fromCharCode(92);
  const posix = (p) => String(p).split(SEP).join('/');
  const userData = posix(info.userDataDir);

  const listExports = [
    ['PRODUCT_LIST', { lowStockOnly: false, includeInactive: false, page: 0, pageSize: 25 }, 'XLSX', '.xlsx'],
    ['CUSTOMER_LIST', { includeInactive: false, page: 0, pageSize: 25 }, 'CSV', '.csv'],
    ['SALE_LIST', { from: todayDay, to: todayDay, page: 0, pageSize: 25 }, 'XLSX', '.xlsx'],
    ['EXPENSE_LIST', { includeDeleted: false, page: 0, pageSize: 25 }, 'CSV', '.csv'],
    ['BANK_TRANSACTION_LIST', { includeDeleted: false, page: 0, pageSize: 25 }, 'XLSX', '.xlsx'],
    ['INVENTORY_LIST', {}, 'PDF', '.pdf'],
  ];
  let listExportsOk = true;
  let badExport = '';
  for (const [dataset, query, format, extension] of listExports) {
    const written = ok(await b.data.exportList({
      dataset, query, format, chooseLocation: false,
    }));
    if (!written?.saved || !String(written.path).toLowerCase().endsWith(extension)) {
      listExportsOk = false;
      badExport = dataset + ' -> ' + format;
      break;
    }
  }
  add('every list exports to a file', listExportsOk, badExport || '6 lists');

  // --- Product import (spec §57) ---------------------------------------------

  // The runner wrote this CSV before the application started.
  const importFile = userData + '/exports/smoke-import.csv';
  const importPreview = ok(await b.data.importPreview({ path: importFile }));
  add('import preview reads the spreadsheet',
      importPreview?.summary?.total === 3, JSON.stringify(importPreview?.summary));
  add('import preview separates good rows from bad',
      importPreview?.summary?.create === 2 && importPreview?.summary?.skip === 1,
      importPreview ? importPreview.summary.create + ' new, ' + importPreview.summary.skip + ' skipped' : '');
  add('import preview explains why a row is refused',
      (importPreview?.rows ?? []).some((r) => r.action === 'SKIP' && r.errors.length > 0));

  // Nothing may be written by a preview.
  const notYet = ok(await b.products.findByCode({ code: 'SMOKE-IMP-1' }));
  add('previewing writes nothing', notYet === null);

  const imported = ok(await b.data.importCommit({ importId: importPreview.importId }));
  add('import creates the good rows', imported?.created === 2, JSON.stringify(imported));
  add('import brings stock in through the ledger', imported?.stockAdded === 55,
      String(imported?.stockAdded));

  const importedProduct = ok(await b.products.findByCode({ code: 'SMOKE-IMP-1' }));
  add('imported product is sellable', importedProduct?.stockQuantity === 40,
      'stock ' + importedProduct?.stockQuantity);

  const importedHistory = ok(await b.inventory.history({
    productId: importedProduct.id, limit: 20, offset: 0,
  }));
  add('imported stock is traceable', importedHistory?.total === 1 &&
      importedHistory.rows[0].transactionType === 'PURCHASE');

  const replay = err(await b.data.importCommit({ importId: importPreview.importId }));
  add('an import cannot be committed twice', replay?.code === 'VALIDATION', replay?.code);

  const notASpreadsheet = err(await b.data.importPreview({ path: userData + '/data/pos.db' }));
  add('import refuses a file that is not a spreadsheet',
      notASpreadsheet?.code === 'IMPORT_FAILED', notASpreadsheet?.code);

  // --- Staff accounts (spec §8, §30, §31) -------------------------------------

  const staff = ok(await b.users.list({ includeInactive: true }));
  add('staff list starts with the one administrator',
      staff?.rows?.length === 1 && staff?.activeAdmins === 1,
      JSON.stringify(staff?.rows?.map((r) => r.username)));
  add('staff list carries no password hash',
      !JSON.stringify(staff ?? {}).includes('$2'));

  const cashier = ok(await b.users.create({
    username: 'smokecashier', fullName: 'Smoke Cashier', phone: '0811111111',
    role: 'CASHIER', password: 'cashier-pass-1', confirmPassword: 'cashier-pass-1',
  }));
  add('cashier account created', cashier?.role === 'CASHIER' && cashier?.isActive === 1,
      cashier?.username);

  const dupUser = err(await b.users.create({
    username: 'SMOKECASHIER', fullName: 'Impostor',
    role: 'CASHIER', password: 'cashier-pass-1', confirmPassword: 'cashier-pass-1',
  }));
  add('duplicate username rejected', dupUser?.code === 'VALIDATION', dupUser?.message);

  // The lock-out guard, through the real bridge. There is no way back into this
  // installation if the last administrator loses access. The list is ordered
  // administrators first, and at this point there is exactly one.
  const adminId = staff.rows[0].id;

  const demoteLast = err(await b.users.update({
    id: adminId, fullName: 'Smoke Admin', role: 'MANAGER', isActive: true,
  }));
  add('the last administrator cannot be demoted',
      demoteLast?.code === 'INVALID_STATE', demoteLast?.message);

  const deactivateSelf = err(await b.users.update({
    id: adminId, fullName: 'Smoke Admin', role: 'ADMIN', isActive: false,
  }));
  add('the last administrator cannot be deactivated',
      deactivateSelf?.code === 'INVALID_STATE', deactivateSelf?.code);

  // Password reset needs the administrator's own password (spec §30).
  const badReset = err(await b.users.resetPassword({
    userId: cashier.id, adminPassword: 'wrong-password',
    newPassword: 'reset-pass-1', confirmPassword: 'reset-pass-1',
  }));
  add('reset refused without the administrator password',
      badReset?.code === 'VALIDATION', badReset?.code);

  const goodReset = ok(await b.users.resetPassword({
    userId: cashier.id, adminPassword: 'smoke-pass-1',
    newPassword: 'reset-pass-1', confirmPassword: 'reset-pass-1',
  }));
  add('password reset with the administrator password', goodReset?.reset === true);

  // Sign in as the cashier: proves the reset took, and that the role is enforced
  // in the main process rather than by hiding buttons.
  await b.auth.logout();
  const asCashier = ok(await b.auth.login({
    username: 'smokecashier', password: 'reset-pass-1',
  }));
  add('the reset password works', asCashier?.user?.role === 'CASHIER');
  add('a cashier gets the till but not the books',
      asCashier?.permissions.includes('pos.sell') === true &&
        asCashier?.permissions.includes('reports.view') === false &&
        asCashier?.permissions.includes('users.manage') === false);

  const cashierCreatingUsers = err(await b.users.create({
    username: 'sneaky', fullName: 'Sneaky', role: 'ADMIN',
    password: 'sneaky-pass', confirmPassword: 'sneaky-pass',
  }));
  add('a cashier cannot create accounts',
      cashierCreatingUsers?.code === 'NOT_AUTHORIZED', cashierCreatingUsers?.message);

  const cashierReadingBackups = err(await b.backup.overview());
  add('a cashier cannot reach the backups',
      cashierReadingBackups?.code === 'NOT_AUTHORIZED', cashierReadingBackups?.code);

  const cashierReadingReports = err(await b.reports.build({
    kind: 'PROFIT_LOSS', from: todayDay, to: todayDay,
  }));
  const cashierSetting = err(await b.settings.update({ values: { shopName: 'Hijacked' } }));
  add('a cashier cannot change settings', cashierSetting?.code === 'NOT_AUTHORIZED',
      cashierSetting?.code);
  const cashierLogo = err(await b.settings.chooseLogo());
  add('a cashier cannot choose a logo', cashierLogo?.code === 'NOT_AUTHORIZED',
      cashierLogo?.code);

  add('a cashier cannot read the profit and loss',
      cashierReadingReports?.code === 'NOT_AUTHORIZED', cashierReadingReports?.code);

  await b.auth.logout();
  await b.auth.login({ username: 'smokeadmin', password: 'smoke-pass-1' });

  // This account signed in a moment ago, which wrote audit rows — so it has
  // history and is deactivated rather than deleted (spec §74). Anything that
  // names a user stays attributable.
  const removed = ok(await b.users.delete({ id: cashier.id }));
  add('an account with history is deactivated, not deleted', removed?.deactivated === true);

  const afterRemoval = ok(await b.users.list({ includeInactive: true }));
  add('the deactivated account is still on record', afterRemoval?.rows?.length === 2,
      JSON.stringify(afterRemoval?.rows?.map((r) => r.username + ':' + r.isActive)));
  add('the deactivated account cannot sign in',
      ok(await b.users.list({ includeInactive: false }))?.rows?.length === 1);

  const deactivatedLogin = err(await b.auth.login({
    username: 'smokecashier', password: 'reset-pass-1',
  }));
  add('a deactivated account is refused at the login screen',
      deactivatedLogin?.code === 'INVALID_STATE', deactivatedLogin?.message);

  // That failed login left no session, so sign back in as the administrator.
  await b.auth.login({ username: 'smokeadmin', password: 'smoke-pass-1' });

  // --- Backup and restore (spec §53–§55) --------------------------------------

  const emptyOverview = ok(await b.backup.overview());
  add('backup overview reports the folders',
      Boolean(emptyOverview?.folders?.effectiveDir) && emptyOverview.databaseSizeBytes > 0,
      emptyOverview?.folders?.effectiveDir);

  const made = ok(await b.backup.create({ chooseLocation: false }));
  add('backup created', made?.created === true && Boolean(made?.file?.path), made?.file?.path);
  add('backup is classified as manual', made?.file?.kind === 'MANUAL', made?.file?.kind);
  add('backup has real bytes', (made?.file?.sizeBytes ?? 0) > 20000, String(made?.file?.sizeBytes));

  const overview = ok(await b.backup.overview());
  add('backup appears in the list',
      (overview?.backups ?? []).some((f) => f.path === made.file.path));

  const inspected = ok(await b.backup.inspect({ path: made.file.path }));
  add('backup inspects as usable', inspected?.ok === true, inspected?.problem);
  add('backup reports what is inside it',
      inspected?.contents?.sales === 2 && inspected?.contents?.products === 5,
      JSON.stringify(inspected?.contents));

  const notABackup = ok(await b.backup.inspect({ path: importFile }));
  add('a spreadsheet is not accepted as a backup', notABackup?.ok === false, notABackup?.problem);

  const outsideDelete = err(await b.backup.delete({ path: userData + '/data/pos.db' }));
  add('deleting outside the backup folders is refused',
      outsideDelete?.code === 'VALIDATION', outsideDelete?.code);

  // A marker that exists only AFTER the backup, so the restore is provable.
  await b.products.create({
    sku: 'SMOKE-AFTER-BACKUP', name: 'Added after the backup',
    purchasePrice: 1000, sellingPrice: 2000, taxRate: 0, taxRateOverride: false,
    minimumStock: 0, unit: 'pcs', isSerialized: false, warrantyMonths: 0, initialStock: 1,
  });
  add('marker product exists before the restore',
      ok(await b.products.findByCode({ code: 'SMOKE-AFTER-BACKUP' })) !== null);

  const restored = ok(await b.backup.restore({ path: made.file.path }));
  add('restore completes', Boolean(restored?.safetyBackup?.path), restored?.safetyBackup?.path);
  add('restore keeps the data it replaced', restored?.safetyBackup?.kind === 'SAFETY');
  add('restore signs the user out', ok(await b.auth.status())?.user === null);

  const backIn = ok(await b.auth.login({ username: 'smokeadmin', password: 'smoke-pass-1' }));
  add('the restored database has its own users', backIn?.user?.username === 'smokeadmin');

  add('restore rolled the shop back',
      ok(await b.products.findByCode({ code: 'SMOKE-AFTER-BACKUP' })) === null);
  add('restore kept everything up to the backup',
      ok(await b.products.findByCode({ code: '5901234123457' })) !== null);
  const salesAfterRestore = ok(await b.sales.list({ page: 0, pageSize: 50 }));
  add('sales survived the restore', salesAfterRestore?.total === 2, String(salesAfterRestore?.total));

  const safety = ok(await b.backup.inspect({ path: restored.safetyBackup.path }));
  add('the safety copy holds the replaced data',
      safety?.ok === true && safety.contents.products === 6, JSON.stringify(safety?.contents));

  // --- Offline enforcement (spec §4, §83) -------------------------------------
  //
  // The one place in this project that deliberately attempts a network request:
  // proving the block works needs something for it to block. The Node side then
  // confirms the session counted the refusals, so this cannot pass merely because
  // the test machine has no internet.
  const reachOut = async (url) => {
    try {
      await window.fetch(url, { cache: 'no-store' });
      return 'reached';
    } catch (err) {
      return 'blocked';
    }
  };
  add('renderer cannot reach a public host',
      (await reachOut('https://example.com/')) === 'blocked');
  add('renderer cannot reach a host on this machine',
      (await reachOut('http://127.0.0.1:9/')) === 'blocked');

  return checks;
})()
`;
