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
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined';
import PeopleOutlinedIcon from '@mui/icons-material/PeopleOutlined';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useMoneyFormatter } from '../hooks/useSettings';
import { useDebounced } from '../hooks/useDebounced';
import BankingTabs from '../components/BankingTabs';
import SummaryCard from '../components/SummaryCard';
import AccountSide from '../components/AccountSide';
import AdvanceDetailDialog from '../components/AdvanceDetailDialog';
import BankTransactionDialog from '../components/BankTransactionDialog';
import { PosApiError } from '@shared/errors';
import { formatInstant } from '@shared/datetime';
import { BANK_ADVANCE_STATUS_LABELS, type BankAdvanceStatus } from '@shared/domain';
import type { BankAdvance } from '@shared/api';

type StatusFilter = BankAdvanceStatus | 'ALL';

/**
 * Customer advances — money a customer leaves with the shop to collect later,
 * all at once or in parts.
 *
 * A customer transfers 3,000,000 in on the 3rd, collects 1,000,000 on the 10th,
 * and the remaining 2,000,000 another day. Each step is a real movement with its
 * own accounts, amount and fee, recorded in the Transactions tab like any other;
 * this screen ties them together and keeps the running figure.
 *
 * "Held for customers" is the number that matters most here: it is how much of
 * the money in the shop's accounts is not the shop's.
 */
export default function AdvancesPage() {
  const { can } = useAuth();
  const money = useMoneyFormatter();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  // Open first: the advances somebody is about to come in for.
  const [status, setStatus] = useState<StatusFilter>('OPEN');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const [opening, setOpening] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<BankAdvance | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search, 250);

  const query = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      status: status === 'ALL' ? undefined : status,
      page,
      pageSize,
    }),
    [debouncedSearch, status, page, pageSize],
  );

  const advances = useQuery({
    queryKey: ['bankAdvances', query],
    queryFn: () => api.banking.listAdvances(query),
  });

  const accounts = useQuery({
    queryKey: ['bankAccounts', 'active'],
    queryFn: () => api.banking.listAccounts({ includeInactive: false }),
  });

  /** An advance changes the Transactions tab too — its steps are movements. */
  const refresh = () => {
    for (const key of ['bankAdvances', 'bankAdvance', 'bankTransactions', 'bankingOverview', 'bankAccounts']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
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
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpening(true)}>
            New Advance
          </Button>
        )}
      </Stack>

      <BankingTabs active="advances" />

      {advances.isError && (
        <Alert severity="error">
          {advances.error instanceof PosApiError
            ? advances.error.message
            : 'Unable to load advances.'}
        </Alert>
      )}

      {/* The same grid as the Transactions strip, so the cards line up across tabs. */}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
        }}
      >
        <SummaryCard
          label="Held for customers"
          value={money(advances.data?.heldTotal ?? 0)}
          caption="Still to be collected, every open advance"
          icon={<SavingsOutlinedIcon fontSize="small" />}
          tone="warning"
        />
        <SummaryCard
          label="Open advances"
          value={String(advances.data?.openCount ?? 0)}
          caption="Customers with money still to collect"
          icon={<PeopleOutlinedIcon fontSize="small" />}
        />
      </Box>

      <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
        {/* Fixed widths, as on the Transactions tab: left to flex, the select
            stretched across the whole row and the search was clipped. */}
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
          <TextField
            placeholder="Search customer, number or note"
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
            sx={{ width: 320 }}
          />
          <TextField
            select
            label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StatusFilter);
              setPage(0);
            }}
            sx={{ width: 180 }}
          >
            <MenuItem value="OPEN">{BANK_ADVANCE_STATUS_LABELS.OPEN}</MenuItem>
            <MenuItem value="SETTLED">{BANK_ADVANCE_STATUS_LABELS.SETTLED}</MenuItem>
            <MenuItem value="ALL">All advances</MenuItem>
          </TextField>
        </Stack>
      </Paper>

      <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
        <TableContainer>
          <Table size="small" sx={{ '& th, & td': { px: 1.25 } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>Number</TableCell>
                <TableCell>Deposited on</TableCell>
                <TableCell>Customer</TableCell>
                <TableCell>Held in</TableCell>
                <TableCell align="right">Deposited</TableCell>
                <TableCell align="right">Withdrawn</TableCell>
                <TableCell align="right">Remaining</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {advances.isLoading && (
                <TableRow>
                  <TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!advances.isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                    {status === 'OPEN'
                      ? 'No customer is holding money with the shop right now.'
                      : 'No advances match these filters.'}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  hover
                  onClick={() => setViewing(row.id)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12.5, whiteSpace: 'nowrap' }}>
                    {row.transactionNumber}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {formatInstant(row.transactionDate)}
                  </TableCell>
                  <TableCell>
                    <AccountSide
                      accountName={row.fromAccountName}
                      accountKey={row.fromAccountKey}
                      accountNumber={row.fromAccountNumber}
                      typedName={row.fromName}
                    />
                  </TableCell>
                  <TableCell>
                    <AccountSide
                      accountName={row.toAccountName}
                      accountKey={row.toAccountKey}
                      accountNumber={row.toAccountNumber}
                      typedName={row.toName}
                    />
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {money(row.amount)}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                      color: row.withdrawn === 0 ? 'text.disabled' : 'text.secondary',
                    }}
                  >
                    {row.withdrawn === 0 ? '—' : money(row.withdrawn)}
                    {row.withdrawalCount > 0 && (
                      <Typography variant="caption" sx={{ display: 'block' }}>
                        {row.withdrawalCount} withdrawal{row.withdrawalCount === 1 ? '' : 's'}
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
                      label={BANK_ADVANCE_STATUS_LABELS[row.status]}
                    />
                  </TableCell>
                  <TableCell align="right">
                    {canManage && row.status === 'OPEN' && (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={(e) => {
                          // The row opens the detail; this button goes straight
                          // to the form, which is what the counter usually wants.
                          e.stopPropagation();
                          setWithdrawing(row);
                        }}
                      >
                        Withdraw
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

      {opening && (
        <BankTransactionDialog
          accounts={accounts.data ?? []}
          mode={{ kind: 'advance' }}
          onClose={() => setOpening(false)}
          onSaved={() => {
            setOpening(false);
            setToast('Advance recorded.');
            refresh();
          }}
        />
      )}

      {withdrawing && (
        <BankTransactionDialog
          accounts={accounts.data ?? []}
          mode={{ kind: 'withdraw', advance: withdrawing }}
          onClose={() => setWithdrawing(null)}
          onSaved={() => {
            setWithdrawing(null);
            setToast('Withdrawal recorded.');
            refresh();
          }}
        />
      )}

      {viewing && !withdrawing && (
        <AdvanceDetailDialog
          advanceId={viewing}
          canWithdraw={canManage}
          onWithdraw={(advance) => setWithdrawing(advance)}
          onClose={() => setViewing(null)}
        />
      )}

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={3000}
        onClose={() => setToast(null)}
        message={toast}
      />
    </Stack>
  );
}
