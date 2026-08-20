import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import VisibilityIcon from '@mui/icons-material/Visibility';
import PrintIcon from '@mui/icons-material/Print';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useDebounced } from '../hooks/useDebounced';
import { useMoneyFormatter } from '../hooks/useSettings';
import SaleDetailDialog from '../components/SaleDetailDialog';
import { PosApiError } from '@shared/errors';
import ExportMenu from '../components/ExportMenu';
import {
  SALE_STATUSES,
  SALE_STATUS_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type SaleStatus,
} from '@shared/domain';
import {
  DATE_PRESETS,
  DATE_PRESET_LABELS,
  resolvePreset,
  formatInstant,
  type DatePreset,
} from '@shared/datetime';

const STATUS_COLOR: Record<SaleStatus, 'success' | 'default' | 'error' | 'warning'> = {
  COMPLETED: 'success',
  CANCELLED: 'default',
  REFUNDED: 'error',
  PARTIALLY_REFUNDED: 'warning',
};

/** Sales history (spec §44). */
export default function SalesPage() {
  const money = useMoneyFormatter();

  const [search, setSearch] = useState('');
  const [preset, setPreset] = useState<DatePreset>('THIS_MONTH');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [status, setStatus] = useState<'' | SaleStatus>('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [openSaleId, setOpenSaleId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search, 250);

  const range = useMemo(
    () => resolvePreset(preset, { from: customFrom || undefined, to: customTo || undefined }),
    [preset, customFrom, customTo],
  );

  const query = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      from: range.from,
      to: range.to,
      status: status || undefined,
      cashierId: undefined,
      customerId: undefined,
      paymentMethod: (paymentMethod || undefined) as never,
      page,
      pageSize,
    }),
    [debouncedSearch, range, status, paymentMethod, page, pageSize],
  );

  const sales = useQuery({
    queryKey: ['sales', query],
    queryFn: () => api.sales.list(query),
  });

  const rows = sales.data?.rows ?? [];

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, sale) => {
        if (sale.status === 'CANCELLED') return acc;
        return {
          count: acc.count + 1,
          net: acc.net + sale.grandTotal - sale.refundedAmount,
        };
      },
      { count: 0, net: 0 },
    );
  }, [rows]);

  const quickPrint = async (saleId: string) => {
    try {
      await api.print.sale({ saleId, format: 'RECEIPT', reprint: true, silent: false });
    } catch (err) {
      setError(err instanceof PosApiError ? err.message : 'Unable to print receipt.');
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          Sales
        </Typography>
        <ExportMenu target={{ dataset: 'SALE_LIST', query }} />
      </Stack>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {sales.isError && (
        <Alert severity="error">
          {sales.error instanceof PosApiError ? sales.error.message : 'Unable to load sales.'}
        </Alert>
      )}

      <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
          <TextField
            placeholder="Invoice, customer or phone"
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
            sx={{ maxWidth: 320 }}
          />
          <TextField
            select
            label="Period"
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value as DatePreset);
              setPage(0);
            }}
            sx={{ maxWidth: 180 }}
          >
            {DATE_PRESETS.map((option) => (
              <MenuItem key={option} value={option}>
                {DATE_PRESET_LABELS[option]}
              </MenuItem>
            ))}
          </TextField>

          {preset === 'CUSTOM' && (
            <>
              <TextField
                label="From"
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ maxWidth: 170 }}
              />
              <TextField
                label="To"
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ maxWidth: 170 }}
              />
            </>
          )}

          <TextField
            select
            label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as SaleStatus | '');
              setPage(0);
            }}
            sx={{ maxWidth: 190 }}
          >
            <MenuItem value="">All statuses</MenuItem>
            {SALE_STATUSES.map((option) => (
              <MenuItem key={option} value={option}>
                {SALE_STATUS_LABELS[option]}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="Payment"
            value={paymentMethod}
            onChange={(e) => {
              setPaymentMethod(e.target.value);
              setPage(0);
            }}
            sx={{ maxWidth: 180 }}
          >
            <MenuItem value="">Any method</MenuItem>
            {PAYMENT_METHODS.map((method) => (
              <MenuItem key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        <Stack direction="row" spacing={3} sx={{ mt: 2, color: 'text.secondary' }}>
          <Typography variant="body2">
            {range.from === range.to ? range.from : `${range.from} → ${range.to}`}
          </Typography>
          <Typography variant="body2">
            {sales.data?.total ?? 0} sale(s) found
          </Typography>
          <Typography variant="body2">
            Net on this page: <strong>{money(totals.net)}</strong> across {totals.count}
          </Typography>
        </Stack>
      </Paper>

      <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
        <TableContainer>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Invoice</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Customer</TableCell>
                <TableCell>Cashier</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell align="right">Refunded</TableCell>
                <TableCell>Payment</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sales.isLoading && (
                <TableRow>
                  <TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    Loading…
                  </TableCell>
                </TableRow>
              )}

              {!sales.isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                    No sales in this period.
                  </TableCell>
                </TableRow>
              )}

              {rows.map((sale) => (
                <TableRow
                  key={sale.id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => setOpenSaleId(sale.id)}
                >
                  <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                    {sale.invoiceNumber}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatInstant(sale.saleDate)}</TableCell>
                  <TableCell>
                    {sale.customerName}
                    {sale.customerPhone && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {sale.customerPhone}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>{sale.cashierName ?? '—'}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {money(sale.grandTotal)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: 'error.main' }}>
                    {sale.refundedAmount > 0 ? `-${money(sale.refundedAmount)}` : '—'}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={
                        sale.paymentStatus === 'PAID'
                          ? 'Paid'
                          : sale.paymentStatus === 'PARTIAL'
                            ? 'Partial'
                            : 'Unpaid'
                      }
                      color={sale.paymentStatus === 'PAID' ? 'success' : 'warning'}
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={STATUS_COLOR[sale.status]}
                      label={SALE_STATUS_LABELS[sale.status]}
                    />
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                      <Tooltip title="View">
                        <IconButton size="small" onClick={() => setOpenSaleId(sale.id)}>
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Reprint receipt">
                        <IconButton size="small" onClick={() => void quickPrint(sale.id)}>
                          <PrintIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
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

      {openSaleId && (
        <SaleDetailDialog
          saleId={openSaleId}
          onClose={() => setOpenSaleId(null)}
          onChanged={(message) => {
            setToast(message);
            void sales.refetch();
          }}
        />
      )}

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setToast(null)} sx={{ width: '100%' }}>
          {toast}
        </Alert>
      </Snackbar>
    </Stack>
  );
}
