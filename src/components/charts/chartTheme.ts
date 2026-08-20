/**
 * Chart palette and mark specs, in one place.
 *
 * COLOUR
 *
 * Two categorical slots only — blue and orange — used for the two-series time
 * charts. Validated against this app's actual chart surface (#ffffff, MUI
 * `background.paper`) rather than assumed: worst-pair CVD ΔE 24.7 (protan),
 * normal-vision ΔE 33.6, both well clear of the 8 / 15 floors, and both above
 * 3:1 contrast on white.
 *
 * Every magnitude-comparison chart (top products, categories, payment methods)
 * uses ONE hue for all its bars. Shading bars darker-where-bigger would
 * double-encode the bar length as colour and burn the only free channel on
 * information the chart already shows.
 *
 * Profit and loss cues use the status tokens, and always ship with a word or an
 * icon beside them so colour never carries the meaning alone.
 */

export const CHART_COLORS = {
  /** Categorical slot 1 — also the single hue for magnitude bars. */
  series1: '#2a78d6',
  /** Categorical slot 2. */
  series2: '#eb6834',
  /** Status. Paired with text, never used alone. */
  positive: '#2e7d32',
  negative: '#c62828',
  /** Chrome: one step off the surface, recessive. */
  grid: '#e6e6e2',
  axis: '#c3c2b7',
  muted: '#898781',
  surface: '#ffffff',
} as const;

/** Mark specs, fixed across every chart on the dashboard. */
export const MARK = {
  /** Bars never fill their band — the leftover is deliberate air. */
  barMaxThickness: 24,
  /** Rounded at the data end, square at the baseline. */
  barRadiusColumn: [4, 4, 0, 0] as [number, number, number, number],
  barRadiusRow: [0, 4, 4, 0] as [number, number, number, number],
  lineWidth: 2,
  dotRadius: 4,
  /** Surface-coloured ring so overlapping markers stay readable. */
  dotRingWidth: 2,
  gridWidth: 1,
} as const;

/** Recharts axis styling. Ticks use tabular figures so a column of them aligns. */
export const AXIS_TICK = {
  fontSize: 11.5,
  fill: CHART_COLORS.muted,
  fontVariantNumeric: 'tabular-nums',
} as const;

/**
 * Compact money for axis ticks, where a full "1,250,000.00" would collide.
 * Values arrive in minor units.
 *
 * Keeps one decimal place rather than rounding to the nearest thousand: an axis
 * tick labels the gridline it sits on, so showing 22,500 as "23k" mislabels it.
 * A trailing ".0" is dropped so round numbers stay clean.
 */
export function compactMinor(minor: number): string {
  const major = minor / 100;
  const abs = Math.abs(major);

  const trim = (value: string) => value.replace(/\.0$/, '');

  if (abs >= 1_000_000) return `${trim((major / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${trim((major / 1_000).toFixed(1))}k`;
  return String(Math.round(major));
}

/** Shortens a long product or category name for a y-axis label. */
export function truncateLabel(value: string, max = 22): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
