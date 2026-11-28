import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
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
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import UndoIcon from '@mui/icons-material/Undo';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import SummaryCard from '../components/SummaryCard';
import { historyTableSx } from '../components/historyTableSx';
import { PageHeader, SummaryPanel, TableCardHeader, cardGrid } from '../components/PageLayout';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useDebounced } from '../hooks/useDebounced';
import { useMoneyFormatter } from '../hooks/useSettings';
import SaleDetailDialog from '../components/SaleDetailDialog';
import { PosApiError } from '@shared/errors';
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
  formatBusinessDay,
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
  const { can } = useAuth();
  const navigate = useNavigate();

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

  // Period figures come from the reports, so only users who may see reports get them.
  const summary = useQuery({
    queryKey: ['salesSummary', range],
    queryFn: () => api.reports.sales(range),
    enabled: can('reports.view'),
  });
  const sum = summary.data;
  const dates = range.from === range.to ? formatBusinessDay(range.from) : `${formatBusinessDay(range.from)} — ${formatBusinessDay(range.to)}`;

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
      <PageHeader
        title="Sales"
        subtitle="Every sale rung up, with refunds, receipts and reprints"
        actions={
          <>
            <TextField
              select
              size="small"
              label="Period"
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value as DatePreset);
                setPage(0);
              }}
              sx={{ width: 150 }}
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
                  size="small"
                  label="From"
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={{ width: 145 }}
                />
                <TextField
                  size="small"
                  label="To"
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={{ width: 145 }}
                />
              </>
            )}
            {can('pos.sell') && (
              <Button variant="contained" startIcon={<PointOfSaleIcon />} onClick={() => navigate('/pos')}>
                New sale
              </Button>
            )}
          </>
        }
      />

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

      {can('reports.view') && (
        <SummaryPanel tint title="This period" caption={`${dates} · cancelled sales left out`}>
          <Box sx={{ ...cardGrid, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' } }}>
            <SummaryCard
              label="Net sales"
              value={money(sum?.netSales ?? 0)}
              caption="After discounts, before tax"
              icon={<TrendingUpIcon fontSize="small" />}
              tone="success"
            />
            <SummaryCard
              label="Sales"
              value={String(sum?.transactions ?? 0)}
              caption={sum?.transactions ? `Average ${money(Math.round(sum.netSales / sum.transactions))}` : 'No sales yet'}
              icon={<ReceiptLongOutlinedIcon fontSize="small" />}
            />
            <SummaryCard
              label="Items sold"
              value={String(sum?.itemsSold ?? 0)}
              caption={sum?.discounts ? `${money(sum.discounts)} given in discounts` : 'No discounts given'}
              icon={<Inventory2OutlinedIcon fontSize="small" />}
            />
            <SummaryCard
              label="Refunds"
              value={money(sum?.refunds ?? 0)}
              caption={(sum?.refunds ?? 0) > 0 ? 'Money given back to customers' : 'Nothing refunded'}
              icon={<UndoIcon fontSize="small" />}
              tone={(sum?.refunds ?? 0) > 0 ? 'error' : undefined}
            />
          </Box>
        </SummaryPanel>
      )}

      <Paper sx={historyTableSx}>
        <TableCardHeader
          title="Sales"
          caption={`${sales.data?.total ?? 0} found · ${dates} · net on this page ${money(totals.net)} across ${totals.count}`}
        >
          <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
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
              sx={{ flex: '1 1 260px' }}
            />
            <TextField
              select
              label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as SaleStatus | '');
                setPage(0);
              }}
              sx={{ width: 170 }}
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
              sx={{ width: 170 }}
            >
              <MenuItem value="">Any method</MenuItem>
              {PAYMENT_METHODS.map((method) => (
                <MenuItem key={method} value={method}>
                  {PAYMENT_METHOD_LABELS[method]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </TableCardHeader>
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
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {search || status || paymentMethod ? 'No sales match these filters.' : 'No sales in this period.'}
                    </Typography>
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
                    {sale.hasGift === 1 && <Chip size="small" color="success" label="Gift" sx={{ ml: 1, fontFamily: 'inherit' }} />}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatInstant(sale.saleDate)}</TableCell>
                  <TableCell>
                    <Box sx={{ fontWeight: 600 }}>{sale.customerName}</Box>
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
                        <IconButton size="small" aria-label={`View ${sale.invoiceNumber}`} onClick={() => setOpenSaleId(sale.id)}>
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Reprint receipt">
                        <IconButton size="small" aria-label={`Reprint ${sale.invoiceNumber}`} onClick={() => void quickPrint(sale.id)}>
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
            // A refund or cancel changes the period figures too.
            if (can('reports.view')) void summary.refetch();
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
