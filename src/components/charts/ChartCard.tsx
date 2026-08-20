import type { ReactNode } from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';

/**
 * A chart's frame: title, optional subtitle, and a plot area sized to include
 * the x-axis band.
 *
 * The height covers plot + axis labels together, so the axis is never pushed
 * outside the card and left to a nested scrollbar.
 */
export default function ChartCard({
  title,
  subtitle,
  height = 260,
  empty,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  height?: number;
  /** Shown instead of the plot when there is nothing to draw. */
  empty?: boolean;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider', height: '100%' }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', mb: 1.5 }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
        {action}
      </Stack>

      <Box sx={{ height, width: '100%' }}>
        {empty ? (
          <Box
            sx={{
              height: '100%',
              display: 'grid',
              placeItems: 'center',
              color: 'text.secondary',
              fontSize: 13,
            }}
          >
            Nothing recorded in this period.
          </Box>
        ) : (
          children
        )}
      </Box>
    </Paper>
  );
}
