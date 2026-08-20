# Green Mobile POS

An **offline Windows desktop POS** for a mobile phone sales, accessories and repair shop.

Everything runs on one PC. After installation the application needs no internet
connection, no cloud server, no remote API, no online database, no external
authentication and no licence check.

---

## Status

The application is being built in the phases set out in the specification.
All eighteen phases are complete and verified. Every item in the specification's
feature list is built.

| Phase | Scope | State |
|-------|-------|-------|
| 1 | Project setup — Electron, React, TypeScript, Vite, Material UI, electron-builder | **Done** |
| 2 | Database — Prisma schema, migrations, SQLite runtime, backups before migration | **Done** |
| 3 | Authentication — first-run wizard, login, roles, permissions, audit log | **Done** |
| 4 | Master data — categories, brands, products, customers, users | **Done** |
| 5 | Inventory — stock, adjustments, ledger, low stock, IMEI / serials | **Done** |
| 6 | POS — search, barcode, cart, discount, tax, payment, checkout | **Done** |
| 7 | Invoice & printing — A4 invoice, 58 mm / 80 mm receipts, PDF, reprint | **Done** |
| 8 | Sales history — search, filters, detail, cancel, refund | **Done** |
| 9 | Customer history — profile, purchases, services, statistics | **Done** |
| 10 | Expenses — categories, entries, summaries | **Done** |
| 11 | Service module — job sheets, diagnosis, parts, labour, payments, status | **Done** |
| 12 | Reports — sales, revenue, expenses, P&L, inventory, products, customers, services | **Done**, with Excel / CSV / PDF / print |
| 13 | Dashboard — live figures and charts | **Done** |
| 14 | Backup & restore — manual, automatic, retention, safety backup | **Done** |
| 15 | Import & export — Excel, CSV, PDF, product import with preview | **Done** |
| 16 | Security review | **Done** — the review is a test suite, see *Security* |
| 17 | Testing — unit, integration, end-to-end, offline, printing, backup | **Done** |
| 18 | Production build — installer | **Done** (installer builds and runs) |

One thing is deliberately absent rather than unfinished: the multi-PC sync in §64
and §94, which the specification lists as future preparation only.

**Beyond the specification**, at the shop's request:

| Addition | State |
|---|---|
| Banking — banks and mobile wallets registered by the shop, transfers and receipts, per-bank balances, counted cash in hand | **Done** — see *Banking* |

---

## Technology

| Layer | Choice |
|-------|--------|
| Desktop shell | Electron 43 |
| UI | React 19, TypeScript, Vite 8, Material UI 9, TanStack Query, React Hook Form, Zod, Recharts |
| Database | SQLite via better-sqlite3 (synchronous, transactional) |
| Schema definition | Prisma 7 — build-time only, see below |
| Passwords | bcrypt (bcryptjs) |
| Packaging | electron-builder → NSIS installer |

### Two notes on the stack

**Prisma is a build-time tool here, not a runtime dependency.**
`prisma/schema.prisma` is the readable, diffable source of truth for the
database, and `npm run schema:sql` uses Prisma's own migration engine to
generate `prisma/migrations/0001_initial/migration.sql`. At runtime the
application applies that SQL itself through better-sqlite3. This keeps the
schema definition exactly where the specification asks for it while avoiding
the two things that make Prisma Client painful inside a packaged Electron app:
shipping and locating the query-engine binary, and the fact that
`prisma migrate deploy` needs a Node CLI that a packaged `.exe` does not have.

Later schema changes are **new numbered folders** holding only the delta —
`0002_banking`, `0003_bank_account_number` and `0004_transaction_account_numbers`
are the first three — never an edit to a migration already applied, even when the
change corrects the one before it.
`npm run schema:sql` refuses to run once a later migration exists, because
regenerating `0001` from the current schema would put the new tables in *both*
files: a fresh install would create them twice and a shop already on the older
schema would never get them at all.

**bcrypt rather than Argon2id.** Permitted by the specification when Argon2 is
impractical in Electron. bcryptjs is pure JavaScript, so the shop's PC needs no
C++ toolchain and no rebuild against each Electron release. Work factor 12.

---

## Requirements

**To use the application:** Windows 10 or 11 (64-bit). Nothing else — no
Node.js, npm, Git, Python, .NET or database server.

**To develop it:** Node.js 20+ and npm. No C++ compiler is required:
better-sqlite3 ships Node-API prebuilt binaries that work unchanged across Node
and every Electron version.

---

## Getting started

```bash
npm install
```

If npm reports that install scripts are pending approval, allow the two Prisma
packages — they download the migration engine used by `npm run schema:sql`:

```bash
npm approve-scripts prisma @prisma/engines
```

Leave `better-sqlite3` **denied**. Its install script is `node-gyp rebuild`;
denying it makes the package use its bundled prebuilt binary, which is what you
want.

Then:

```bash
npm run dev
```

---

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Vite dev server + Electron, with main-process reload |
| `npm run build` | Builds the renderer and the main/preload bundles |
| `npm run typecheck` | Type-checks the main process and the renderer |
| `npm test` | Runs the Vitest suite against a real SQLite database |
| `npm run smoke` | Launches the built app in a throwaway data folder and drives the real bridge end to end |
| `npm run screenshot` | Seeds a throwaway shop and photographs every screen into `screenshots/` |
| `npm run schema:sql` | Regenerates `0001_initial` from `prisma/schema.prisma`. Refuses once a later migration exists — add a delta folder instead |
| `npm run dist` | Builds `MobileShopPOS-Setup.<version>.exe` |
| `npm run dist:dir` | Builds the unpacked app without an installer (faster) |

---

## Where your data lives

Nothing is stored in the installation directory, so data survives upgrades and
never hits Program Files permission problems.

```
%APPDATA%\MobileShopPOS\
├── data\
│   └── pos.db          the SQLite database (plus WAL sidecar files)
├── backups\            automatic and manual backups
├── logs\               app-YYYY-MM-DD.log, kept 30 days
├── exports\            Excel / CSV / PDF exports
├── invoices\           generated invoice PDFs
└── attachments\
```

Typically `C:\Users\<you>\AppData\Roaming\MobileShopPOS\`. The exact path is
shown in the application under **Settings**.

**To back up by hand:** close the POS, then copy the whole `MobileShopPOS`
folder. **To move to another PC:** install the POS there and copy the folder
across before first launch.

---

## Building the installer

```bash
npm run dist
```

The result is `release/MobileShopPOS-Setup.<version>.exe` (~106 MB). It creates
a desktop shortcut, a Start Menu shortcut and an uninstaller, and lets the user
choose the installation directory.

Uninstalling deliberately **keeps** `%APPDATA%\MobileShopPOS`, so removing or
reinstalling the application never destroys shop records.

To brand it, drop a 256×256 `build/icon.ico` into the project; without one
electron-builder uses the default Electron icon.

---

## Updating the application

1. Back up (or simply confirm a recent backup exists).
2. Run the new installer over the existing installation.
3. Start the application.

The database is untouched by the installer. On startup the application compares
the database's schema version with the version the build expects and, if a
migration is needed, **takes a full backup first** — written to `backups\` as
`MobileShopPOS_PreMigration_v<n>_<timestamp>.db` — before applying anything.
Each migration runs inside a transaction, so a failure rolls back rather than
leaving a half-migrated database.

---

## Backup and restore

**Settings → Backup & Restore.** Everything is local, so this screen is the only
thing standing between a failed disk and the loss of the shop's records.

| Action | What happens |
|--------|--------------|
| **Create backup** | Writes a consistent snapshot to the backup folder |
| **Back up to…** | The same, to a location you choose — a USB stick, a second disk |
| **Change backup folder** | Points automatic and manual backups at your own folder |
| **Automatic backup** | Every day, every week, or never. Keeps the last 5, 10 or 20 |
| **Restore** | Replaces the live database, after a safety copy of it is taken |

A backup is taken with SQLite's own `VACUUM INTO`, not a file copy. In WAL mode
recent commits live in a sidecar file, so copying `pos.db` alone can produce a
database missing today's sales; `VACUUM INTO` reads through the WAL and writes a
complete, compacted database.

Only **automatic** backups are ever pruned. Backups you made yourself, the copy
taken before a database update, and the safety copy taken before a restore are
all kept until you delete them.

### What a restore does

1. Opens the chosen file read-only and checks it is an intact POS database this
   version understands. A backup from a *newer* build is refused rather than
   half-migrated.
2. Shows you what is inside it — products, sales, customers, repair jobs — so
   you can tell yesterday's backup from last March's.
3. Takes a safety copy of the current database.
4. Swaps the file, migrates it if it is older than this build, and reopens it.
5. Signs you out. The restored database has its own users; sign in with the
   password that was in use when the backup was made.

If any of step 4 fails, the safety copy is put straight back and the shop is
exactly where it was. The path to that copy is in the error message and the log.

### If the database will not open at all

The application says so on startup and offers **Restore from Backup…** before
the login screen. The damaged file is kept as
`MobileShopPOS_Damaged_<timestamp>.db` rather than being thrown away — a
specialist can sometimes recover rows from it.

---

## Printing

Documents are built as self-contained HTML in the main process, rendered in a
hidden offscreen window, then handed to Electron's own print pipeline — so they
go to the printers already installed in Windows and need no external PDF
library or network access.

| | |
|---|---|
| A4 invoice | Shop details, invoice number, date, cashier, customer, line items with quantity, unit price, discount and tax, grand total, payments, amount received and change |
| Thermal receipt | 58 mm and 80 mm, sized from the shop setting, with `@page size: <width> auto` so the roll cuts at the end of the content |
| PDF | Save to the invoices folder or choose a location |
| Reprint | Marked **REPRINT** so a second copy cannot pass as the original |
| Service job sheet | Given to the customer on intake — fault, condition on arrival, estimate, deposit, signature lines |
| Service completion | Given on collection — diagnosis, parts, labour, payments and anything still owing |

Choosing a printer in the sale dialog prints straight away; leaving it on
*"Ask me"* opens the Windows print dialog. Every print and PDF export is written
to the audit log.

All text interpolated into a document is HTML-escaped, so a product or customer
name containing markup prints as characters rather than changing the layout.

---

## Architecture

```
React renderer  (no Node access at all)
      │  window.posBridge — the channels in shared/channels.ts, nothing else
      ▼
Electron preload  (contextIsolation, sandboxed)
      │  IPC
      ▼
Main process
      ├── ipc/registry.ts   authenticate → authorise → validate → run → sanitise
      ├── services/         business rules, all money maths
      ├── database/         connection, migrator, seed
      └── better-sqlite3 → SQLite
```

```
mobile-shop-pos/
├── electron/          main process
│   ├── main.ts        window, lifecycle, single-instance lock
│   ├── bootstrap.ts   startup sequence and fatal-error dialogs
│   ├── preload.ts     the bridge (envelopes only)
│   ├── session.ts     who is signed in — main process only
│   ├── ipc/           one module per feature + the handler registry
│   ├── services/      auth, settings, sequence, audit
│   ├── database/      connection, migrator, seed
│   └── utils/         paths, logger, ids, smoke test
├── shared/            used by BOTH sides: types, money, dates, validation
├── src/               React renderer
├── prisma/            schema.prisma + generated migrations
├── tests/             Vitest suites against real SQLite
└── scripts/           dev launcher, bundler, smoke runner, SQL generator
```

### Decisions worth knowing

**Money is never a float.** Every amount is an integer number of minor units
(310.00 → `31000`); tax rates are integer basis points (7% → `700`). All
arithmetic goes through `shared/money.ts`, including proportional allocation of
a basket discount across lines so the parts always sum back to the whole.

**Two kinds of timestamp.** `createdAt` and friends are UTC ISO-8601 instants,
for ordering and future sync. Business dates additionally store a local
`YYYY-MM-DD` business day, written from the shop's own clock. Reports filter and
group on the business day, so "today's sales" means the shop's today and no
timezone or daylight-saving arithmetic is involved.

**Historical values are frozen.** Sale lines keep their own `productName`,
`sku`, `unitPrice` and `unitCost`, so a later price change cannot rewrite past
profit. Cost of goods always comes from the recorded `unitCost`.

**UUID primary keys**, not auto-increment, so records created on different
machines could be merged if multi-PC or cloud sync is added later.

**Nothing is hard-coded about the shop.** Currency, tax rate and mode, receipt
width, document prefixes, low-stock threshold and negative-stock policy all come
from the `Setting` table.

---

## Service and repair

A repair job is a live document while the device is in the shop and a financial
record once it leaves. Three rules hold that together:

1. **The workflow is enforced.** Status only moves along the transitions in
   `shared/domain.ts` — a job cannot jump from *Received* to *Delivered* without
   passing through repair.
2. **Parts are real stock.** Fitting a part writes a `SERVICE_USAGE` movement
   naming the job, so the shelf count and the inventory ledger stay honest.
   Removing the line puts the stock back.
3. **Delivered means finished.** A device cannot be handed back while money is
   owing, and once delivered the job is frozen — lines and details can no longer
   be edited, though its documents can still be reprinted.

The total charged is always derived from the parts and labour lines, never typed
in, so what the customer pays equals what is itemised on the receipt. Because an
offline shop cannot text anyone, the printed job sheet and completion receipt are
the whole notification mechanism (spec §93).

---

## Reporting and the dashboard

Every trading figure is computed by SQL over the values **frozen on the sale** —
`SaleItem.unitCost`, not today's purchase price — so a supplier price change
cannot rewrite last month's profit.

| Rule | Why |
|---|---|
| Cancelled sales are excluded entirely | A cancelled sale never happened |
| Refunded quantities are netted out | `netQty = quantity - returnedQuantity`; discount and tax are apportioned by the same ratio |
| Tax is not revenue | `netSales = grossSales - discounts`; tax collected is reported separately |
| Repairs are their own income line | Labour carries no cost of goods; only parts do |

Profit and loss therefore reads: goods gross profit **+** service gross profit
**−** operating expenses = net profit.

The dashboard answers whatever period is selected — today, yesterday, this week,
month, year or a custom range (spec §72); nothing is hard-coded to today. One
filter row scopes every card and chart. Because a single day cannot draw a trend,
the by-day charts widen to a minimum of one week ending on the selected day and
say so in their subtitle; the cards still report the exact period asked for.

### Chart conventions

Charts follow a deliberate, checked set of rules rather than taste:

- **Two categorical hues only** — blue `#2a78d6` and orange `#eb6834` — validated
  against this app's actual chart surface (white): worst-pair colour-blind ΔE 24.7,
  normal-vision ΔE 33.6, both above 3:1 contrast.
- **Magnitude charts use one hue for every bar.** Shading bars darker-where-bigger
  would spend the colour channel on information the bar length already shows.
- **One y-axis, always.** No dual-scale charts — they invent correlations.
- **Every chart has a table twin** (the *Show as tables* switch), so no value is
  reachable by hover alone.
- Thin marks, hairline solid gridlines, a legend whenever there are two series,
  and axis ticks that never round away real precision.

### The eight reports

| Report | What it answers |
|---|---|
| Sales | Transactions, items, gross sales, discounts, tax, net sales, COGS, gross profit — plus breakdowns by day, product, category and payment method (§47) |
| Revenue | Revenue day by day against what it cost to earn |
| Expenses | Totals by category, by day and by payment method (§48) |
| Profit & Loss | The statement, goods and repairs separately, down to net profit (§49) |
| Inventory | Stock valuation, potential revenue and profit, low stock, out of stock (§50) |
| Products | Every product sold, ranked, with margin |
| Customers | Who spent what, net of refunds |
| Services | Every repair job, its parts cost, profit and anything owing |

Each report is **described as data** — headline figures plus typed tables — and one
renderer draws all eight while one exporter turns the same structure into Excel,
CSV, PDF or a printed page. Adding a report means describing it, not writing a
screen and four exporters.

Exports are rebuilt from the database rather than from what the screen was
holding, so a file can never disagree with the report it came from. Money reaches
Excel and CSV as **real numbers** in major units with a currency format applied —
a spreadsheet full of text that looks like money cannot be summed.

Files land in `%APPDATA%\MobileShopPOS\exports\` unless a location is chosen.

---

## Inventory

**Inventory** is the shelf; **Products** is the catalogue. Products is where names,
SKUs and prices live; Inventory is where quantities and value live, in three tabs:

| Tab | What it is for |
|---|---|
| Stock levels | Every product with its quantity, reorder point and stock value; adjust from here |
| Movement history | The full ledger — every change, with the level before and after |
| Low stock | The reorder list, furthest below its minimum first |

The ledger is the part worth knowing about. **Nothing in this application can move
stock without leaving a row in it** — a sale, a refund, a stock count, a damaged
handset, a part fitted to a repair, a spreadsheet import. Each row records the
level before and after, not just the delta, so a discrepancy between the recorded
stock and the shelf is something you can walk backwards through until you find the
movement that caused it, rather than something to argue about.

Each row also names its cause: `Sold on invoice INV-202608-0001`,
`Refund RET-202608-0001 against invoice INV-202608-0001`,
`Used on service SRV-202608-0001`, `Received 354121080000001`,
`Opening stock from import "price-list.csv"`. Handsets are recorded one at a time
with their IMEI, because a ledger that said "+2 phones" could not tell you which
two.

The tab is in the address (`/inventory/movements`), so the ledger is linkable.
Both `Stock levels` and `Low stock` apply each product's own minimum where it has
one and the shop default where it does not.

---

## Banking

**Banking** records money moved between the shop and its banks and mobile wallets.
The shop registers its own accounts, because which banks and wallets a shop uses is
local knowledge: a **name** it is known by and a short **key** that labels it in
lists and exports — *Kanbawza* with the key *Kpay*, *AYA Bank* with *AYAPay*.

**Account numbers are not registered here.** One wallet serves a different account
number on almost every payment, so the number — and the name on it — belong to the
*transaction*. A number held against the bank could only ever record one of them.

Two of those rules are one-way doors, so the screen shows them rather than only
enforcing them:

- **A key cannot be changed once the account exists.** It labels every transaction
  already recorded, so editing it would silently relabel history. The field is
  locked with a padlock, and the main process *refuses* a different key rather than
  quietly keeping the old one — a caller that thinks it renamed a key needs to be
  told it did not.
- **An account that has been used cannot be deleted.** Its delete button becomes a
  padlock the moment the first transaction is recorded; the way to retire it is to
  switch it off, which hides it from the new-transaction form and keeps its history
  and its balance. An account that has never been used deletes cleanly, and its key
  becomes available again.

A transaction is a **Transfer** (money leaving one of the shop's accounts) or a
**Receive** (money arriving in one), with a date and time defaulting to now, both
sides of the movement, an amount and a note. Each side reads **bank → account
number → name on the account**; the number and the name are required on both sides,
and are validated only for *presence*, not for shape — bank numbers, wallet numbers
and IBANs are formatted differently everywhere, and rejecting a shop's real number
for carrying a dash would be worse than accepting a typo. **Both sides may be the
same account** — moving money within one wallet, or correcting a figure inside it, is a
real movement worth recording, and it nets to zero against that account's balance. One of the shop's own accounts is
always on the side the money moved — the form marks it required and the main
process refuses without it — because that is what makes the per-account arithmetic
add up. A movement belonging to no account would raise the headline received total
while changing nobody's balance, and the two figures on the same screen would
contradict each other.

Only an **administrator** can delete a transaction, and deleting is a soft delete
with a reason: the row stays so that a balance somebody wrote down last month can
still be explained.

### The two numbers per bank are not the same number

| Column | Answers | Follows the date filter |
|---|---|---|
| Received in / Transferred out / Net this period | what moved during the period on screen | **yes** — that is the point of the filter |
| Remaining (all time) | received less transferred across the whole history, i.e. what is left in the account | **no** |

Keeping *Remaining* out of the filter is deliberate. A balance that fell when
somebody picked "Today" would read as money going missing.

**Every figure comes from one split, done one way.** A `TRANSFER` is money out of
the account it left; a `RECEIVE` is money into the account it arrived in; each row
is counted exactly once. So the strip at the top of the page always agrees with the
line under the table.

That matters because of what the two account pickers mean: they name the *provider*
on each side, not two accounts of the shop's. A customer paying by Kpay into the
shop's Kpay is one row with Kpay on both sides — and the type the shop chose on the
form is the only thing that says which way the money went. A transfer is therefore
money out even when the receiving side happens to name another registered bank.

An earlier version summed by *direction* instead — anything with a "from" account
counted as out, anything with a "to" account as in. A shop with two Kpay → Kpay
rows saw each one counted as both, and its headline totals came out doubled while
the list underneath showed the correct split. `tests/banking.test.ts` now asserts
the two are equal, so they cannot drift apart again.

### Cash in hand is counted, not calculated

The fourth figure is a number the shop records: count the drawer, save what you
counted. It is not derived from this screen, because cash also moves through sales,
refunds, expenses and service deposits — a figure calculated from the banking
ledger alone would be a guess presented as a fact. Every count is kept with who
took it and when, and the dialog shows the previous one and the difference. "Never
counted" and "counted zero" are shown differently.

Filtering uses the same presets as the rest of the application (Today, Yesterday,
This Week, This Month, This Year, Last 7 / 30 Days, Custom), and the list exports
to Excel, CSV, PDF or a printer like every other list screen.

---

## Settings

Everything configurable about the installation, in one place. The tab is in the
address (`/settings/printing`), so each panel is linkable.

| Tab | What it holds | Who can see it |
|---|---|---|
| Shop | Name, address, phone, email, logo | Manager (read-only), Admin |
| Currency & Tax | Currency, whether tax is charged, the rate, inclusive or exclusive | Manager (read-only), Admin |
| Stock | Low-stock threshold, whether the till may sell below zero | Manager (read-only), Admin |
| Printing | Receipt printer, roll width, auto-print, receipt footer | Admin |
| Numbering | The prefix on each numbered series | Admin |
| Backup & Restore | Manual backup, schedule, retention, restore | Admin |
| System | Version, database location, schema version | Manager, Admin |

A manager holds `settings.view` and sees the first three panels with every field
disabled and a line saying so. The last four are hidden rather than shown empty,
because `settings:getAll` deliberately withholds the non-public keys — a till has
no business knowing where the shop's backups live.

**Nothing saves until asked.** The button names how many fields will change, and
only those fields are sent. Saving the whole panel back would overwrite a value
another administrator changed while the screen sat open, and would fill the audit
log with "updated 6 settings" for a one-field edit.

### Three decisions worth knowing

**The counter next to each document prefix is read-only.** A counter is not a
preference: winding it back hands a second invoice the number of one a customer
already holds, and the unique index then refuses the sale — at the till, weeks
later, in a way nobody would connect to a settings screen. The number reached is
shown because it is useful to see. Changing a *prefix* is safe, and past documents
keep the number they were issued with.

**The logo is converted in the main process, not the renderer.** The renderer has
no file access by design, and Electron's `nativeImage` is the only image decoder
already in the process — so it does the reading, the downscaling to 512 px on the
long edge, and the validating. A file that is not really an image, whatever its
extension, decodes to an empty image and is refused there. The result is stored
inline in the database, so it travels with every backup and needs no separate file.

**The currency and tax panel shows its own arithmetic.** Exclusive and inclusive
tax are a genuinely confusing pair, and the difference is invisible until a total
is wrong on a customer's receipt — so the panel works a 1,000 sale through
whatever is currently selected, before it is saved.

---

## Staff accounts

**Users** holds the shop's accounts, and one rule shapes the whole screen:
**a shop must not be able to lock itself out.** There is no support line, no reset
email and no way in from outside. If the last administrator is deactivated,
demoted or deleted, then settings, backups, user management and the audit log are
gone for good on that installation — the till would keep working and the data
would still be there, but nobody could ever administer it again.

So every route to that state is refused in the main process:

| Attempt | Result |
|---|---|
| Demote the last active administrator | Refused, naming the account and what to do instead |
| Deactivate the last active administrator | Refused |
| Delete the last active administrator | Refused |
| Deactivate or delete your own account | Refused |
| …any of the above once a second administrator exists | Allowed |

That last row matters as much as the others: a guard that never lets go would
trap the first administrator in the role permanently. A *deactivated*
administrator does not count towards the total, because a locked account is not a
way back in.

The screen marks the load-bearing account with a shield, disables the controls
that would be refused, and warns while the shop has only one administrator. The
disabling is a courtesy — the boundary is the main process, and the smoke test
drives every refusal through the real bridge.

### Removing an account

Deletion is soft for the same reason it is for products: an account named on a
sale is named on it forever. So an account with any history is **deactivated** —
it can no longer sign in, and everything it did stays attributed — while an
account created by mistake, which has touched nothing, is deleted outright.

"Any history" is asked of SQLite rather than listed by hand. `PRAGMA
foreign_key_list` gives every column in the database that points at a user, so a
table added later is covered without anyone remembering to come back. The
hand-written version of that check missed four `ON DELETE RESTRICT` columns —
including `Product.createdBy` — which would have surfaced to the user as a
baffling "cannot be deleted because it is used by existing records".

### Password reset (§30)

There is no email, so an administrator is the only way back in for someone who
has forgotten their password. That makes it the action an unattended screen could
most easily be abused for, so the administrator **re-enters their own password**,
checked in the main process, and the reset is recorded in the audit log against
their account. A username can never be changed — it appears on past records.

---

## Branding

The shop mark lives at [`src/assets/logo.png`](src/assets/logo.png). Everything
derived from it is generated by
[`scripts/build-logo-assets.py`](scripts/build-logo-assets.py):

```bash
python scripts/build-logo-assets.py
```

| Output | Used for |
|---|---|
| `build/icon.ico` | Installer, desktop and Start Menu shortcuts, taskbar, packaged window |
| `build/icon.png` | The development window icon (a packaged build takes its icon from the `.exe`) |
| `shared/logo.ts` | The mark as a data URI, for the React screens and the printed documents |

**Those outputs are committed**, so `npm run build` and `npm run dist` need
neither Python nor Pillow. Re-run the script only when the source logo changes.

Three decisions worth knowing:

- **The logo is inlined, not referenced.** Printed documents are self-contained
  HTML rendered in an offscreen window from a temp directory, so a relative path
  would resolve differently in `npm run dev`, inside the asar archive and at print
  time — and the invoice would silently print with a broken image. `npm run smoke`
  checks the generated PDF for an embedded image object, which is the check that
  would catch it.
- **The icon ships seven sizes** (16–256 px), each resampled from the full
  resolution rather than from a chain of reductions. Windows uses different
  entries in Explorer, the taskbar and the installer, and its own downscaling is
  noticeably worse.
- **On dark surfaces it sits on a light tile.** The mark is a green *G* and a dark
  grey *M*; measured against the navy sidebar the grey half comes out at 3.3:1, and
  at 28 px the *M* and the circle strokes disappear so it reads as "G". Recolouring
  someone's logo is not ours to do, so it gets a backing instead.

The A4 invoice and both service documents carry it (spec §35). The thermal
receipt deliberately does not — a detailed two-tone mark dithers badly on a 58 mm
roll, and §35 asks for it on the invoice only.

`shopLogo` in Settings is the override point for a shop that wants its own mark.
It is read already and falls back to the bundled logo; only an image data URI is
accepted, and it is escaped like any other database value. Wiring up a screen for
it needs the 20,000-character cap on a setting value raised first.

---

## Security

The specification asks for a review of seven areas (Phase 16). A review is a
document that goes stale the week after it is signed, so it lives in
[`tests/security.test.ts`](tests/security.test.ts) instead — **51 tests** that
fail the build when one of its conclusions stops being true.

| Area | What is enforced | Where |
|---|---|---|
| Electron | `contextIsolation`, `sandbox`, no `nodeIntegration`, no webviews, no child windows, no navigation, no devtools in a packaged build | [`electron/security.ts`](electron/security.ts) |
| Network | Every request for anything but the app's own files is denied by the session; a CSP denies it again from inside the page | same |
| IPC | Every channel authenticated, authorised and Zod-validated before a handler runs; sender pinned to the app window | [`electron/ipc/registry.ts`](electron/ipc/registry.ts) |
| Authentication | bcrypt cost 12, no account enumeration, no default password, progressive delay on repeated failures | [`auth.service.ts`](electron/services/auth.service.ts) |
| Authorization | Role matrix asserted exhaustively, both directions | [`shared/domain.ts`](shared/domain.ts) |
| Input validation | No `z.any()`, no `passthrough()`, one argument per call, prices never accepted from the renderer | [`shared/validation.ts`](shared/validation.ts) |
| Database | Bound parameters everywhere; exactly one escaped inline literal, in one function | [`connection.ts`](electron/database/connection.ts) |
| Files | Deletes confined to the backup folders, opens confined to the invoices folder, all data under `%APPDATA%` | — |

Points worth stating plainly:

- The renderer receives no `fs`, `child_process`, `process` or database handle —
  only the channels listed in `shared/channels.ts`.
- **Exactly four channels are reachable before sign-in**: app info, auth status,
  login, and first-run setup. The suite fails if a fifth appears.
- The signed-in user lives in the main process. The renderer cannot set it, so
  hiding a button is a convenience, not the security boundary.
- There is **no default account or password**. Until the first-run wizard creates
  an administrator, nobody can sign in.
- Passwords are stored only as bcrypt hashes, are stripped from the audit log,
  and never reach the log files. A test sweeps every text column of every table
  to confirm the plaintext is nowhere in the database.
- The window cannot navigate away, open a child window, or hand a URL to the
  operating system. `shell.openExternal` appears nowhere in the codebase.
- Unexpected errors are logged in full locally and reported to the user as a
  short, friendly message — never a stack trace or a SQL fragment.

### Two independent layers keep it offline

1. **The session refuses the request.** `onBeforeRequest` cancels anything whose
   scheme is not `file:`, `blob:`, `data:` or `devtools:`, and counts the
   refusals. This is not advice to a cooperating page — it is the network stack.
2. **The page's CSP refuses it too.** `default-src 'self'` with
   `connect-src 'self'`, `form-action 'none'` and `base-uri 'none'`. The build
   strips the dev server's HMR allowance, so the shipped policy permits no
   origin at all.

`npm run smoke` proves both at runtime: a `fetch` from React is refused (layer 2
catches it first), and a navigation from a bare window with no CSP is refused by
the session with the counter incrementing (layer 1). A request failing because
the test machine happens to be offline would not satisfy either check.

Device permissions — camera, microphone, location, notifications, clipboard read
— are denied wholesale rather than allowed selectively. Certificate errors, HTTP
auth prompts and client-certificate requests are refused rather than offered a
"continue anyway".

### Failed sign-ins get slower, never locked

Repeated failures for a username add a delay, capped at four seconds, reset by a
correct password and forgotten after five minutes. It is deliberately **not** a
lockout: anyone who can reach the keyboard could otherwise shut the till, and a
denial of service against the shop is worse than a slow guess. The real rate
limiter is bcrypt itself, whose cost-12 comparison is synchronous and therefore
serialises attempts whether or not they arrive in parallel.

### Roles

| | Cashier | Manager | Admin |
|---|---|---|---|
| Sell, look things up | ✓ | ✓ | ✓ |
| Discounts, refunds, cancel | | ✓ | ✓ |
| Products, stock adjustments | view | ✓ | ✓ |
| Expenses, banking, reports | | ✓ | ✓ |
| Product import | | ✓ | ✓ |
| Users (view) | | ✓ | ✓ |
| Delete an expense or a bank transaction | | | ✓ |
| Change settings, backups, audit log, manage users | | | ✓ |

---

## Tests

```bash
npm test          # unit and integration, against real SQLite
npm run smoke     # end-to-end through the real Electron bridge
```

`npm test` runs **460 tests** over a real file-backed database created from the
same migration SQL the shipped app uses — foreign keys, transactions and
constraints all behave as in production. Nothing is mocked. It covers money
arithmetic and rounding, schema and index creation, referential integrity,
transaction rollback, password hashing, the login and first-run flows, role
permissions, and the three acceptance tests the specification names:

| Spec | Test |
|------|------|
| §80 | Buy at 800, sell 2 at 1,000 → revenue 2,000, COGS 1,600, gross profit 400, stock 8 |
| §81 | Sell an IMEI, then try to sell it again → blocked, "IMEI is already sold" |
| §82 | Refund a sale → stock +1, IMEI `RETURNED`, sale `REFUNDED`, refund and ledger records written |
| §80 | The same worked example again through the reports layer → net profit 300 after a 100 expense |

plus stock blocking, negative-stock opt-in, price trust, inclusive and exclusive
tax, proportional discount allocation, and that a failed multi-line sale writes
nothing at all and does not even consume an invoice number.

### What covers each category the spec asks for (Phase 17)

| Category | Where | Notes |
|---|---|---|
| Unit | `money`, `datetime`, document builders | Rounding, minor units, tax from inclusive prices, page geometry |
| Integration | every `*.test.ts` | All 338 run against a real file-backed SQLite database built from the shipped migration SQL; nothing is mocked |
| End-to-end | `npm run smoke` | The packaged `.exe`, driven through the real preload bridge |
| Offline | `tests/offline.test.ts` + smoke | A full trading day with no network, plus runtime proof that requests are refused |
| Printing | `tests/documents.test.ts`, `tests/offline.test.ts` | Invoice, both receipt widths, both service documents, escaping, self-containment; smoke pushes them through Chromium's print pipeline |
| Backup / restore | `tests/backup.test.ts` | 40 tests: consistent snapshots, retention, corrupt and future-version files refused, rollback on failure |
| Inventory ledger | `tests/inventory.test.ts` | 21 tests: before/after levels reconcile, every filter, per-IMEI rows, figures agree with the low-stock list |
| Staff accounts | `tests/users.test.ts` | 32 tests: every lock-out route refused and then released, soft delete, password reset |
| Branding | `tests/documents.test.ts` | The logo reaches the invoice, a hostile `shopLogo` cannot, and `build/icon.ico` really holds all seven sizes |
| Settings | `tests/settings.test.ts` | 16 tests: a partial save, per-key length limits, the logo shape, nonsense values that must not break a sale, and what a cashier is allowed to read |
| Banking | `tests/banking.test.ts` | 45 tests: an immutable account key, a used account that cannot be deleted, figures on the strip that equal the figures under the list, including for rows naming one bank on both sides, every date filter |
| Security | `tests/security.test.ts` | The Phase 16 review, as 51 assertions |

The offline test is the one worth reading: it signs in, creates and edits a
product, counts stock, creates a customer, prices a cart, takes a sale with
change, renders the invoice and receipt, refunds a line, records an expense, runs
a repair job from intake to delivery, builds four reports, takes a backup, trades
on, restores, and proves the rollback landed — all in one test, because that is
what §83 actually asks.

`npm run smoke` builds a throwaway shop in a temp folder and drives the live
bridge through **183 checks**: first-run setup, sign in and out, blocked
pre-login calls, rejected invalid payloads, creating products, scanning
barcodes, adding IMEIs, quoting a cart, completing a sale with change,
double-sale prevention, overselling, refunds, the inventory ledger, customer
history, recording then soft-deleting an expense, the whole banking cycle — registering
accounts, a refused key change, a refused delete of a used account, transfers and
receipts, per-bank balances, cash in hand and the date filters — a complete repair job from
intake through fitting a part, labour, payment and delivery, building all eight
reports and exporting them to Excel, CSV and PDF, exporting every list screen,
and importing a spreadsheet of products through preview and commit.

It finishes with the whole backup cycle end to end: take a backup, add a product,
restore, and prove the product is gone, the earlier sales survived, the session
was cleared and the safety copy holds the data that was replaced.

It also proves the offline guarantee at runtime, from both sides of it: a request
from the page and a request from outside the page, each refused by a different
layer (see *Security*).

The runner then checks from *outside* the application that every file it claimed
to write is real — `%PDF-` on the invoices and reports, `PK` on the spreadsheets,
a byte-order mark on the CSVs, and `SQLite format 3` on the backups. It renders
both document formats through Chromium's real print-to-PDF pipeline, and runs
against both the development build and the packaged `.exe`.

---

## Troubleshooting

**"Database integrity check failed" on startup.**
The database file is damaged. Restore a backup using the steps above. Backups
are in `%APPDATA%\MobileShopPOS\backups\`.

**The application will not start.**
Check the newest file in `%APPDATA%\MobileShopPOS\logs\`. The last lines say
what failed.

**A second window will not open.**
By design — one instance only, so two processes never write the same database
file. The existing window is brought to the front instead.

**`npm install` tries to compile better-sqlite3 and fails.**
Its install script is being allowed. Deny it (`npm deny-scripts better-sqlite3`)
so the bundled prebuilt binary is used; no compiler is needed.

**`electron-builder` reports "Attempting to build a module with a space in the path".**
Only relevant if `npmRebuild` is re-enabled. It is set to `false` in
`electron-builder.yml` because the Node-API prebuilds need no rebuild.

**Reports show the wrong day near midnight.**
Reports use the shop's local business day, taken from this PC's clock. Check the
Windows date, time and timezone.
