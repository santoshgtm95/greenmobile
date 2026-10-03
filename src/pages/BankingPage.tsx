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
import AddIcon from '@mui/icons-material/Add';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import CallMadeIcon from '@mui/icons-material/CallMade';
import CallReceivedIcon from '@mui/icons-material/CallReceived';
import PaymentsIcon from '@mui/icons-material/Payments';
import PercentIcon from '@mui/icons-material/Percent';
import CalculateOutlinedIcon from '@mui/icons-material/CalculateOutlined';
import EditIcon from '@mui/icons-material/Edit';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useMoneyFormatter } from '../hooks/useSettings';
import { useDebounced } from '../hooks/useDebounced';
import ExportMenu from '../components/ExportMenu';
import BankAccountsDialog from '../components/BankAccountsDialog';
import BankTransactionDialog from '../components/BankTransactionDialog';
import CashCountDialog from '../components/CashCountDialog';
import { PosApiError } from '@shared/errors';
import {
  BANK_FEE_DIRECTION_LABELS,
  BANK_TRANSACTION_TYPES,
  BANK_TRANSACTION_TYPE_LABELS,
  type BankTransactionType,
} from '@shared/domain';
import { amountAfterFee, formatRate } from '@shared/money';
import {
  DATE_PRESETS,
  DATE_PRESET_LABELS,
  resolvePreset,
  formatBusinessDay,
  formatInstant,
  type DatePreset,
} from '@shared/datetime';
import type { BankAccountPosition, BankTransaction } from '@shared/api';

/**
 * Banking — money moved between the shop and its banks and mobile wallets.
 *
 * Every figure comes from one split, done one way (see bankingOverview): a
 * TRANSFER is money out of the account it left, a RECEIVE is money into the
 * account it arrived in, and each row is counted once. The strip at the top and
 * the line under the table therefore always agree — they did not once, and the
 * symptom was a shop seeing its own totals doubled.
 *
 * The two numbers per account answer different questions and are labelled
 * accordingly, because using one as the other is the easy mistake here:
 *
 *   In / Out / Net   what moved during the period on screen; changes with the
 *                    date filter, which is the point of the filter
 *   Balance          received less transferred across the whole history — what
 *                    is actually left in the account. Deliberately NOT filtered:
 *                    a balance that fell when somebody picked "Today" would be
 *                    read as money going missing.
 */
export default function BankingPage() {
  const { can } = useAuth();
  const money = useMoneyFormatter();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [preset, setPreset] = useState<DatePreset>('THIS_MONTH');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [type, setType] = useState('');
  const [accountId, setAccountId] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const [accountsOpen, setAccountsOpen] = useState(false);
  const [newTransactionOpen, setNewTransactionOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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
      type: (type || undefined) as BankTransactionType | undefined,
      accountId: accountId || undefined,
      includeDeleted: false,
      page,
      pageSize,
    }),
    [debouncedSearch, range, type, accountId, page, pageSize],
  );

  const transactions = useQuery({
    queryKey: ['bankTransactions', query],
    queryFn: () => api.banking.listTransactions(query),
  });

  const overview = useQuery({
    queryKey: ['bankingOverview', range],
    queryFn: () => api.banking.overview(range),
  });

  const accounts = useQuery({
    queryKey: ['bankAccounts', 'active'],
    queryFn: () => api.banking.listAccounts({ includeInactive: false }),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['bankTransactions'] });
    void queryClient.invalidateQueries({ queryKey: ['bankingOverview'] });
    void queryClient.invalidateQueries({ queryKey: ['bankAccounts'] });
  };

  const remove = useMutation({
    mutationFn: (input: { id: string; reason: string }) => api.banking.deleteTransaction(input),
    onSuccess: () => {
      setToast('The transaction was removed from the balances.');
      refresh();
    },
    onError: (err) =>
      setError(err instanceof PosApiError ? err.message : 'Unable to delete that transaction.'),
  });

  const rows = transactions.data?.rows ?? [];
  const positions = overview.data?.accounts ?? [];
  const cash = overview.data?.cashInHand;

  /**
   * Every figure on this screen goes through here.
   *
   * formatMoney writes a negative with an ASCII hyphen; the balance columns were
   * written with a typographic minus. Both on one screen looked like two
   * different kinds of number, so there is one function and one glyph.
   */
  const signed = (minor: number) =>
    minor < 0 ? `−${money(Math.abs(minor))}` : money(minor);

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          Banking
        </Typography>
        <ExportMenu target={{ dataset: 'BANK_TRANSACTION_LIST', query }} />
        {can('banking.manage') && (
          <>
            <Button startIcon={<AccountBalanceIcon />} onClick={() => setAccountsOpen(true)}>
              Banks &amp; Payments
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setNewTransactionOpen(true)}
            >
              New Transaction
            </Button>
          </>
        )}
      </Stack>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {transactions.isError && (
        <Alert severity="error">
          {transactions.error instanceof PosApiError
            ? transactions.error.message
            : 'Unable to load bank transactions.'}
        </Alert>
      )}

      {!overview.isLoading && positions.length === 0 && (
        <Alert severity="info" icon={<AccountBalanceIcon />}>
          No banks or mobile payments are registered yet.
          {can('banking.manage')
            ? ' Use Banks & Payments to add the first one — a name such as "Kanbawza" and a short key such as "Kpay".'
            : ' Ask an administrator to add them.'}
        </Alert>
      )}

      {/*
        Period totals and what the shop holds.

        A grid rather than a wrapping row. With seven cards a flex row wraps by
        whatever happens to fit — it landed as five and then two cards stretched
        to half the screen each, which read as more important than the five above
        them. Fixed columns keep every card the same size and leave the gap at
        the end, where it says nothing.
      */}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, 1fr)',
            lg: 'repeat(4, 1fr)',
          },
        }}
      >
        <SummaryCard
          label="Transferred out"
          value={signed(overview.data?.totals.transferred ?? 0)}
          caption={`${formatBusinessDay(range.from)} to ${formatBusinessDay(range.to)}`}
          icon={<CallMadeIcon fontSize="small" />}
          tone="error"
        />
        <SummaryCard
          label="Received in"
          value={signed(overview.data?.totals.received ?? 0)}
          caption={`${overview.data?.totals.count ?? 0} transaction(s) in this period`}
          icon={<CallReceivedIcon fontSize="small" />}
          tone="success"
        />
        {/*
          Fees are split by the direction of the FEE, not by the type of the
          movement carrying it: a commission earned on a transfer belongs with
          the money the shop made, not with the money it sent.
        */}
        <SummaryCard
          label="Fees received"
          value={signed(overview.data?.totals.feeReceived ?? 0)}
          caption="Commission the shop earned this period"
          icon={<PercentIcon fontSize="small" />}
          tone="success"
        />
        <SummaryCard
          label="Fees paid"
          value={signed(overview.data?.totals.feePaid ?? 0)}
          caption="Charges taken by the banks and wallets"
          icon={<PercentIcon fontSize="small" />}
          tone="error"
        />
        <SummaryCard
          label="Total actual"
          value={signed(overview.data?.totals.netAfterFees ?? 0)}
          caption="Received less transferred, fees included"
          icon={<CalculateOutlinedIcon fontSize="small" />}
        />
        <SummaryCard
          label="In the banks"
          value={signed(overview.data?.bankBalance ?? 0)}
          caption="Received less transferred, all time"
          icon={<AccountBalanceIcon fontSize="small" />}
        />
        <SummaryCard
          label="Cash in hand"
          value={cash?.recorded ? signed(cash.amount) : 'Not recorded'}
          caption={
            cash?.recorded
              ? `Counted ${formatInstant(cash.countedAt)}${cash.countedByName ? ` by ${cash.countedByName}` : ''}`
              : 'A figure you count and save'
          }
          icon={<PaymentsIcon fontSize="small" />}
          action={
            can('banking.manage') && cash ? (
              <Tooltip title={cash.recorded ? 'Update the counted figure' : 'Record a count'}>
                <IconButton size="small" onClick={() => setCashOpen(true)}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : undefined
          }
        />
      </Box>

      {/* Per-account position. */}
      {positions.length > 0 && (
        <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Bank / mobile payment</TableCell>
                  <TableCell>Key</TableCell>
                  <TableCell align="right">Received in</TableCell>
                  <TableCell align="right">Transferred out</TableCell>
                  <TableCell align="right">Net this period</TableCell>
                  <TableCell align="right">Remaining (all time)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {positions.map((account) => (
                  <AccountRow
                    key={account.accountId}
                    account={account}
                    format={signed}
                    selected={accountId === account.accountId}
                    onSelect={() => {
                      setAccountId(accountId === account.accountId ? '' : account.accountId);
                      setPage(0);
                    }}
                  />
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 1 }}>
            Click a row to filter the history below by that account. A <strong>Transfer</strong>
            counts against the account the money left and a <strong>Receive</strong> against the
            account it arrived in, so each transaction is counted once. “Remaining” ignores the date
            filter on purpose — it is what is left in the account, not what moved this period.
          </Typography>
        </Paper>
      )}

      {/* Filters. */}
      <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
          <TextField
            // Kept short enough not to be clipped at this width; the fuller
            // description is in the header of each column it searches.
            placeholder="Search number, name or note"
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
            label="Period"
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value as DatePreset);
              setPage(0);
            }}
            sx={{ width: 170 }}
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
                sx={{ width: 170 }}
              />
              <TextField
                label="To"
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ width: 170 }}
              />
            </>
          )}

          <TextField
            select
            label="Type"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(0);
            }}
            sx={{ width: 160 }}
          >
            <MenuItem value="">Both</MenuItem>
            {BANK_TRANSACTION_TYPES.map((option) => (
              <MenuItem key={option} value={option}>
                {BANK_TRANSACTION_TYPE_LABELS[option]}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="Account"
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setPage(0);
            }}
            sx={{ width: 220 }}
          >
            <MenuItem value="">All accounts</MenuItem>
            {positions.map((account) => (
              <MenuItem key={account.accountId} value={account.accountId}>
                {account.name} ({account.key})
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </Paper>

      {/* History. */}
      <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
        <TableContainer>
          {/*
            Twelve columns, so the padding is tightened rather than a column
            dropped. At the default spacing the row demanded more width than the
            page had, and the first thing pushed off the edge was the Actions
            column — which put the delete button behind a horizontal scroll for
            the one role allowed to use it. Cheaper to buy the width back here.
          */}
          <Table size="small" stickyHeader sx={{ '& th, & td': { px: 1.25 } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>Number</TableCell>
                <TableCell>Date and time</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>From</TableCell>
                <TableCell>To</TableCell>
                {/* Left to right, these four read as the calculation itself. */}
                <TableCell align="right">Amount</TableCell>
                <TableCell align="right">Percent</TableCell>
                <TableCell align="right">Fee</TableCell>
                <TableCell align="right">Actual</TableCell>
                <TableCell>Notes</TableCell>
                <TableCell>Recorded by</TableCell>
                {can('banking.delete') && <TableCell align="right">Actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {transactions.isLoading && (
                <TableRow>
                  <TableCell colSpan={12} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    Loading…
                  </TableCell>
                </TableRow>
              )}

              {!transactions.isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                    No transactions in this period.
                  </TableCell>
                </TableRow>
              )}

              {rows.map((row) => (
                <TableRow key={row.id} hover>
                  {/* One token, never broken across three lines. */}
                  <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap', fontSize: 12.5 }}>
                    {row.transactionNumber}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {formatInstant(row.transactionDate)}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={row.type === 'RECEIVE' ? 'success' : 'error'}
                      icon={
                        row.type === 'RECEIVE' ? (
                          <CallReceivedIcon sx={{ fontSize: 14 }} />
                        ) : (
                          <CallMadeIcon sx={{ fontSize: 14 }} />
                        )
                      }
                      label={BANK_TRANSACTION_TYPE_LABELS[row.type] ?? row.type}
                    />
                  </TableCell>
                  <TableCell>
                    <Side
                      accountName={row.fromAccountName}
                      accountKey={row.fromAccountKey}
                      accountNumber={row.fromAccountNumber}
                      typedName={row.fromName}
                    />
                  </TableCell>
                  <TableCell>
                    <Side
                      accountName={row.toAccountName}
                      accountKey={row.toAccountKey}
                      accountNumber={row.toAccountNumber}
                      typedName={row.toName}
                    />
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, whiteSpace: 'nowrap' }}
                  >
                    {money(row.amount)}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                      color: row.feeBasisPoints === 0 ? 'text.disabled' : 'text.secondary',
                    }}
                  >
                    {row.feeBasisPoints === 0 ? '—' : formatRate(row.feeBasisPoints)}
                  </TableCell>
                  {/*
                    The fee carries its direction in the colour and the sign, the
                    way the summary cards do: green and unsigned when the shop
                    earned it, red and negative when the shop was charged. A
                    movement with no fee shows a dash rather than a zero, so the
                    eye skips it.
                  */}
                  <TableCell
                    align="right"
                    sx={{
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                      color:
                        row.feeAmount === 0
                          ? 'text.disabled'
                          : row.feeDirection === 'RECEIVE'
                            ? 'success.main'
                            : 'error.main',
                    }}
                  >
                    {row.feeAmount === 0 ? (
                      '—'
                    ) : (
                      <Tooltip
                        title={`Fee ${BANK_FEE_DIRECTION_LABELS[row.feeDirection].toLowerCase()}`}
                      >
                        <span>
                          {row.feeDirection === 'PAY'
                            ? signed(-row.feeAmount)
                            : signed(row.feeAmount)}
                        </span>
                      </Tooltip>
                    )}
                  </TableCell>
                  {/*
                    What actually changed hands: the amount plus a fee received,
                    or less a fee paid. Shown in full even with no fee — unlike
                    the two columns before it, this is never blank, because it is
                    the figure to reconcile against a statement.
                  */}
                  <TableCell
                    align="right"
                    sx={{
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                      fontWeight: row.feeAmount === 0 ? 400 : 600,
                      color: row.feeAmount === 0 ? 'text.secondary' : 'text.primary',
                    }}
                  >
                    {money(amountAfterFee(row.amount, row.feeAmount, row.feeDirection))}
                  </TableCell>
                  {/*
                    Notes wrap rather than truncate, and the column is capped so a
                    long note cannot push the amount and the actions off the edge.
                  */}
                  <TableCell
                    sx={{
                      color: row.notes ? 'text.primary' : 'text.disabled',
                      maxWidth: 260,
                      whiteSpace: 'pre-line',
                      fontSize: 13,
                    }}
                  >
                    {row.notes ?? '—'}
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>{row.createdByName ?? '—'}</TableCell>
                  {can('banking.delete') && (
                    <TableCell align="right">
                      <Tooltip title="Delete (administrators only)">
                        <IconButton
                          size="small"
                          disabled={remove.isPending}
                          onClick={() => {
                            const reason = window.prompt(
                              `Delete ${row.transactionNumber}?\n\nIt stays in the records but stops counting towards the balances. Give a reason:`,
                            );
                            if (reason && reason.trim()) {
                              setError(null);
                              remove.mutate({ id: row.id, reason: reason.trim() });
                            }
                          }}
                        >
                          <DeleteOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', px: 2 }}
        >
          <Typography variant="body2" color="text.secondary">
            Listed: {money(transactions.data?.transferTotal ?? 0)} transferred ·{' '}
            {money(transactions.data?.receiveTotal ?? 0)} received
          </Typography>
          <TablePagination
            component="div"
            count={transactions.data?.total ?? 0}
            page={page}
            onPageChange={(_e, next) => setPage(next)}
            rowsPerPage={pageSize}
            onRowsPerPageChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
            rowsPerPageOptions={[25, 50, 100]}
          />
        </Stack>
      </Paper>

      {accountsOpen && (
        <BankAccountsDialog onClose={() => setAccountsOpen(false)} onChanged={refresh} />
      )}

      {newTransactionOpen && (
        <BankTransactionDialog
          accounts={accounts.data ?? []}
          onClose={() => setNewTransactionOpen(false)}
          onSaved={() => {
            setNewTransactionOpen(false);
            setToast('Transaction recorded.');
            refresh();
          }}
        />
      )}

      {cashOpen && cash && (
        <CashCountDialog
          current={cash}
          onClose={() => setCashOpen(false)}
          onSaved={() => {
            setCashOpen(false);
            setToast('Cash in hand updated.');
            refresh();
          }}
        />
      )}

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        message={toast ?? ''}
      />
    </Stack>
  );
}

/** One of the four figures across the top. */
function SummaryCard({
  label,
  value,
  caption,
  icon,
  tone,
  action,
}: {
  label: string;
  value: string;
  caption: string;
  icon: React.ReactNode;
  tone?: 'success' | 'error';
  action?: React.ReactNode;
}) {
  return (
    <Paper
      sx={{
        p: 2,
        border: '1px solid',
        borderColor: 'divider',
        // The grid decides the width now; minWidth 0 lets a long figure shrink
        // its column rather than pushing the whole row wider than the page.
        minWidth: 0,
      }}
    >
      {/*
        Fixed height, because the card carrying an IconButton has a taller header
        than the three that do not — which pushed its figure a few pixels down and
        broke the baseline across the row.
      */}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', height: 30 }}>
        <Box sx={{ color: tone ? `${tone}.main` : 'text.secondary', display: 'flex' }}>{icon}</Box>
        <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
          {label}
        </Typography>
        {action}
      </Stack>
      <Typography
        variant="h5"
        sx={{
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: tone ? `${tone}.main` : 'text.primary',
          mt: 0.5,
        }}
      >
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {caption}
      </Typography>
    </Paper>
  );
}

function AccountRow({
  account,
  format,
  selected,
  onSelect,
}: {
  account: BankAccountPosition;
  /** The page's `signed` formatter, so one minus glyph is used throughout. */
  format: (minor: number) => string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <TableRow
      hover
      selected={selected}
      onClick={onSelect}
      sx={{ cursor: 'pointer', opacity: account.isActive ? 1 : 0.65 }}
    >
      <TableCell>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {account.name}
          </Typography>
          {account.isActive === 0 && <Chip size="small" label="Off" />}
        </Stack>
      </TableCell>
      <TableCell>
        <Chip size="small" label={account.key} sx={{ fontFamily: 'monospace', fontWeight: 600 }} />
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: 'success.main' }}>
        {format(account.received)}
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: 'error.main' }}>
        {format(account.transferred)}
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {format(account.net)}
      </TableCell>
      <TableCell
        align="right"
        sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, whiteSpace: 'nowrap' }}
      >
        {format(account.balance)}
      </TableCell>
    </TableRow>
  );
}

/**
 * One side of a movement.
 *
 * Two lines: who, then which account. The holder's name is what a shop looks for
 * when scanning the list, and the number is what it checks against a statement, so
 * both are shown — the number in a monospace face, since it is read digit by digit.
 */
function Side({
  accountName,
  accountKey,
  accountNumber,
  typedName,
}: {
  accountName: string | null;
  accountKey: string | null;
  accountNumber: string | null;
  typedName: string | null;
}) {
  return (
    <Stack spacing={0.25}>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
        <Typography
          variant="body2"
          sx={{ fontWeight: 600 }}
          color={typedName ? 'text.primary' : 'text.disabled'}
        >
          {typedName ?? '—'}
        </Typography>
        {accountKey && (
          <Chip
            size="small"
            variant="outlined"
            label={accountKey}
            sx={{ fontFamily: 'monospace', height: 20, fontSize: 11 }}
          />
        )}
      </Stack>
      {(accountNumber || accountName) && (
        <Typography variant="caption" color="text.secondary">
          <Box component="span" sx={{ fontFamily: 'monospace' }}>
            {accountNumber}
          </Box>
          {accountNumber && accountName ? ' · ' : ''}
          {accountName}
        </Typography>
      )}
    </Stack>
  );
}
