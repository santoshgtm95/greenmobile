import { describe, it, expect } from 'vitest';
import { sortOrder } from '../src/lib/tableEnhancer';

const sorted = (values: string[], dir: 'asc' | 'desc') => sortOrder(values, dir).map((i) => values[i]);

describe('table column sort', () => {
  it('sorts money as numbers, negatives and currency included, empties last', () => {
    expect(sorted(['Rs 1,200', '—', '-Rs 300', 'Rs 95.50'], 'asc')).toEqual(['-Rs 300', 'Rs 95.50', 'Rs 1,200', '—']);
    expect(sorted(['Rs 1,200', '—', '-Rs 300', 'Rs 95.50'], 'desc')).toEqual(['Rs 1,200', 'Rs 95.50', '-Rs 300', '—']);
  });

  it('sorts dd/mm/yyyy dates by the calendar, not the text', () => {
    expect(sorted(['02/01/2026 09:00', '28/12/2025', '02/01/2026 08:30'], 'asc')).toEqual([
      '28/12/2025',
      '02/01/2026 08:30',
      '02/01/2026 09:00',
    ]);
  });

  it('sorts text naturally and keeps equal rows in their order', () => {
    expect(sorted(['INV-10', 'inv-2', 'INV-1'], 'asc')).toEqual(['INV-1', 'inv-2', 'INV-10']);
    expect(sortOrder(['b', 'a', 'b'], 'desc')).toEqual([0, 2, 1]);
  });
});
