import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMoneyFormatter } from '../hooks/useSettings';
import { PosApiError } from '@shared/errors';
import { formatInstant } from '@shared/datetime';

/**
 * Every change to cash in hand, newest first: what came in or went out, where
 * it came from, and the balance after it. A count by hand shows what the drawer
 * was found to be over or short.
 */
export default function CashHistoryDialog({ onClose }: { onClose: () => void }) {
  const money = useMoneyFormatter();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  const history = useQuery({
    queryKey: ['cashHistory', page, pageSize],
    queryFn: () => api.banking.cashHistory({ page, pageSize }),
  });
  const rows = history.data?.rows ?? [];

  return (
    <Dialog open fullWidth maxWidth="lg" onClose={onClose}>
      <DialogTitle>Cash in hand history</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {history.isError && (
          <Alert severity="error" sx={{ m: 2 }}>
            {history.error instanceof PosApiError ? history.error.message : 'Unable to load the history.'}
          </Alert>
        )}
        <TableContainer>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>Date and time</TableCell>
                <TableCell>Source</TableCell>
                <TableCell>Notes</TableCell>
                <TableCell align="right">In</TableCell>
                <TableCell align="right">Out</TableCell>
                <TableCell align="right">Balance</TableCell>
                <TableCell>By</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {history.isLoading && (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!history.isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                    Cash in hand has not been counted or changed yet.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => {
                const isCount = row.source === 'Cash count';
                return (
                  <TableRow key={row.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatInstant(row.countedAt)}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        variant={isCount ? 'outlined' : 'filled'}
                        color={row.source === 'Reversal' ? 'warning' : isCount ? 'default' : 'primary'}
                        label={row.source}
                      />
                    </TableCell>
                    <TableCell sx={{ color: row.notes ? 'text.primary' : 'text.disabled' }}>
                      {row.notes ?? '—'}
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{ color: 'success.main', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
                    >
                      {row.change > 0 ? `+${money(row.change)}` : ''}
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{ color: 'error.main', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
                    >
                      {row.change < 0 ? `−${money(-row.change)}` : ''}
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
                    >
                      {money(row.balance)}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.countedByName ?? '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={history.data?.total ?? 0}
          page={page}
          onPageChange={(_e, next) => setPage(next)}
          rowsPerPage={pageSize}
          onRowsPerPageChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(0);
          }}
          rowsPerPageOptions={[25, 50, 100]}
        />
      </DialogContent>
      <DialogActions>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, pl: 1 }}>
          For a cash count, In / Out is how much the drawer was found over or short.
        </Typography>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
