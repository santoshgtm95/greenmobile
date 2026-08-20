import { Alert, Box, Paper, Stack, Typography } from '@mui/material';
import ConstructionIcon from '@mui/icons-material/Construction';

/**
 * Stands in for a screen whose backend phase has not been implemented yet.
 *
 * It says plainly what is not there rather than showing empty tables or fake
 * numbers, so nobody mistakes an unfinished screen for real shop data.
 */
export default function PlaceholderPage({
  title,
  phase,
  summary,
  features,
}: {
  title: string;
  phase: string;
  summary: string;
  features: string[];
}) {
  return (
    <Stack spacing={2}>
      <Typography variant="h5">{title}</Typography>
      <Alert severity="info" icon={<ConstructionIcon />}>
        Not built yet — scheduled for <strong>{phase}</strong>.
      </Alert>
      <Paper sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {summary}
        </Typography>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          This screen will provide:
        </Typography>
        <Box component="ul" sx={{ pl: 3, m: 0, color: 'text.secondary' }}>
          {features.map((feature) => (
            <li key={feature}>
              <Typography variant="body2">{feature}</Typography>
            </li>
          ))}
        </Box>
      </Paper>
    </Stack>
  );
}
