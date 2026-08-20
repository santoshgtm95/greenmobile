import { Box, Paper, Stack, Typography } from '@mui/material';
import { formatBusinessDay } from '@shared/datetime';

/**
 * One tooltip entry. Deliberately typed loosely rather than against Recharts'
 * generics: the library's TooltipContentProps<ValueType, NameType> generics
 * change shape between majors, and this component only ever reads four fields.
 * Structural typing means a Recharts payload still satisfies it.
 */
interface TooltipEntry {
  dataKey?: string | number | ((item: unknown) => unknown);
  name?: unknown;
  value?: unknown;
  color?: string;
}

export interface MoneyTooltipProps {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: unknown;
  /** Formats minor units in the shop's currency. */
  format: (minor: number) => string;
  /** Renders the label as a business day rather than printing it raw. */
  isDay?: boolean;
}

/**
 * Shared tooltip for every chart on the dashboard.
 *
 * Tooltips enhance rather than gate: the same numbers are reachable from the
 * table view, so a reader who cannot hover is never locked out.
 *
 * The swatch carries the series identity; the text stays in the theme's ink
 * colours rather than taking the series colour.
 */
export default function MoneyTooltip({
  active,
  payload,
  label,
  format,
  isDay = false,
}: MoneyTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const heading =
    isDay && typeof label === 'string' ? formatBusinessDay(label) : label != null ? String(label) : '';

  return (
    <Paper
      elevation={3}
      sx={{
        px: 1.5,
        py: 1,
        border: '1px solid',
        borderColor: 'divider',
        pointerEvents: 'none',
        minWidth: 170,
      }}
    >
      {heading && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          {heading}
        </Typography>
      )}
      <Stack spacing={0.4}>
        {payload.map((entry, index) => (
          <Stack
            key={`${String(entry.dataKey ?? index)}`}
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center' }}
          >
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: '2px',
                bgcolor: entry.color,
                flexShrink: 0,
              }}
            />
            <Typography variant="body2" sx={{ flexGrow: 1 }}>
              {String(entry.name ?? '')}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {format(Number(entry.value ?? 0))}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}
