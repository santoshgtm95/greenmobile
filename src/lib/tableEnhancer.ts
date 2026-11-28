/**
 * Every table in the app gets sortable headers (click: ascending, again:
 * descending) and draggable column widths, without touching each screen.
 *
 * It works on the rendered DOM: rows are reordered in place and re-sorted
 * whenever React re-renders the table, so paged lists sort the page on screen.
 * Column widths are remembered per screen and table; double-click a column's
 * edge to reset them.
 */

type Dir = 'asc' | 'desc';

const DATE = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/;
// "1,200", "-Rs 300", "¥1,200.50", "12%", "3 units", "1,200 NPR". A dash after a
// prefix is not a sign, so codes like "INV-10" stay text.
const NUMBER = /^([-−+]?)\s*[^\d\s+\-−]{0,4}\s*(\d[\d,]*(?:\.\d+)?)\s*%?\s*[A-Za-z().]{0,10}$/;
const EMPTY = /^[—–-]*$/;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function dateKey(text: string): number | null {
  const m = DATE.exec(text);
  if (!m) return null;
  const [, d, mo, y, h = '0', mi = '0'] = m;
  return Number(y) * 1e8 + Number(mo) * 1e6 + Number(d) * 1e4 + Number(h) * 100 + Number(mi);
}

function numberKey(text: string): number | null {
  const m = NUMBER.exec(text);
  if (!m) return null;
  const value = Number(m[2].replace(/,/g, ''));
  return m[1] === '-' || m[1] === '−' ? -value : value;
}

/**
 * The order (indexes into `values`) that sorts a column's cell texts. Numbers,
 * dd/mm/yyyy dates and text are each compared as what they are; empty cells
 * ("", "—") always go last. Stable, so equal cells keep their order.
 */
export function sortOrder(values: string[], dir: Dir): number[] {
  const filled = values.filter((v) => !EMPTY.test(v));
  const kind = filled.every((v) => dateKey(v) !== null)
    ? 'date'
    : filled.every((v) => numberKey(v) !== null)
      ? 'number'
      : 'text';
  const key = (v: string) => (kind === 'date' ? dateKey(v)! : numberKey(v)!);
  const sign = dir === 'asc' ? 1 : -1;
  return values
    .map((v, i) => i)
    .sort((a, b) => {
      const va = values[a];
      const vb = values[b];
      const ea = EMPTY.test(va);
      const eb = EMPTY.test(vb);
      if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
      return sign * (kind === 'text' ? collator.compare(va, vb) : key(va) - key(vb));
    });
}

const STYLE = `
th[data-sortable] { cursor: pointer; user-select: none; }
th[data-sortable]:hover { color: inherit; filter: brightness(0.9); }
th[data-sort="asc"]::after { content: " ▲"; font-size: 0.7em; opacity: 0.75; }
th[data-sort="desc"]::after { content: " ▼"; font-size: 0.7em; opacity: 0.75; }
table[data-cols-fixed] td, table[data-cols-fixed] th { overflow: hidden; text-overflow: ellipsis; }
.tbl-resize { position: absolute; top: 0; right: 0; width: 7px; height: 100%; cursor: col-resize; z-index: 3; touch-action: none; }
.tbl-resize::after { content: ""; position: absolute; top: 25%; bottom: 25%; right: 3px; width: 1px; background: currentColor; opacity: 0.15; }
.tbl-resize:hover::after, .tbl-resize.active::after { top: 0; bottom: 0; width: 2px; right: 2px; opacity: 0.45; }
`;

const sortState = new WeakMap<HTMLTableElement, { col: number; dir: Dir }>();
const wired = new WeakSet<Element>();

const headerCells = (table: HTMLTableElement) => {
  const rows = table.tHead?.rows;
  return rows?.length ? Array.from(rows[rows.length - 1].cells) : [];
};
const span = (row: HTMLTableRowElement) => Array.from(row.cells).reduce((n, c) => n + c.colSpan, 0);

function cellAt(row: HTMLTableRowElement, col: number): HTMLElement | null {
  let at = 0;
  for (const cell of Array.from(row.cells)) {
    if (at === col) return cell;
    at += cell.colSpan;
  }
  return null;
}

/** The cell's main line: the first line of what it shows, not its caption. */
const cellText = (cell: HTMLElement | null) => (cell?.innerText ?? '').split('\n')[0].trim();

const storageKey = (table: HTMLTableElement) =>
  `tblw:${location.hash.split('?')[0]}:${headerCells(table)
    .map((th) => th.textContent?.trim())
    .join('|')}`;

function readWidths(table: HTMLTableElement): number[] | null {
  try {
    const raw = localStorage.getItem(storageKey(table));
    return raw ? (JSON.parse(raw) as number[]) : null;
  } catch {
    return null;
  }
}

function writeWidths(table: HTMLTableElement, widths: number[] | null) {
  try {
    if (widths) localStorage.setItem(storageKey(table), JSON.stringify(widths));
    else localStorage.removeItem(storageKey(table));
  } catch {
    // Widths are a convenience; a blocked storage just means they reset.
  }
}

// shortcut: fixed layout takes widths from the first header row, so a table with two header rows resizes roughly; split it if one ever needs exact widths.
function fixWidths(table: HTMLTableElement, widths: number[]) {
  const ths = headerCells(table);
  // The last column has no width, so it soaks up what is left and the table
  // still fills its card; past the card's width, the table scrolls.
  ths.forEach((th, i) => (th.style.width = i === ths.length - 1 ? '' : `${widths[i]}px`));
  table.style.tableLayout = 'fixed';
  table.style.minWidth = `${widths.reduce((a, b) => a + b, 0)}px`;
  table.dataset.colsFixed = '1';
}

function resetWidths(table: HTMLTableElement) {
  headerCells(table).forEach((th) => (th.style.width = ''));
  table.style.tableLayout = '';
  table.style.minWidth = '';
  delete table.dataset.colsFixed;
  writeWidths(table, null);
}

function startResize(event: PointerEvent, handle: HTMLElement, table: HTMLTableElement) {
  event.preventDefault();
  event.stopPropagation();
  const ths = headerCells(table);
  const widths = ths.map((th) => th.getBoundingClientRect().width);
  const index = ths.indexOf(handle.parentElement as HTMLTableCellElement);
  if (index < 0) return;
  const startX = event.clientX;
  const startWidth = widths[index];
  fixWidths(table, widths);
  handle.classList.add('active');
  handle.setPointerCapture(event.pointerId);

  const move = (e: PointerEvent) => {
    widths[index] = Math.max(48, Math.round(startWidth + e.clientX - startX));
    fixWidths(table, widths);
  };
  const up = () => {
    handle.classList.remove('active');
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
    writeWidths(table, widths);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
}

/** Puts rows in the chosen order; rows that are not data rows (details, notes) travel with the row above. */
function applySort(table: HTMLTableElement) {
  const state = sortState.get(table);
  const ths = headerCells(table);
  if (!state || !ths.length) return;
  const columns = ths.reduce((n, th) => n + th.colSpan, 0);

  for (const body of Array.from(table.tBodies)) {
    const groups: HTMLTableRowElement[][] = [];
    for (const row of Array.from(body.rows)) {
      const isData = span(row) === columns && Array.from(row.cells).every((c) => c.colSpan === 1);
      if (isData) groups.push([row]);
      else if (groups.length) groups[groups.length - 1].push(row);
      // Rows before the first data row (a loading or empty line) stay where they are.
    }
    if (groups.length < 2) continue;
    const order = sortOrder(
      groups.map((g) => cellText(cellAt(g[0], state.col))),
      state.dir,
    );
    if (order.every((at, i) => at === i)) continue;
    for (const at of order) for (const row of groups[at]) body.appendChild(row);
  }
}

function toggleSort(table: HTMLTableElement, th: HTMLTableCellElement) {
  const col = Number(th.dataset.col);
  const current = sortState.get(table);
  sortState.set(table, { col, dir: current?.col === col && current.dir === 'asc' ? 'desc' : 'asc' });
  decorate(table);
  applySort(table);
}

/** Header wiring: sortable cells, resize handles and the sort marks. Safe to run again and again. */
function decorate(table: HTMLTableElement) {
  const state = sortState.get(table);
  let col = 0;
  for (const th of headerCells(table)) {
    th.dataset.col = String(col);
    const sorted = state?.col === col;
    col += th.colSpan;

    const label = th.textContent?.trim();
    if (label) {
      th.dataset.sortable = '1';
      if (sorted) {
        th.dataset.sort = state.dir;
        th.setAttribute('aria-sort', state.dir === 'asc' ? 'ascending' : 'descending');
      } else {
        delete th.dataset.sort;
        th.removeAttribute('aria-sort');
      }
    }

    if (!wired.has(th)) {
      wired.add(th);
      if (label) {
        if (th.tabIndex < 0) th.tabIndex = 0;
        th.addEventListener('click', (e) => {
          const target = e.target as Element;
          if (target.closest('.tbl-resize') || target.closest('input,button,a,select,textarea,label')) return;
          toggleSort(table, th);
        });
        th.addEventListener('keydown', (e) => {
          if (e.target === th && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            toggleSort(table, th);
          }
        });
      }
      if (getComputedStyle(th).position === 'static') th.style.position = 'relative';
    }

    // React may rewrite the header text and drop the handle; put it back.
    if (!th.querySelector(':scope > .tbl-resize')) {
      const handle = document.createElement('span');
      handle.className = 'tbl-resize';
      handle.setAttribute('aria-hidden', 'true');
      handle.addEventListener('pointerdown', (e) => startResize(e, handle, table));
      handle.addEventListener('click', (e) => e.stopPropagation());
      handle.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        resetWidths(table);
      });
      th.appendChild(handle);
    }
  }
}

/** Starts watching the page for tables; returns the stop function. */
export function enhanceTables(): () => void {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const seen = new WeakSet<HTMLTableElement>();
  const pass = () => {
    document.querySelectorAll<HTMLTableElement>('table.MuiTable-root').forEach((table) => {
      if (!table.tHead) return;
      if (!seen.has(table)) {
        seen.add(table);
        const widths = readWidths(table);
        if (widths && widths.length === headerCells(table).length) fixWidths(table, widths);
      }
      decorate(table);
      applySort(table);
    });
  };

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      pass();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  pass();

  return () => {
    observer.disconnect();
    style.remove();
  };
}
