import { Box, Paper, Stack, Typography } from '@mui/material';

/**
 * One headline figure: an icon and label, the number, and a line saying what it
 * counts.
 *
 * Shared by the Banking screens so a total looks the same wherever it appears —
 * same size, same tabular digits, same colour for money in and money out.
 */
export default function SummaryCard({
  label,
  value,
  caption,
  icon,
  tone,
  action,
}: {
  label: string;
  value: string;
  caption: string;
  icon: React.ReactNode;
  tone?: 'success' | 'error' | 'warning';
  action?: React.ReactNode;
}) {
  return (
    <Paper
      sx={{
        p: 2,
        border: '1px solid',
        borderColor: 'divider',
        // The grid decides the width; minWidth 0 lets a long figure shrink its
        // column rather than pushing the whole row wider than the page.
        minWidth: 0,
      }}
    >
      {/*
        Fixed height, because a card carrying an IconButton has a taller header
        than one that does not — which pushed its figure a few pixels down and
        broke the baseline across the row.
      */}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', height: 30 }}>
        <Box sx={{ color: tone ? `${tone}.main` : 'text.secondary', display: 'flex' }}>{icon}</Box>
        <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
          {label}
        </Typography>
        {action}
      </Stack>
      <Typography
        variant="h5"
        sx={{
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: tone ? `${tone}.main` : 'text.primary',
          mt: 0.5,
        }}
      >
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {caption}
      </Typography>
    </Paper>
  );
}
