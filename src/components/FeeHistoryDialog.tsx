import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  DialogActions,
  DialogContent,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
} from '@mui/material';
import PercentIcon from '@mui/icons-material/Percent';
import SearchIcon from '@mui/icons-material/Search';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMoneyFormatter } from '../hooks/useSettings';
import { useDebounced } from '../hooks/useDebounced';
import { PosApiError } from '@shared/errors';
import { formatInstant } from '@shared/datetime';
import { formatRate } from '@shared/money';
import { MovementDialog } from './MovementParts';
import { historyTableSx } from './historyTableSx';

/**
 * The fees behind the "Fees received" or "Fees paid" card, newest first.
 * Opens on the page's period so its total matches the card.
 */
export default function FeeHistoryDialog({
  direction,
  from: initialFrom,
  to: initialTo,
  onClose,
}: {
  direction: 'RECEIVE' | 'PAY';
  from: string;
  to: string;
  onClose: () => void;
}) {
  const money = useMoneyFormatter();
  const received = direction === 'RECEIVE';
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const debouncedSearch = useDebounced(search.trim(), 300);

  const query = {
    direction,
    page,
    pageSize,
    search: debouncedSearch || undefined,
    kind: kind || undefined,
    from: from || undefined,
    to: to || undefined,
  };
  const history = useQuery({
    queryKey: ['feeHistory', query],
    queryFn: () => api.banking.feeHistory(query),
    placeholderData: (previous) => previous,
  });
  const rows = history.data?.rows ?? [];
  const tone = received ? 'success.main' : 'error.main';

  // Every filter change starts again from the first page.
  const set =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(0);
    };

  return (
    <MovementDialog
      title={received ? 'Fees received history' : 'Fees paid history'}
      subtitle={received ? 'Commission the shop earned' : 'Charges taken by the banks and wallets'}
      icon={<PercentIcon />}
      onClose={onClose}
      maxWidth="lg"
    >
      <DialogContent dividers>
        <Stack spacing={2}>
          {history.isError && (
            <Alert severity="error">
              {history.error instanceof PosApiError ? history.error.message : 'Unable to load the history.'}
            </Alert>
          )}

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: 'center' }}>
            <TextField
              size="small"
              placeholder="Search number, name or note"
              value={search}
              onChange={(e) => set(setSearch)(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{ flex: 1, minWidth: 220 }}
            />
            <TextField
              select
              size="small"
              label="Type"
              value={kind}
              onChange={(e) => set(setKind)(e.target.value)}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="">All types</MenuItem>
              {(history.data?.kinds ?? []).map((k) => (
                <MenuItem key={k} value={k}>
                  {k}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              type="date"
              label="From"
              value={from}
              onChange={(e) => set(setFrom)(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: 160 }}
            />
            <TextField
              size="small"
              type="date"
              label="To"
              value={to}
              onChange={(e) => set(setTo)(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: 160 }}
            />
            <Chip
              color={received ? 'success' : 'error'}
              variant="outlined"
              label={`${history.data?.total ?? 0} · ${received ? '' : '−'}${money(history.data?.feeTotal ?? 0)}`}
              sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
            />
          </Stack>

          <Paper sx={historyTableSx}>
            <TableContainer sx={{ maxHeight: '55vh' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>Date and time</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Number</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell align="right">Percent</TableCell>
                    <TableCell align="right">Fee</TableCell>
                    <TableCell>Notes</TableCell>
                    <TableCell>By</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {history.isLoading && (
                    <TableRow>
                      <TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                        Loading…
                      </TableCell>
                    </TableRow>
                  )}
                  {!history.isLoading && rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                        No fees match these filters.
                      </TableCell>
                    </TableRow>
                  )}
                  {rows.map((row) => (
                    <TableRow key={row.id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatInstant(row.date)}</TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" color="primary" label={row.kind} />
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {row.reference}
                      </TableCell>
                      <TableCell>{row.party ?? '—'}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {money(row.amount)}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
                      >
                        {formatRate(row.feeBasisPoints)}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{ color: tone, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
                      >
                        {received ? '' : '−'}
                        {money(row.feeAmount)}
                      </TableCell>
                      <TableCell sx={{ color: row.notes ? 'text.primary' : 'text.disabled' }}>
                        {row.notes ?? '—'}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.recordedByName ?? '—'}</TableCell>
                    </TableRow>
                  ))}
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
          </Paper>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </MovementDialog>
  );
}
