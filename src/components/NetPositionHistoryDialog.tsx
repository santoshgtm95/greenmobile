import { useState } from 'react';
import {
  Alert,
  DialogContent,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMoneyFormatter } from '../hooks/useSettings';
import { PosApiError } from '@shared/errors';
import { businessDay, formatBusinessDay } from '@shared/datetime';
import { MovementDialog } from './MovementParts';
import { historyTableSx } from './historyTableSx';

const num = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;

/** Day by day: end-of-day balances and advances, and that day's fees and charges. */
export default function NetPositionHistoryDialog({ onClose }: { onClose: () => void }) {
  const money = useMoneyFormatter();
  const signed = (minor: number) => (minor < 0 ? `−${money(Math.abs(minor))}` : money(minor));
  const [to, setTo] = useState(businessDay());
  const [from, setFrom] = useState(() => businessDay(new Date(Date.now() - 29 * 86_400_000)));

  const history = useQuery({
    queryKey: ['dailyPositions', from, to],
    queryFn: () => api.banking.dailyPositions({ from, to }),
    enabled: Boolean(from && to && from <= to),
    placeholderData: (previous) => previous,
  });

  // Day amount, with the end-of-day total under it in brackets.
  const withTotal = (day: number, total: number) => (
    <>
      {money(day)}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        ({money(total)})
      </Typography>
    </>
  );

  return (
    <MovementDialog
      title="Net position history"
      subtitle="Banks + cash in hand + shop advances to collect − held for customers"
      icon={<HistoryIcon />}
      onClose={onClose}
      maxWidth="xl"
    >
      <DialogContent dividers>
        <Stack spacing={2}>
          {history.isError && (
            <Alert severity="error">
              {history.error instanceof PosApiError ? history.error.message : 'Unable to load the history.'}
            </Alert>
          )}
          <Stack direction="row" spacing={1.5}>
            <TextField size="small" type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 160 }} />
            <TextField size="small" type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 160 }} />
          </Stack>
          <Paper sx={historyTableSx}>
            <TableContainer sx={{ maxHeight: '60vh' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
                    <TableCell align="right">In the banks</TableCell>
                    <TableCell align="right">Cash in hand</TableCell>
                    <TableCell align="right">Advances received from customer (held)</TableCell>
                    <TableCell align="right">Advances pay from shop (to collect)</TableCell>
                    <TableCell align="right">Fees received</TableCell>
                    <TableCell align="right">Fees paid</TableCell>
                    <TableCell align="right">Bank charges</TableCell>
                    <TableCell align="right">Profit</TableCell>
                    <TableCell align="right">Net position</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {history.isLoading && (
                    <TableRow>
                      <TableCell colSpan={10} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                        Loading…
                      </TableCell>
                    </TableRow>
                  )}
                  {(history.data ?? []).map((r) => {
                    const profit = r.feeReceived - (r.feePaid + r.bankCharges);
                    return (
                      <TableRow key={r.day} hover>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatBusinessDay(r.day)}</TableCell>
                        <TableCell align="right" sx={num}>{signed(r.bank)}</TableCell>
                        <TableCell align="right" sx={num}>{signed(r.cash)}</TableCell>
                        <TableCell align="right" sx={num}>{withTotal(r.customerAdvanceIn, r.customerAdvanceHeld)}</TableCell>
                        <TableCell align="right" sx={num}>{withTotal(r.shopAdvanceOut, r.shopAdvanceOutstanding)}</TableCell>
                        <TableCell align="right" sx={{ ...num, color: 'success.main' }}>{money(r.feeReceived)}</TableCell>
                        <TableCell align="right" sx={{ ...num, color: 'error.main' }}>{money(r.feePaid)}</TableCell>
                        <TableCell align="right" sx={{ ...num, color: 'error.main' }}>{money(r.bankCharges)}</TableCell>
                        <TableCell align="right" sx={{ ...num, fontWeight: 700, color: profit < 0 ? 'error.main' : 'success.main' }}>
                          {signed(profit)}
                        </TableCell>
                        <TableCell align="right" sx={{ ...num, fontWeight: 700 }}>
                          {signed(r.bank + r.cash + r.shopAdvanceOutstanding - r.customerAdvanceHeld)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Stack>
      </DialogContent>
    </MovementDialog>
  );
}
