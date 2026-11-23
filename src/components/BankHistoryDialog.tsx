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
  Typography,
} from '@mui/material';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import SearchIcon from '@mui/icons-material/Search';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMoneyFormatter } from '../hooks/useSettings';
import { useDebounced } from '../hooks/useDebounced';
import { PosApiError } from '@shared/errors';
import { formatInstant } from '@shared/datetime';
import { MovementDialog } from './MovementParts';
import { historyTableSx } from './historyTableSx';

type Direction = '' | 'IN' | 'OUT';

/**
 * Every movement in the "In the banks" balance, newest first: what came in or
 * went out, through which account, and the total across all banks after it.
 */
export default function BankHistoryDialog({ onClose }: { onClose: () => void }) {
  const money = useMoneyFormatter();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');
  const [direction, setDirection] = useState<Direction>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const debouncedSearch = useDebounced(search.trim(), 300);

  const query = {
    page,
    pageSize,
    search: debouncedSearch || undefined,
    source: source || undefined,
    direction: direction || undefined,
    from: from || undefined,
    to: to || undefined,
  };
  const history = useQuery({
    queryKey: ['bankHistory', query],
    queryFn: () => api.banking.bankHistory(query),
    placeholderData: (previous) => previous,
  });
  const rows = history.data?.rows ?? [];
  const filtered = Boolean(debouncedSearch || source || direction || from || to);

  // Every filter change starts again from the first page.
  const set =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(0);
    };

  return (
    <MovementDialog
      title="Bank history"
      subtitle="Every movement in and out of the banks, with the total after it"
      icon={<AccountBalanceIcon />}
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
              placeholder="Search notes, account, reference or person"
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
              label="Source"
              value={source}
              onChange={(e) => set(setSource)(e.target.value)}
              sx={{ minWidth: 190 }}
            >
              <MenuItem value="">All sources</MenuItem>
              {(history.data?.sources ?? []).map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="In / Out"
              value={direction}
              onChange={(e) => set(setDirection)(e.target.value as Direction)}
              sx={{ minWidth: 120 }}
            >
              <MenuItem value="">Both</MenuItem>
              <MenuItem value="IN">In only</MenuItem>
              <MenuItem value="OUT">Out only</MenuItem>
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
            {filtered && (
              <Button
                size="small"
                onClick={() => {
                  setSearch('');
                  setSource('');
                  setDirection('');
                  setFrom('');
                  setTo('');
                  setPage(0);
                }}
                sx={{ whiteSpace: 'nowrap' }}
              >
                Clear
              </Button>
            )}
          </Stack>

          <Paper sx={historyTableSx}>
            <TableContainer sx={{ maxHeight: '55vh' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>Date and time</TableCell>
                    <TableCell>Source</TableCell>
                    <TableCell>Account</TableCell>
                    <TableCell>Reference</TableCell>
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
                      <TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                        Loading…
                      </TableCell>
                    </TableRow>
                  )}
                  {!history.isLoading && rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                        {filtered
                          ? 'Nothing matches these filters.'
                          : 'No money has moved through the banks yet.'}
                      </TableCell>
                    </TableRow>
                  )}
                  {rows.map((row) => {
                    const isOpening = row.source === 'Opening balance';
                    return (
                      <TableRow key={`${row.source}-${row.id}`} hover>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatInstant(row.at)}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            variant={isOpening ? 'outlined' : 'filled'}
                            color={row.source === 'Reversal' ? 'warning' : isOpening ? 'default' : 'primary'}
                            label={row.source}
                          />
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.account}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap', color: 'text.secondary' }}>
                          {row.reference || '—'}
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
                          sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
                        >
                          {money(row.balance)}
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.byName ?? '—'}</TableCell>
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
          </Paper>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, pl: 1 }}>
          Balance is all bank accounts together; the newest row matches “In the banks”.
        </Typography>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </MovementDialog>
  );
}
