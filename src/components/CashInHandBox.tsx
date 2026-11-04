import { Chip, Stack, Typography } from '@mui/material';
import LocalAtmIcon from '@mui/icons-material/LocalAtm';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMoneyFormatter } from '../hooks/useSettings';
import { businessDay } from '@shared/datetime';

/**
 * Cash in hand right now, shown when Cash is chosen. `spend` (money going
 * out of the drawer) is flagged when it is more than the drawer holds.
 */
export default function CashInHandBox({ spend }: { spend?: number }) {
  const money = useMoneyFormatter();
  const today = businessDay();
  const overview = useQuery({
    queryKey: ['bankingOverview', today, today],
    queryFn: () => api.banking.overview({ from: today, to: today }),
  });
  const cash = overview.data?.cashInHand.amount ?? 0;
  const short = overview.isSuccess && spend !== undefined && spend > cash;

  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        alignItems: 'center',
        p: 1.5,
        bgcolor: 'action.hover',
        borderRadius: 1,
        border: '1px solid',
        borderColor: short ? 'error.main' : 'divider',
      }}
    >
      <LocalAtmIcon color="action" />
      <Typography variant="body2" color={short ? 'error' : undefined} sx={{ flexGrow: 1 }}>
        {short ? `Not enough cash in hand for ${money(spend)}` : 'Cash in hand'}
      </Typography>
      <Chip
        size="small"
        variant="outlined"
        label={overview.isSuccess ? money(cash) : '…'}
        color={short ? 'error' : cash > 0 ? 'success' : 'default'}
        sx={{ fontWeight: 600 }}
      />
    </Stack>
  );
}
