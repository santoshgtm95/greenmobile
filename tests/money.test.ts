/**
 * Money is the one thing a POS may never get wrong (spec §69).
 */
import { describe, it, expect } from 'vitest';
import {
  parseMoney,
  toMinor,
  toMajor,
  addMoney,
  subtractMoney,
  multiplyMoney,
  rateOf,
  taxFromInclusive,
  allocateProportionally,
  formatMoney,
  formatRate,
  parseRate,
  MoneyError,
} from '../shared/money';

describe('parsing amounts', () => {
  it('converts decimal input to minor units', () => {
    expect(parseMoney('310.00')).toBe(31000);
    expect(parseMoney('310')).toBe(31000);
    expect(parseMoney('0.05')).toBe(5);
    expect(parseMoney('1,250.75')).toBe(125075);
    expect(parseMoney(1250.75)).toBe(125075);
  });

  it('rounds a third decimal place rather than truncating it', () => {
    expect(parseMoney('1.005')).toBe(101);
    expect(parseMoney('1.004')).toBe(100);
  });

  it('handles negatives, used by refunds and adjustments', () => {
    expect(parseMoney('-25.50')).toBe(-2550);
  });

  it('returns null for input that is not an amount', () => {
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('1.2.3')).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney(Number.NaN)).toBeNull();
  });

  it('throws from toMinor so trusted callers cannot silently pass junk', () => {
    expect(() => toMinor('abc')).toThrow(MoneyError);
  });

  it('rejects amounts beyond the safe integer range', () => {
    expect(() => toMinor('99999999999999')).toThrow(MoneyError);
  });
});

describe('arithmetic', () => {
  it('adds without floating point drift', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; in minor units it is exact.
    expect(addMoney(parseMoney('0.1')!, parseMoney('0.2')!)).toBe(30);
    expect(toMajor(addMoney(10, 20))).toBe(0.3);
  });

  it('adds a long list of amounts exactly', () => {
    const cents = Array.from({ length: 1000 }, () => 1);
    expect(addMoney(...cents)).toBe(1000);
  });

  it('subtracts and multiplies', () => {
    expect(subtractMoney(31000, 1000)).toBe(30000);
    expect(multiplyMoney(1000, 3)).toBe(3000);
  });

  it('refuses a fractional quantity', () => {
    expect(() => multiplyMoney(1000, 1.5)).toThrow(MoneyError);
  });
});

describe('tax', () => {
  it('applies an exclusive rate in basis points', () => {
    expect(rateOf(10000, 700)).toBe(700); // 7% of 100.00
    expect(rateOf(3100000, 700)).toBe(217000); // 7% of 31,000.00
    expect(rateOf(10000, 0)).toBe(0);
  });

  it('rounds tax half up', () => {
    // 7% of 0.07 = 0.0049 → 0.00; of 0.08 = 0.0056 → 0.01
    expect(rateOf(7, 700)).toBe(0);
    expect(rateOf(8, 700)).toBe(1);
  });

  it('splits an inclusive price into net and tax that add back up', () => {
    const { net, tax } = taxFromInclusive(10700, 700);
    expect(net).toBe(10000);
    expect(tax).toBe(700);
    expect(net + tax).toBe(10700);
  });

  it('never loses a unit when splitting an awkward inclusive amount', () => {
    for (const gross of [1, 3, 7, 99, 12345, 999999]) {
      const { net, tax } = taxFromInclusive(gross, 700);
      expect(net + tax).toBe(gross);
    }
  });

  it('treats a zero rate as a no-op', () => {
    expect(taxFromInclusive(12345, 0)).toEqual({ net: 12345, tax: 0 });
  });
});

describe('proportional allocation', () => {
  it('spreads a basket discount across lines and loses nothing', () => {
    const parts = allocateProportionally(1000, [3000, 2000, 5000]);
    expect(parts).toEqual([300, 200, 500]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('gives rounding remainders away so the parts always sum to the total', () => {
    const parts = allocateProportionally(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
  });

  it('handles a total of one minor unit across many lines', () => {
    const parts = allocateProportionally(1, [1, 1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('returns zeros when there is nothing to allocate', () => {
    expect(allocateProportionally(0, [1, 2])).toEqual([0, 0]);
    expect(allocateProportionally(500, [0, 0])).toEqual([0, 0]);
  });
});

describe('formatting', () => {
  it('formats with grouping and two decimals', () => {
    expect(formatMoney(3100000, 'THB')).toBe('31,000.00');
    expect(formatMoney(5, 'THB')).toBe('0.05');
    expect(formatMoney(-2550, 'THB')).toBe('-25.50');
  });

  it('drops decimals for currencies that do not use them', () => {
    expect(formatMoney(3100000, 'JPY')).toBe('31,000');
    expect(formatMoney(150, 'JPY')).toBe('2');
    expect(formatMoney(149, 'JPY')).toBe('1');
  });

  it('can append the currency code', () => {
    expect(formatMoney(100000, 'MMK', { withSymbol: true })).toBe('1,000.00 MMK');
  });

  it('formats and parses rates', () => {
    expect(formatRate(700)).toBe('7%');
    expect(formatRate(725)).toBe('7.25%');
    expect(formatRate(0)).toBe('0%');
    expect(parseRate('7')).toBe(700);
    expect(parseRate('7.5')).toBe(750);
    expect(parseRate('7.25%')).toBe(725);
    expect(parseRate('abc')).toBeNull();
  });
});
