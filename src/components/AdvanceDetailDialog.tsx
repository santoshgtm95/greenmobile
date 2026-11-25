import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  Divider,
  Paper,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState, type ReactNode } from 'react';
import AddIcon from '@mui/icons-material/Add';
import CallMadeIcon from '@mui/icons-material/CallMade';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMoneyFormatter } from '../hooks/useSettings';
import { PosApiError } from '@shared/errors';
import { formatInstant } from '@shared/datetime';
import { BANK_ADVANCE_STATUS_LABELS } from '@shared/domain';
import { formatRate } from '@shared/money';
import type { BankAdvance, BankTransaction } from '@shared/api';
import AccountSide from './AccountSide';
import { DeletedChip, deletedRowSx } from './DeletedMark';
import DeleteReasonDialog from './DeleteReasonDialog';
import { historyTableSx } from './historyTableSx';

/**
 * One customer advance: what the customer paid in (the first deposit and every
 * "receive more") and what they have taken back out, in one table newest first,
 * with the totals and what is left to collect above it.
 */
export default function AdvanceDetailDialog({
  advanceId,
  canWithdraw: mayWithdraw,
  canDelete: mayDelete,
  onWithdraw,
  onReceiveMore,
  onChanged,
  onClose,
}: {
  advanceId: string;
  canWithdraw: boolean;
  canDelete: boolean;
  onWithdraw: (advance: BankAdvance) => void;
  onReceiveMore: (advance: BankAdvance) => void;
  /** After a delete, so the page refetches what it shows (this dialog included). */
  onChanged: () => void;
  onClose: () => void;
}) {
  const money = useMoneyFormatter();
  const [deleting, setDeleting] = useState<BankTransaction | null>(null);
  const detail = useQuery({
    queryKey: ['bankAdvance', advanceId],
    queryFn: () => api.banking.getAdvance({ id: advanceId }),
  });

  const advance = detail.data?.advance;
  // A deleted advance is shown for checking only.
  const isDeleted = advance?.isDeleted === 1;
  const canManage = mayWithdraw && !isDeleted;
  const canDelete = mayDelete && !isDeleted;
  const onDelete = canDelete ? setDeleting : undefined;
  // Receipts and withdrawals in one list, newest first.
  const rows: Movement[] = advance
    ? [
        ...[advance, ...(detail.data?.topUps ?? [])].map((m) => ({ m, out: false })),
        ...(detail.data?.withdrawals ?? []).map((m) => ({ m, out: true })),
      ].sort((a, b) => b.m.transactionDate.localeCompare(a.m.transactionDate))
    : [];

  return (
    <Dialog open fullWidth maxWidth="lg" onClose={onClose}>
      <DialogTitle>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <span>Advance {advance?.transactionNumber ?? ''}</span>
          {advance && (
            <Chip
              size="small"
              color={advance.status === 'OPEN' ? 'warning' : 'success'}
              label={BANK_ADVANCE_STATUS_LABELS[advance.status]}
            />
          )}
          {isDeleted && <DeletedChip reason={advance?.deletedReason ?? null} />}
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {detail.isLoading && (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
            <CircularProgress size={26} />
          </Box>
        )}
        {detail.isError && (
          <Alert severity="error">
            {detail.error instanceof PosApiError ? detail.error.message : 'This advance could not be loaded.'}
          </Alert>
        )}

        {advance && (
          <Stack spacing={3}>
            <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ justifyContent: 'space-around' }}>
                <Total label="Total Received" value={money(advance.received)} color="success.main" />
                <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />
                <Total label="Total Withdrawn" value={money(advance.withdrawn)} color="error.main" />
                <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />
                <Total
                  label="Left to Collect"
                  value={money(advance.remaining)}
                  color={advance.remaining > 0 ? 'warning.main' : 'text.secondary'}
                />
              </Stack>
            </Paper>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="overline" color="text.secondary">
                  Customer
                </Typography>
                <AccountSide
                  accountName={advance.fromAccountName}
                  accountKey={advance.fromAccountKey}
                  accountNumber={advance.fromAccountNumber}
                  typedName={advance.fromName}
                />
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography variant="overline" color="text.secondary">
                  Held in
                </Typography>
                <AccountSide
                  accountName={advance.toAccountName}
                  accountKey={advance.toAccountKey}
                  accountNumber={advance.toAccountNumber}
                  typedName={advance.toName}
                />
              </Box>
            </Stack>

            <Section
              title={`Transactions (${rows.filter((r) => !r.m.isDeleted).length})`}
              action={
                canManage && (
                  <Stack direction="row" spacing={1}>
                    <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => onReceiveMore(advance)}>
                      Receive More
                    </Button>
                    {advance.status === 'OPEN' && (
                      <Button
                        size="small"
                        variant="contained"
                        color="warning"
                        startIcon={<CallMadeIcon />}
                        onClick={() => onWithdraw(advance)}
                      >
                        Withdraw
                      </Button>
                    )}
                  </Stack>
                )
              }
            >
              <MovementTable rows={rows} money={money} onDelete={onDelete} />
            </Section>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>

      {deleting && (
        <DeleteReasonDialog
          title={`Delete ${deleting.transactionNumber}?`}
          message={
            deleting.id === advanceId
              ? 'The advance stays in the records, marked deleted, but stops counting towards the balances.'
              : deleting.advanceRole === 'DEPOSIT'
                ? 'This receipt stays in the records, marked deleted, and its amount comes off the advance.'
                : 'The withdrawal stays in the records, marked deleted, and its amount goes back on the advance.'
          }
          onConfirm={(reason) =>
            api.banking.deleteTransaction({ id: deleting.id, reason }).then(() => {
              onChanged();
              // The deposit IS the advance; with it gone there is nothing to show.
              if (deleting.id === advanceId) onClose();
            })
          }
          onClose={() => setDeleting(null)}
        />
      )}
    </Dialog>
  );
}

function Total({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Box sx={{ textAlign: 'center' }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  );
}

function Section({ title, action, children }: { title: string; action: ReactNode; children: ReactNode }) {
  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1, minHeight: 31 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        {action}
      </Stack>
      {children}
    </Box>
  );
}

type Movement = { m: BankTransaction; out: boolean };

function MovementTable({
  rows,
  money,
  onDelete,
}: {
  rows: Movement[];
  money: (minor: number) => string;
  onDelete?: (movement: BankTransaction) => void;
}) {
  return (
    <TableContainer component={Paper} sx={[historyTableSx, { overflowX: 'auto' }]}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Recorded by</TableCell>
            <TableCell>Number</TableCell>
            <TableCell>Date & Time</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Received into / Paid to</TableCell>
            <TableCell align="right">Amount</TableCell>
            <TableCell align="right">Fee</TableCell>
            {onDelete && <TableCell />}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(({ m, out }) => {
              const deleted = m.isDeleted === 1;
              const tone = out ? 'error.main' : 'success.main';
              return (
                <TableRow key={m.id} sx={deleted ? deletedRowSx : undefined}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{m.createdByName ?? '—'}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12.5, whiteSpace: 'nowrap' }}>
                    {m.transactionNumber}
                    {deleted && <DeletedChip reason={m.deletedReason} />}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatInstant(m.transactionDate)}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={out ? 'error' : 'success'}
                      label={out ? 'Withdrawn' : 'Received'}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {[m.toName ?? '—', m.toAccountNumber].filter((v) => v && v !== '-').join(' · ')}
                    </Typography>
                    {m.notes && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', whiteSpace: 'pre-line', fontStyle: 'italic' }}
                      >
                        {m.notes}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: tone, whiteSpace: 'nowrap' }}
                  >
                    {money(m.amount)}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                      color: m.feeAmount === 0 ? 'text.disabled' : 'text.secondary',
                    }}
                  >
                    {m.feeAmount === 0 ? '—' : `${money(m.feeAmount)} (${formatRate(m.feeBasisPoints)})`}
                  </TableCell>
                  {onDelete && (
                    <TableCell align="right" sx={{ width: 48 }}>
                      {!deleted && (
                        <Tooltip title="Delete (administrators only)">
                          <IconButton size="small" color="error" aria-label={`Delete ${m.transactionNumber}`} onClick={() => onDelete(m)}>
                            <DeleteOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
