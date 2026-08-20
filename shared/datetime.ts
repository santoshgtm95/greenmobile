/**
 * Time handling for the whole application.
 *
 * Two representations, deliberately:
 *
 *   instant      UTC ISO-8601 with Z ("2026-08-10T02:41:56.393Z").
 *                Used for ordering, audit trails and future cloud sync.
 *
 *   business day Local calendar date ("2026-08-10"), computed from the shop's
 *                own clock at the moment the record is written.
 *
 * Reports filter and group on the business-day columns. That makes "today's
 * sales" mean the shop's today, keeps the comparison a plain indexed string
 * compare, and sidesteps timezone and daylight-saving arithmetic entirely.
 */

export type Instant = string;
export type BusinessDay = string;

export function nowInstant(): Instant {
  return new Date().toISOString();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local calendar date of a Date (or now) as YYYY-MM-DD. */
export function businessDay(date: Date = new Date()): BusinessDay {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local wall-clock time as HH:MM. For receipts. */
export function localTime(date: Date = new Date()): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Parses YYYY-MM-DD into a local Date at midnight. */
export function parseBusinessDay(day: BusinessDay): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function isBusinessDay(value: unknown): value is BusinessDay {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function addDays(day: BusinessDay, days: number): BusinessDay {
  const date = parseBusinessDay(day);
  date.setDate(date.getDate() + days);
  return businessDay(date);
}

/**
 * Local date and time as an <input type="datetime-local"> value: "2026-08-10T09:41".
 *
 * The browser control has no timezone, which is exactly right for a shop that
 * only ever thinks in its own wall clock. Pair with localDateTimeToInstant to
 * store it.
 */
export function nowLocalDateTime(date: Date = new Date()): string {
  return `${businessDay(date)}T${localTime(date)}`;
}

export const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function isLocalDateTime(value: unknown): value is string {
  return typeof value === 'string' && LOCAL_DATE_TIME_PATTERN.test(value);
}

/**
 * Turns "2026-08-10T09:41" into a UTC instant, reading it as the shop's own
 * wall-clock time.
 *
 * Deliberately NOT `new Date(value)`: that parses a datetime-local string as
 * local time in browsers but the same string with a "Z" would be UTC, and the
 * two disagree by hours. Constructing from the parts leaves no room for the
 * difference.
 */
export function localDateTimeToInstant(value: string): Instant {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return nowInstant();
  // Index 0 is the whole match, so it is skipped rather than parsed.
  const [, y, m, d, h, min] = match.map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0).toISOString();
}

/** The local calendar date half of a datetime-local value. */
export function localDateTimeToDay(value: string): BusinessDay {
  return isLocalDateTime(value) ? value.slice(0, 10) : businessDay();
}

/** Formats an instant for display in local time: "10/08/2026 09:41". */
export function formatInstant(instant: Instant | null | undefined): string {
  if (!instant) return '';
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Formats a business day for display: "10/08/2026". */
export function formatBusinessDay(day: BusinessDay | null | undefined): string {
  if (!day || !isBusinessDay(day)) return '';
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

// -----------------------------------------------------------------------------
// Report / dashboard date ranges
// -----------------------------------------------------------------------------

export const DATE_PRESETS = [
  'TODAY',
  'YESTERDAY',
  'THIS_WEEK',
  'THIS_MONTH',
  'THIS_YEAR',
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'CUSTOM',
] as const;

export type DatePreset = (typeof DATE_PRESETS)[number];

export interface DayRange {
  /** Inclusive. */
  from: BusinessDay;
  /** Inclusive. */
  to: BusinessDay;
}

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  TODAY: 'Today',
  YESTERDAY: 'Yesterday',
  THIS_WEEK: 'This Week',
  THIS_MONTH: 'This Month',
  THIS_YEAR: 'This Year',
  LAST_7_DAYS: 'Last 7 Days',
  LAST_30_DAYS: 'Last 30 Days',
  CUSTOM: 'Custom',
};

/**
 * Resolves a preset into an inclusive business-day range.
 * Weeks start on Monday.
 */
export function resolvePreset(
  preset: DatePreset,
  custom?: Partial<DayRange>,
  today: Date = new Date(),
): DayRange {
  const t = businessDay(today);
  switch (preset) {
    case 'TODAY':
      return { from: t, to: t };
    case 'YESTERDAY': {
      const y = addDays(t, -1);
      return { from: y, to: y };
    }
    case 'THIS_WEEK': {
      // getDay(): 0=Sunday. Shift so Monday is the first day.
      const offset = (today.getDay() + 6) % 7;
      return { from: addDays(t, -offset), to: t };
    }
    case 'THIS_MONTH':
      return { from: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`, to: t };
    case 'THIS_YEAR':
      return { from: `${today.getFullYear()}-01-01`, to: t };
    case 'LAST_7_DAYS':
      return { from: addDays(t, -6), to: t };
    case 'LAST_30_DAYS':
      return { from: addDays(t, -29), to: t };
    case 'CUSTOM': {
      const from = isBusinessDay(custom?.from) ? custom!.from! : t;
      const to = isBusinessDay(custom?.to) ? custom!.to! : t;
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

/** Every day in an inclusive range. Used to zero-fill charts. */
export function eachDay(range: DayRange, limit = 400): BusinessDay[] {
  const days: BusinessDay[] = [];
  let cursor = range.from;
  while (cursor <= range.to && days.length < limit) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** Adds N months to a date and returns the instant. Used for warranty end dates. */
export function addMonthsInstant(from: Instant, months: number): Instant {
  const date = new Date(from);
  if (Number.isNaN(date.getTime())) return from;
  const day = date.getDate();
  date.setMonth(date.getMonth() + months);
  // Clamp when the target month is shorter (31 Jan + 1 month → 28/29 Feb).
  if (date.getDate() < day) date.setDate(0);
  return date.toISOString();
}
