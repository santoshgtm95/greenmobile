import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
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
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import CallReceivedIcon from '@mui/icons-material/CallReceived';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import LocalAtmIcon from '@mui/icons-material/LocalAtm';
import PendingActionsOutlinedIcon from '@mui/icons-material/PendingActionsOutlined';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import AssignmentReturnOutlinedIcon from '@mui/icons-material/AssignmentReturnOutlined';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useMoneyFormatter } from '../hooks/useSettings';
import { useDebounced } from '../hooks/useDebounced';
import BankingTabs from '../components/BankingTabs';
import SummaryCard from '../components/SummaryCard';
import ShopAdvanceDialog from '../components/ShopAdvanceDialog';
import ShopAdvanceReceiveDialog from '../components/ShopAdvanceReceiveDialog';
import ShopAdvanceDetailDialog from '../components/ShopAdvanceDetailDialog';
import { PosApiError } from '@shared/errors';
import { formatInstant, businessDay } from '@shared/datetime';
import { SHOP_ADVANCE_STATUS_LABELS, type ShopAdvanceStatus } from '@shared/domain';
import type { ShopAdvance } from '@shared/api';

type StatusFilter = ShopAdvanceStatus | 'ALL';

export default function ShopAdvancesPage() {
  const { can } = useAuth();
  const money = useMoneyFormatter();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('OPEN');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const [opening, setOpening] = useState(false);
  const [receiving, setReceiving] = useState<ShopAdvance | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search, 250);

  const query = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      status,
      page,
      pageSize,
    }),
    [debouncedSearch, status, page, pageSize],
  );

  const advances = useQuery({
    queryKey: ['shopAdvances', query],
    queryFn: () => api.banking.listShopAdvances(query),
  });

  const shopAccounts = useQuery({
    queryKey: ['shopBankAccounts', 'active'],
    queryFn: () => api.banking.listShopAccounts({ includeInactive: false }),
  });

  const today = businessDay();
  const overview = useQuery({
    queryKey: ['bankingOverview', today, today],
    queryFn: () => api.banking.overview({ from: today, to: today }),
  });

  const cashInHandAmount = overview.data?.cashInHand.amount ?? 0;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['shopAdvances'] });
    void queryClient.invalidateQueries({ queryKey: ['shopAdvance'] });
    void queryClient.invalidateQueries({ queryKey: ['shopBankAccounts'] });
    void queryClient.invalidateQueries({ queryKey: ['bankingOverview'] });
  };

  const rows = advances.data?.rows ?? [];
  const canManage = can('banking.manage');

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          Banking
        </Typography>
        {canManage && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setOpening(true)}
          >
            New Advance
          </Button>
        )}
      </Stack>

      <BankingTabs active="shop-advances" />

      {advances.isError && (
        <Alert severity="error">
          {advances.error instanceof PosApiError
            ? advances.error.message
            : 'Unable to load shop advances.'}
        </Alert>
      )}

      {/* Summary Cards */}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
        }}
      >
        <SummaryCard
          label="Outstanding to Collect"
          value={money(advances.data?.outstandingTotal ?? 0)}
          caption="Uncollected advance balance"
          icon={<PendingActionsOutlinedIcon fontSize="small" />}
          tone="warning"
        />
        <SummaryCard
          label="Total Advanced"
          value={money(advances.data?.totalAdvanced ?? 0)}
          caption="Total shop funds advanced"
          icon={<TrendingUpIcon fontSize="small" />}
        />
        <SummaryCard
          label="Total Received Back"
          value={money(advances.data?.totalReceived ?? 0)}
          caption="Repayments collected so far"
          icon={<AssignmentReturnOutlinedIcon fontSize="small" />}
          tone="success"
        />
        <SummaryCard
          label="Open Advances"
          value={String(advances.data?.openCount ?? 0)}
          caption="Advances currently awaiting settlement"
          icon={<CheckCircleOutlineIcon fontSize="small" />}
        />
      </Box>

      {/* Filter and Search Bar */}
      <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
          <TextField
            placeholder="Search recipient, number, bank or note"
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
            sx={{ width: { xs: '100%', md: 340 } }}
          />

          <TextField
            select
            label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StatusFilter);
              setPage(0);
            }}
            sx={{ width: { xs: '100%', md: 180 } }}
          >
            <MenuItem value="OPEN">Open (Outstanding)</MenuItem>
            <MenuItem value="SETTLED">Settled</MenuItem>
            <MenuItem value="ALL">All Advances</MenuItem>
          </TextField>
        </Stack>
      </Paper>

      {/* Main Table */}
      <Paper sx={{ border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Advance #</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Recipient</TableCell>
                <TableCell>From (Source)</TableCell>
                <TableCell>To (Destination)</TableCell>
                <TableCell align="right">Advanced</TableCell>
                <TableCell align="right">Received</TableCell>
                <TableCell align="right">Remaining</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {advances.isLoading && (
                <TableRow>
                  <TableCell colSpan={10} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!advances.isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                    {status === 'OPEN'
                      ? 'No open shop advances.'
                      : 'No advances match the current filter.'}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  hover
                  onClick={() => setViewingId(row.id)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12.5, whiteSpace: 'nowrap' }}>
                    {row.advanceNumber}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {formatInstant(row.advanceDate)}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {row.recipientName}
                    </Typography>
                    {row.recipientPhone && (
                      <Typography variant="caption" color="text.secondary">
                        {row.recipientPhone}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.fromType === 'CASH' ? (
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <LocalAtmIcon fontSize="small" color="action" />
                        <span>Cash</span>
                      </Stack>
                    ) : (
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <AccountBalanceIcon fontSize="small" color="primary" />
                        <span>
                          <strong>{row.fromBankKey || row.fromBankName}</strong> ({row.fromAccountNumber})
                        </span>
                      </Stack>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.toType === 'CASH' ? (
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <LocalAtmIcon fontSize="small" color="action" />
                        <span>Cash</span>
                      </Stack>
                    ) : (
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <AccountBalanceIcon fontSize="small" color="action" />
                        <span>
                          {row.toBankName ? `${row.toBankName} · ` : ''}
                          {row.toAccountNumber}
                        </span>
                      </Stack>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {money(row.amount)}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                      color: row.received === 0 ? 'text.disabled' : 'success.main',
                    }}
                  >
                    {row.received === 0 ? '—' : money(row.received)}
                    {row.settlementCount > 0 && (
                      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                        {row.settlementCount} payment{row.settlementCount === 1 ? '' : 's'}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                      fontWeight: 700,
                      color: row.remaining > 0 ? 'warning.main' : 'text.disabled',
                    }}
                  >
                    {money(row.remaining)}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant={row.status === 'OPEN' ? 'filled' : 'outlined'}
                      color={row.status === 'OPEN' ? 'warning' : 'success'}
                      label={SHOP_ADVANCE_STATUS_LABELS[row.status]}
                    />
                  </TableCell>
                  <TableCell align="right">
                    {canManage && (row.status === 'OPEN' || row.remaining > 0) && (
                      <Button
                        size="small"
                        variant="contained"
                        color="success"
                        startIcon={<CallReceivedIcon />}
                        onClick={(e) => {
                          e.stopPropagation();
                          setReceiving(row);
                        }}
                      >
                        Receive
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={advances.data?.total ?? 0}
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

      {/* New Advance Dialog */}
      {opening && (
        <ShopAdvanceDialog
          shopAccounts={shopAccounts.data ?? []}
          cashInHandAmount={cashInHandAmount}
          onClose={() => setOpening(false)}
          onSaved={() => {
            setOpening(false);
            setToast('Shop advance recorded.');
            refresh();
          }}
        />
      )}

      {/* Receive Dialog */}
      {receiving && (
        <ShopAdvanceReceiveDialog
          advance={receiving}
          shopAccounts={shopAccounts.data ?? []}
          onClose={() => setReceiving(null)}
          onSaved={() => {
            setReceiving(null);
            setToast('Repayment recorded.');
            refresh();
          }}
        />
      )}

      {/* Detail Dialog */}
      {viewingId && (
        <ShopAdvanceDetailDialog
          advanceId={viewingId}
          onClose={() => setViewingId(null)}
          onReceive={(advance) => {
            setViewingId(null);
            setReceiving(advance);
          }}
          onDeleted={() => {
            setViewingId(null);
            setToast('Advance deleted.');
            refresh();
          }}
        />
      )}

      {/* Toast Notification */}
      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        message={toast}
      />
    </Stack>
  );
}
