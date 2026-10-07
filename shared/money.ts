/**
 * Money handling for the whole application.
 *
 * RULE: money is an integer number of MINOR UNITS (satang, pyas, cents…).
 * 310.00 is stored, added and compared as 31000. No amount is ever held in a
 * float, so 0.1 + 0.2 problems cannot reach an invoice or a profit report.
 *
 * Percentages are integer BASIS POINTS: 700 == 7.00%.
 *
 * Only the display layer converts to a decimal string, and only at the very
 * last step (formatMoney).
 */
import type { BankFeeDirection, BankTransactionType } from './domain';

/** Number of decimal places a currency is quoted in. */
export const CURRENCY_DECIMALS: Record<string, number> = {
  THB: 2,
  USD: 2,
  MMK: 2,
  JPY: 0,
  EUR: 2,
  GBP: 2,
  SGD: 2,
  MYR: 2,
  VND: 0,
  KHR: 2,
  LAK: 2,
  IDR: 2,
  PHP: 2,
  INR: 2,
  BDT: 2,
  AED: 2,
};

export const DEFAULT_CURRENCY = 'THB';

/**
 * Minor units are always stored at scale 2 regardless of the display currency,
 * so switching the shop currency never rescales historical records.
 */
export const MINOR_SCALE = 2;
const MINOR_FACTOR = 100;

/** Guard rail: ~90 billion major units. Keeps all intermediate maths exact. */
export const MAX_MINOR = 9_000_000_000_000;

export class MoneyError extends Error {}

function assertSafeMinor(value: number, what: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new MoneyError(`${what} must be an integer number of minor units, got ${value}`);
  }
  if (Math.abs(value) > MAX_MINOR) {
    throw new MoneyError(`${what} is out of range`);
  }
  return value;
}

/** Rounds half-away-from-zero, the convention shoppers expect on a receipt. */
function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Parses user input ("1,250.75", "1250.75", 1250.75) into minor units.
 * Returns null when the text is not a valid amount, so callers can show a
 * validation message rather than silently treating it as zero.
 */
export function parseMoney(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return assertSafeMinor(roundHalfUp(input * MINOR_FACTOR), 'amount');
  }
  const cleaned = input.replace(/[\s,_]/g, '');
  if (!/^-?\d*(\.\d*)?$/.test(cleaned) || cleaned === '' || cleaned === '-' || cleaned === '.') {
    return null;
  }
  const negative = cleaned.startsWith('-');
  const [whole, fraction = ''] = cleaned.replace('-', '').split('.');
  // Take one extra digit so we can round rather than truncate.
  const padded = (fraction + '000').slice(0, MINOR_SCALE + 1);
  const scaled = Number(whole || '0') * MINOR_FACTOR * 10 + Number(padded || '0');
  const minor = roundHalfUp(scaled / 10);
  return assertSafeMinor(negative ? -minor : minor, 'amount');
}

/** Like parseMoney but throws instead of returning null. For trusted callers. */
export function toMinor(input: string | number): number {
  const value = parseMoney(input);
  if (value === null) throw new MoneyError(`"${input}" is not a valid amount`);
  return value;
}

/** Minor units to a plain number of major units. Display and export only. */
export function toMajor(minor: number): number {
  return assertSafeMinor(minor, 'amount') / MINOR_FACTOR;
}

export function addMoney(...amounts: number[]): number {
  let total = 0;
  for (const amount of amounts) total += assertSafeMinor(amount, 'amount');
  return assertSafeMinor(total, 'total');
}

export function subtractMoney(a: number, b: number): number {
  return assertSafeMinor(assertSafeMinor(a, 'amount') - assertSafeMinor(b, 'amount'), 'total');
}

/** Multiplies an amount by a whole quantity. */
export function multiplyMoney(minor: number, quantity: number): number {
  assertSafeMinor(minor, 'amount');
  if (!Number.isInteger(quantity)) {
    throw new MoneyError(`quantity must be a whole number, got ${quantity}`);
  }
  return assertSafeMinor(minor * quantity, 'total');
}

/** Applies a basis-point rate, e.g. taxOf(10000, 700) === 700 (7% of 100.00). */
export function rateOf(minor: number, basisPoints: number): number {
  assertSafeMinor(minor, 'amount');
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new MoneyError(`rate must be a non-negative integer of basis points, got ${basisPoints}`);
  }
  return assertSafeMinor(roundHalfUp((minor * basisPoints) / 10_000), 'tax');
}

/**
 * Splits a tax-INCLUSIVE amount into its net and tax parts.
 * net = gross * 10000 / (10000 + rate); tax = gross - net.
 */
export function taxFromInclusive(gross: number, basisPoints: number): { net: number; tax: number } {
  assertSafeMinor(gross, 'amount');
  if (basisPoints === 0) return { net: gross, tax: 0 };
  const net = roundHalfUp((gross * 10_000) / (10_000 + basisPoints));
  return { net, tax: subtractMoney(gross, net) };
}

/** Percentage discount on an amount, as basis points. */
export function percentageDiscount(minor: number, basisPoints: number): number {
  return rateOf(minor, basisPoints);
}

/**
 * What actually changed hands once the fee is taken into account.
 *
 * A fee RECEIVED is on top of the amount, so more money moved than the amount
 * says; a fee PAID comes out of it, so less did. Both figures matter to a shop
 * and neither can be worked out from the other without knowing which way the
 * fee went — which is why the direction is recorded rather than the fee being
 * stored as a signed number.
 *
 *   1,000,000 with a 5,000 fee received → 1,005,000
 *   1,000,000 with a 5,000 fee paid     →   995,000
 *
 * Derived, never stored: both operands are already on the row, so there is
 * nothing here that could drift out of step with them.
 */
export function amountAfterFee(
  amount: number,
  fee: number,
  direction: BankFeeDirection,
  type: BankTransactionType = 'TRANSFER',
): number {
  if (type === 'RECEIVE') {
    return direction === 'RECEIVE' ? subtractMoney(amount, fee) : addMoney(amount, fee);
  }
  return direction === 'RECEIVE' ? addMoney(amount, fee) : subtractMoney(amount, fee);
}

/**
 * Distributes a sale-level amount (a whole-basket discount) across lines in
 * proportion to their value, giving any rounding remainder to the largest
 * lines so the parts always add back up to the whole.
 */
export function allocateProportionally(total: number, weights: number[]): number[] {
  assertSafeMinor(total, 'amount');
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0 || total === 0) return weights.map(() => 0);

  const exact = weights.map((w) => (total * w) / weightSum);
  const floored = exact.map((v) => Math.floor(v));
  let remainder = total - floored.reduce((a, b) => a + b, 0);

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const result = [...floored];
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) {
    result[order[k].i] += 1;
  }
  return result;
}

export function decimalsFor(currency: string): number {
  return CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2;
}

/**
 * Formats minor units for display, e.g. formatMoney(3100000, 'THB') → "31,000.00".
 * Currencies quoted without decimals (JPY, VND) are rounded to whole units.
 */
export function formatMoney(
  minor: number,
  currency: string = DEFAULT_CURRENCY,
  options: { withSymbol?: boolean; grouping?: boolean } = {},
): string {
  const { withSymbol = false, grouping = true } = options;
  assertSafeMinor(minor, 'amount');
  const decimals = decimalsFor(currency);

  const negative = minor < 0;
  let abs = Math.abs(minor);
  if (decimals < MINOR_SCALE) {
    const factor = 10 ** (MINOR_SCALE - decimals);
    abs = roundHalfUp(abs / factor) * factor;
  }

  const whole = Math.floor(abs / MINOR_FACTOR);
  const fraction = abs % MINOR_FACTOR;

  const wholeText = grouping ? whole.toLocaleString('en-US') : String(whole);
  const fractionText =
    decimals > 0 ? '.' + String(fraction).padStart(MINOR_SCALE, '0').slice(0, decimals) : '';

  const text = `${negative ? '-' : ''}${wholeText}${fractionText}`;
  return withSymbol ? `${text} ${currency.toUpperCase()}` : text;
}

/** Basis points to a human string: 700 → "7%", 725 → "7.25%". */
export function formatRate(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100);
  const fraction = basisPoints % 100;
  if (fraction === 0) return `${whole}%`;
  return `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}%`;
}

/** Parses "7", "7.5", "7.25%" into basis points. Returns null when invalid. */
export function parseRate(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null;
  const text = String(input).replace('%', '').trim();
  if (!/^\d*(\.\d*)?$/.test(text) || text === '' || text === '.') return null;
  const [whole, fraction = ''] = text.split('.');
  const padded = (fraction + '000').slice(0, 3);
  const bp = roundHalfUp((Number(whole || '0') * 1000 + Number(padded)) / 10);
  if (bp < 0 || bp > 1_000_000) return null;
  return bp;
}
