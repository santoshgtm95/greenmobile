import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMoneyFormatter } from '../hooks/useSettings';
import { formatInstant, formatBusinessDay } from '@shared/datetime';
import type { ShopBankAccount, ShopBankAccountTransactionItem } from '@shared/api';

// ---------------------------------------------------------------------------
// Source badge colours
// ---------------------------------------------------------------------------
const SOURCE_COLORS: Record<
  ShopBankAccountTransactionItem['source'],
  'default' | 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error'
> = {
  BANK_TRANSACTION: 'primary',
  INTERNAL_TRANSFER: 'info',
  SHOP_ADVANCE: 'warning',
  SHOP_ADVANCE_SETTLEMENT: 'success',
};

const SOURCE_LABELS: Record<ShopBankAccountTransactionItem['source'], string> = {
  BANK_TRANSACTION: 'Bank Txn',
  INTERNAL_TRANSFER: 'Transfer',
  SHOP_ADVANCE: 'Advance',
  SHOP_ADVANCE_SETTLEMENT: 'Repayment',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface Props {
  account: ShopBankAccount;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ShopAccountHistoryDialog({ account, onClose }: Props) {
  const money = useMoneyFormatter();

  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');

  const historyQuery = useQuery({
    queryKey: ['shopAccountHistory', account.id, search, direction, fromDay, toDay],
    queryFn: () =>
      api.banking.getShopAccountHistory({
        id: account.id,
        search: search || undefined,
        direction: direction === 'ALL' ? undefined : direction,
        from: fromDay || undefined,
        to: toDay || undefined,
      }),
  });

  const data = historyQuery.data;
  const rows = data?.transactions ?? [];

  return (
    <Dialog open fullWidth maxWidth="xl" onClose={onClose}>
      {/* ---------------------------------------------------------------- */}
      {/* Title                                                             */}
      {/* ---------------------------------------------------------------- */}
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        <AccountBalanceWalletIcon color="primary" />
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" component="span">
            Transaction History
          </Typography>
          <Typography
            variant="body2"
            component="span"
            sx={{ ml: 1, color: 'text.secondary' }}
          >
            {account.bankName} · {account.accountNumber} · {account.accountName}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ p: 2 }}>
        <Stack spacing={2}>
          {/* ---------------------------------------------------------------- */}
          {/* Summary chips                                                     */}
          {/* ---------------------------------------------------------------- */}
          {data && (
            <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1.5 }}>
              <StatChip label="Opening Balance" value={money(data.openingBalance)} color="default" />
              <StatChip label="Total In" value={`+${money(data.totalIn)}`} color="success" />
              <StatChip label="Total Out" value={`-${money(data.totalOut)}`} color="error" />
              <StatChip
                label="Net"
                value={`${data.net >= 0 ? '+' : '-'}${money(Math.abs(data.net))}`}
                color={data.net >= 0 ? 'success' : 'error'}
              />
              <StatChip label="Current Balance" value={money(data.currentBalance)} color="primary" />
            </Stack>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Filters                                                           */}
          {/* ---------------------------------------------------------------- */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: 'center' }}>
            <TextField
              size="small"
              placeholder="Search reference, type, from, to…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ flex: 1, minWidth: 200 }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />

            <ToggleButtonGroup
              size="small"
              exclusive
              value={direction}
              onChange={(_, val: 'ALL' | 'IN' | 'OUT' | null) => {
                if (val) setDirection(val);
              }}
            >
              <ToggleButton value="ALL">All</ToggleButton>
              <ToggleButton value="IN">
                <ArrowDownwardIcon fontSize="small" sx={{ mr: 0.5 }} />
                In
              </ToggleButton>
              <ToggleButton value="OUT">
                <ArrowUpwardIcon fontSize="small" sx={{ mr: 0.5 }} />
                Out
              </ToggleButton>
            </ToggleButtonGroup>

            <TextField
              size="small"
              type="date"
              label="From date"
              value={fromDay}
              onChange={(e) => setFromDay(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: 160 }}
            />
            <TextField
              size="small"
              type="date"
              label="To date"
              value={toDay}
              onChange={(e) => setToDay(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: 160 }}
            />
            {(fromDay || toDay || search || direction !== 'ALL') && (
              <Button
                size="small"
                onClick={() => {
                  setSearch('');
                  setDirection('ALL');
                  setFromDay('');
                  setToDay('');
                }}
              >
                Clear
              </Button>
            )}
          </Stack>

          {/* ---------------------------------------------------------------- */}
          {/* Table                                                             */}
          {/* ---------------------------------------------------------------- */}
          {historyQuery.isPending ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress />
            </Box>
          ) : (
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 520 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ minWidth: 110 }}>Date</TableCell>
                    <TableCell sx={{ minWidth: 120 }}>Reference</TableCell>
                    <TableCell sx={{ minWidth: 90 }}>Source</TableCell>
                    <TableCell sx={{ minWidth: 120 }}>Type</TableCell>
                    <TableCell sx={{ minWidth: 60 }}>Dir.</TableCell>
                    <TableCell sx={{ minWidth: 140 }}>From</TableCell>
                    <TableCell sx={{ minWidth: 140 }}>To</TableCell>
                    <TableCell align="right" sx={{ minWidth: 110 }}>In</TableCell>
                    <TableCell align="right" sx={{ minWidth: 110 }}>Out</TableCell>
                    <TableCell align="right" sx={{ minWidth: 80 }}>Fees</TableCell>
                    <TableCell align="right" sx={{ minWidth: 120 }}>Balance</TableCell>
                    <TableCell sx={{ minWidth: 140 }}>Notes</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={12} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                        No transactions found for this account.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row) => (
                      <TransactionRow key={`${row.source}-${row.id}`} row={row} money={money} />
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {!historyQuery.isPending && rows.length > 0 && (
            <Typography
              variant="caption"
              sx={{ color: 'text.secondary', textAlign: 'right', display: 'block' }}
            >
              {rows.length} transaction{rows.length !== 1 ? 's' : ''}
            </Typography>
          )}
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatChip({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: 'default' | 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error';
}) {
  return (
    <Paper variant="outlined" sx={{ px: 1.5, py: 0.75, borderRadius: 2 }}>
      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: color === 'default' ? 'text.primary' : `${color}.main`,
        }}
      >
        {value}
      </Typography>
    </Paper>
  );
}

function TransactionRow({
  row,
  money,
}: {
  row: ShopBankAccountTransactionItem;
  money: (v: number) => string;
}) {
  const isIn = row.direction === 'IN';

  return (
    <TableRow
      hover
      sx={{
        bgcolor: isIn ? 'success.50' : undefined,
        '& .MuiTableCell-root': {
          borderBottom: '1px solid',
          borderColor: 'divider',
        },
      }}
    >
      {/* Date */}
      <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.75rem' }}>
        <Typography variant="caption" sx={{ display: 'block' }}>
          {formatBusinessDay(row.day)}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {formatInstant(row.date).slice(11)}
        </Typography>
      </TableCell>

      {/* Reference */}
      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
        {row.reference || '—'}
      </TableCell>

      {/* Source badge */}
      <TableCell>
        <Chip
          size="small"
          label={SOURCE_LABELS[row.source]}
          color={SOURCE_COLORS[row.source]}
          variant="outlined"
          sx={{ fontSize: '0.65rem', height: 20 }}
        />
      </TableCell>

      {/* Type */}
      <TableCell sx={{ fontSize: '0.75rem' }}>{row.typeLabel || row.type}</TableCell>

      {/* Direction */}
      <TableCell>
        <Tooltip title={isIn ? 'Money In' : 'Money Out'}>
          <Chip
            size="small"
            icon={isIn ? <ArrowDownwardIcon /> : <ArrowUpwardIcon />}
            label={isIn ? 'IN' : 'OUT'}
            color={isIn ? 'success' : 'default'}
            variant={isIn ? 'filled' : 'outlined'}
            sx={{ fontSize: '0.65rem', height: 20 }}
          />
        </Tooltip>
      </TableCell>

      {/* From */}
      <TableCell sx={{ fontSize: '0.75rem' }}>
        <Typography variant="caption" sx={{ display: 'block' }}>
          {row.from}
        </Typography>
        {row.fromAccount && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {row.fromAccount}
          </Typography>
        )}
      </TableCell>

      {/* To */}
      <TableCell sx={{ fontSize: '0.75rem' }}>
        <Typography variant="caption" sx={{ display: 'block' }}>
          {row.to}
        </Typography>
        {row.toAccount && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {row.toAccount}
          </Typography>
        )}
      </TableCell>

      {/* In Amount */}
      <TableCell
        align="right"
        sx={{
          fontVariantNumeric: 'tabular-nums',
          fontWeight: row.inAmount > 0 ? 700 : 400,
          color: row.inAmount > 0 ? 'success.main' : 'text.disabled',
          fontSize: '0.8rem',
        }}
      >
        {row.inAmount > 0 ? money(row.inAmount) : '—'}
      </TableCell>

      {/* Out Amount */}
      <TableCell
        align="right"
        sx={{
          fontVariantNumeric: 'tabular-nums',
          fontWeight: row.outAmount > 0 ? 700 : 400,
          color: row.outAmount > 0 ? 'error.main' : 'text.disabled',
          fontSize: '0.8rem',
        }}
      >
        {row.outAmount > 0 ? money(row.outAmount) : '—'}
      </TableCell>

      {/* Fees */}
      <TableCell
        align="right"
        sx={{
          fontVariantNumeric: 'tabular-nums',
          fontSize: '0.75rem',
          color: row.feeAmount > 0 ? 'warning.main' : 'text.disabled',
        }}
      >
        {row.feeAmount > 0 ? (
          <Tooltip title={`Fee direction: ${row.feeDirection ?? 'N/A'}`}>
            <span>{money(row.feeAmount)}</span>
          </Tooltip>
        ) : (
          '—'
        )}
      </TableCell>

      {/* Running Balance */}
      <TableCell
        align="right"
        sx={{
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 600,
          fontSize: '0.8rem',
          color: row.runningBalance >= 0 ? 'text.primary' : 'error.main',
        }}
      >
        {money(row.runningBalance)}
      </TableCell>

      {/* Notes */}
      <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary', maxWidth: 180 }}>
        <Tooltip title={row.notes ?? ''} disableHoverListener={!row.notes}>
          <span
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {row.notes || '—'}
          </span>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
}
