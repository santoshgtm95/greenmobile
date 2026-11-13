import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  Paper,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';
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
 * One advance from start to finish: the deposit, then every withdrawal in the
 * order it happened, with what was left after each.
 *
 * The running figure is the point. A customer standing at the counter asks "how
 * much do I have left, and when did I take the last lot?" — this answers both
 * in one look, and shows the shop's own arithmetic rather than asking anyone to
 * trust a single number at the bottom.
 */
export default function AdvanceDetailDialog({
  advanceId,
  canWithdraw: mayWithdraw,
  canDelete: mayDelete,
  onWithdraw,
  onChanged,
  onClose,
}: {
  advanceId: string;
  canWithdraw: boolean;
  canDelete: boolean;
  onWithdraw: (advance: BankAdvance) => void;
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
  const canWithdraw = mayWithdraw && !isDeleted;
  const canDelete = mayDelete && !isDeleted;
  const onDelete = canDelete ? setDeleting : undefined;
  const withdrawals = detail.data?.withdrawals ?? [];

  // Remaining after each step, worked out in order from the deposit down.
  // A deleted withdrawal is listed for checking but takes nothing off.
  let running = advance?.amount ?? 0;
  const steps = withdrawals.map((withdrawal) => {
    if (withdrawal.isDeleted) return { withdrawal, after: null };
    running -= withdrawal.amount;
    return { withdrawal, after: running };
  });

  return (
    <Dialog open fullWidth maxWidth="md" onClose={onClose}>
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
            {detail.error instanceof PosApiError
              ? detail.error.message
              : 'This advance could not be loaded.'}
          </Alert>
        )}

        {advance && (
          <Stack spacing={2}>
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
              <Box sx={{ textAlign: { sm: 'right' } }}>
                <Typography variant="overline" color="text.secondary">
                  Left to collect
                </Typography>
                <Typography
                  variant="h5"
                  sx={{
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    color: advance.remaining > 0 ? 'warning.main' : 'text.secondary',
                  }}
                >
                  {money(advance.remaining)}
                </Typography>
              </Box>
            </Stack>

            <Paper sx={historyTableSx}>

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date and time</TableCell>
                  <TableCell>Number</TableCell>
                  <TableCell>What happened</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell align="right">Fee</TableCell>
                  <TableCell align="right">Left after</TableCell>
                  {canDelete && <TableCell />}
                </TableRow>
              </TableHead>
              <TableBody>
                {/* Newest first; "Left after" was worked out oldest-first above. */}
                {[...steps].reverse().map(({ withdrawal, after }) => (
                  <StepRow
                    key={withdrawal.id}
                    movement={withdrawal}
                    label="Withdrawn"
                    // The same typographic minus as the Banking strip.
                    amount={`−${money(withdrawal.amount)}`}
                    tone="error.main"
                    after={after === null ? '—' : money(after)}
                    money={money}
                    onDelete={onDelete}
                    showActionCell={canDelete}
                  />
                ))}
                <StepRow
                  movement={advance}
                  label="Deposited"
                  amount={money(advance.amount)}
                  tone="success.main"
                  after={money(advance.amount)}
                  money={money}
                  onDelete={onDelete}
                />
              </TableBody>
            </Table>

            </Paper>

            {withdrawals.every((w) => w.isDeleted) && (
              <Typography variant="body2" color="text.secondary">
                Nothing has been withdrawn yet.
              </Typography>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        {advance && canWithdraw && advance.status === 'OPEN' && (
          <Button variant="contained" onClick={() => onWithdraw(advance)}>
            Withdraw
          </Button>
        )}
      </DialogActions>

      {deleting && (
        <DeleteReasonDialog
          title={`Delete ${deleting.transactionNumber}?`}
          message={
            deleting.id === advanceId
              ? 'The advance stays in the records, marked deleted, but stops counting towards the balances.'
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

function StepRow({
  movement,
  label,
  amount,
  tone,
  after,
  money,
  onDelete,
  showActionCell = Boolean(onDelete),
}: {
  movement: BankTransaction;
  label: string;
  amount: string;
  tone: string;
  after: string;
  money: (minor: number) => string;
  onDelete?: (movement: BankTransaction) => void;
  /** Keeps the column when this row has no button of its own. */
  showActionCell?: boolean;
}) {
  const deleted = movement.isDeleted === 1;
  return (
    <TableRow sx={deleted ? deletedRowSx : undefined}>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatInstant(movement.transactionDate)}</TableCell>
      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12.5, whiteSpace: 'nowrap' }}>
        {movement.transactionNumber}
        {deleted && <DeletedChip reason={movement.deletedReason} />}
      </TableCell>
      <TableCell>
        <Typography variant="body2">{label}</Typography>
        <Typography variant="caption" color="text.secondary">
          {[movement.toName ?? '—', movement.toAccountNumber].filter(Boolean).join(' · ')}
        </Typography>
        {movement.notes && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', whiteSpace: 'pre-line', fontStyle: 'italic' }}
          >
            {movement.notes}
          </Typography>
        )}
      </TableCell>
      <TableCell
        align="right"
        sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: tone, whiteSpace: 'nowrap' }}
      >
        {amount}
      </TableCell>
      <TableCell
        align="right"
        sx={{
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          color: movement.feeAmount === 0 ? 'text.disabled' : 'text.secondary',
        }}
      >
        {movement.feeAmount === 0
          ? '—'
          : `${money(movement.feeAmount)} (${formatRate(movement.feeBasisPoints)})`}
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {after}
      </TableCell>
      {showActionCell && (
        <TableCell align="right" sx={{ width: 48 }}>
          {onDelete && !deleted && (
            <Tooltip title="Delete (administrators only)">
              <IconButton
                size="small"
                aria-label={`Delete ${movement.transactionNumber}`}
                onClick={() => onDelete(movement)}
              >
                <DeleteOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}
