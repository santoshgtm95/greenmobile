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
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import SearchIcon from '@mui/icons-material/Search';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMoneyFormatter } from '../hooks/useSettings';
import { useDebounced } from '../hooks/useDebounced';
import { PosApiError } from '@shared/errors';
import { formatBusinessDay, formatInstant } from '@shared/datetime';
import { MovementDialog } from './MovementParts';
import { historyTableSx } from './historyTableSx';

type Method = '' | 'CASH' | 'BANK';

/** Every sale in the Banking screen's period, split into cash and bank money. */
export default function BankingSalesDialog({
  range,
  onClose,
}: {
  range: { from: string; to: string };
  onClose: () => void;
}) {
  const money = useMoneyFormatter();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState<Method>('');
  const debouncedSearch = useDebounced(search.trim(), 300);

  const query = {
    ...range,
    page,
    pageSize,
    search: debouncedSearch || undefined,
    method: method || undefined,
  };
  const sales = useQuery({
    queryKey: ['bankingSales', query],
    queryFn: () => api.banking.sales(query),
    placeholderData: (previous) => previous,
  });
  const rows = sales.data?.rows ?? [];
  const totals = sales.data?.totals;
  const signed = (value: number) => (value < 0 ? `−${money(-value)}` : money(value));
  const amount = (value: number) => (value ? signed(value) : '—');

  return (
    <MovementDialog
      title="Sales history"
      subtitle={`${formatBusinessDay(range.from)} to ${formatBusinessDay(range.to)} · cash and bank money taken`}
      icon={<PointOfSaleIcon />}
      onClose={onClose}
      maxWidth="lg"
    >
      <DialogContent dividers>
        <Stack spacing={2}>
          {sales.isError && (
            <Alert severity="error">
              {sales.error instanceof PosApiError ? sales.error.message : 'Unable to load the sales.'}
            </Alert>
          )}

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: 'center' }}>
            <TextField
              size="small"
              placeholder="Search invoice or customer"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
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
              label="Paid by"
              value={method}
              onChange={(e) => {
                setMethod(e.target.value as Method);
                setPage(0);
              }}
              sx={{ minWidth: 170 }}
            >
              <MenuItem value="">Cash and bank</MenuItem>
              <MenuItem value="CASH">Took cash</MenuItem>
              <MenuItem value="BANK">Took bank money</MenuItem>
            </TextField>
          </Stack>

          <Paper sx={historyTableSx}>
            <TableContainer sx={{ maxHeight: '55vh' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>Date and time</TableCell>
                    <TableCell>Invoice / refund</TableCell>
                    <TableCell>Customer</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell align="right">Cash</TableCell>
                    <TableCell align="right">Bank</TableCell>
                    <TableCell align="right">Unpaid</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sales.isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                        Loading…
                      </TableCell>
                    </TableRow>
                  )}
                  {!sales.isLoading && rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                        No sales in this period.
                      </TableCell>
                    </TableRow>
                  )}
                  {rows.map((row) => (
                    <TableRow
                      key={`${row.kind}-${row.id}`}
                      hover
                      sx={row.kind === 'REFUND' ? { '& td.num': { color: 'error.main' } } : undefined}
                    >
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatInstant(row.date)}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <Typography sx={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 'inherit' }}>{row.number}</Typography>
                          {row.kind === 'REFUND' && <Chip size="small" color="error" label="Refund" />}
                        </Stack>
                        {row.invoiceNumber && (
                          <Typography variant="caption" color="text.secondary">
                            for {row.invoiceNumber}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{row.customerName}</TableCell>
                      <TableCell align="right" className="num" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {signed(row.total)}
                      </TableCell>
                      <TableCell align="right" className="num" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {amount(row.cash)}
                      </TableCell>
                      <TableCell align="right" className="num" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {amount(row.bank)}
                      </TableCell>
                      <TableCell align="right" sx={{ color: row.unpaid ? 'warning.dark' : undefined, fontVariantNumeric: 'tabular-nums' }}>
                        {amount(row.unpaid)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {totals && rows.length > 0 && (
                    <TableRow sx={{ '& td': { fontWeight: 700, fontVariantNumeric: 'tabular-nums', bgcolor: 'background.default' } }}>
                      <TableCell colSpan={3}>Net ({sales.data?.total ?? 0} sales and refunds)</TableCell>
                      <TableCell align="right">{signed(totals.total)}</TableCell>
                      <TableCell align="right">{signed(totals.cash)}</TableCell>
                      <TableCell align="right">{signed(totals.bank)}</TableCell>
                      <TableCell align="right">{money(totals.unpaid)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={sales.data?.total ?? 0}
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
          Refunds count on the day they were paid back. Cash is what was taken less the change given back.
        </Typography>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </MovementDialog>
  );
}
