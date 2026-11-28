import { MovementDialog, summaryBoxSx } from './MovementParts';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  DialogActions,
  DialogContent,
  Divider,
  IconButton,
  Paper,
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
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import CallReceivedIcon from '@mui/icons-material/CallReceived';
import AddIcon from '@mui/icons-material/Add';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import LocalAtmIcon from '@mui/icons-material/LocalAtm';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useMoneyFormatter } from '../hooks/useSettings';
import DeleteReasonDialog from './DeleteReasonDialog';
import AccountSide from './AccountSide';
import { historyTableSx } from './historyTableSx';
import { DeletedChip, deletedRowSx } from './DeletedMark';
import { PosApiError } from '@shared/errors';
import { formatInstant } from '@shared/datetime';
import type { ShopAdvance, ShopAdvancePayment, ShopAdvanceSettlement } from '@shared/api';

/** One side of a row: holder name, bank key and number, bank name — as on Customer Advance Details. */
const side = (name: string | null, bankName: string | null, number: string | null, bankKey: string | null = null) => (
  <AccountSide accountName={bankName} accountKey={bankKey} accountNumber={number || null} typedName={name || null} />
);

/** The shop's side of the movement: cash in hand, a bank account, or an old record. */
const methodChip = (type: string) =>
  type === 'OLD' ? (
    <Chip size="small" variant="outlined" label="Old" />
  ) : (
    <Chip size="small" variant="outlined" color={type === 'CASH' ? 'default' : 'info'} label={type === 'CASH' ? 'Cash' : 'Bank'} />
  );

export default function ShopAdvanceDetailDialog({
  advanceId,
  onClose,
  onReceive,
  onPayMore,
  onDeleted,
}: {
  advanceId: string;
  onClose: () => void;
  onReceive: (advance: ShopAdvance) => void;
  onPayMore: (advance: ShopAdvance) => void;
  onDeleted: () => void;
}) {
  const { can } = useAuth();
  const money = useMoneyFormatter();
  const queryClient = useQueryClient();

  const [deletingAdvance, setDeletingAdvance] = useState(false);
  const [deletingSettlement, setDeletingSettlement] = useState<ShopAdvanceSettlement | null>(null);
  const [deletingPayment, setDeletingPayment] = useState<ShopAdvancePayment | null>(null);
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['shopAdvance', advanceId],
    queryFn: () => api.banking.getShopAdvance({ id: advanceId }),
  });

  const advance = detail.data?.advance;
  // Deleted rows are listed for checking; only live ones are counted.
  const payments = detail.data?.payments ?? [];
  const settlements = detail.data?.settlements ?? [];
  const livePayments = payments.filter((p) => !p.isDeleted).length;
  const liveSettlements = settlements.filter((s) => !s.isDeleted).length;

  // A deleted advance is shown for checking only.
  const isDeleted = advance?.isDeleted === 1;
  const canManage = can('banking.manage') && !isDeleted;
  const canDelete = can('banking.delete') && !isDeleted;

  const rows = [
    ...payments.map((p) => ({ kind: 'given' as const, p, date: p.advanceDate })),
    ...settlements.map((s) => ({ kind: 'received' as const, s, date: s.settlementDate })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const paymentRow = (p: ShopAdvancePayment) => (
    <TableRow key={p.id} sx={p.isDeleted ? deletedRowSx : undefined}>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{p.createdByName ?? '—'}</TableCell>
      <TableCell sx={{ fontFamily: 'monospace', fontSize: "0.75rem" }}>
        {p.advanceNumber}
        {p.isDeleted === 1 && <DeletedChip reason={p.deletedReason} />}
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatInstant(p.advanceDate)}</TableCell>
      <TableCell>
        <Chip size="small" variant="outlined" color="error" label="Given" />
      </TableCell>
      <TableCell sx={{ minWidth: 150 }}>
        {p.fromType === 'SHOP_ACCOUNT'
          ? side(p.fromAccountName, p.fromBankName, p.fromAccountNumber)
          : side(p.fromType === 'OLD' ? 'Old record' : 'Cash in hand', null, null)}
      </TableCell>
      <TableCell sx={{ minWidth: 150 }}>
        {p.fromType === 'OLD'
          ? side(advance?.recipientName ?? null, null, null)
          : p.toType === 'CASH'
            ? side(`${advance?.recipientName ?? '—'} (cash)`, null, null)
            : side(p.toAccountName || (advance?.recipientName ?? null), p.toBankName, p.toAccountNumber)}
      </TableCell>
      <TableCell>{methodChip(p.fromType)}</TableCell>
      <TableCell align="right" sx={{ fontWeight: 700, color: 'error.main', whiteSpace: 'nowrap' }}>
        {money(p.amount)}
      </TableCell>
      <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: p.bankCharges ? 'text.secondary' : 'text.disabled' }}>
        {p.bankCharges > 0 ? `${money(p.bankCharges)} bank charges` : '—'}
      </TableCell>
      <TableCell sx={{ whiteSpace: 'pre-line' }}>{p.notes || '—'}</TableCell>
      {canDelete && (
        <TableCell align="right">
          {!p.isDeleted && (
            // The first payment is the advance itself; the server refuses while later rows are live.
            <Tooltip title={p.parentId ? 'Delete payment' : 'Delete advance'}>
              <IconButton
                size="small"
                color="error"
                onClick={() => (p.parentId ? setDeletingPayment(p) : setDeletingAdvance(true))}
              >
                <DeleteOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </TableCell>
      )}
    </TableRow>
  );

  const settlementRow = (s: ShopAdvanceSettlement) => (
    <TableRow key={s.id} sx={s.isDeleted ? deletedRowSx : undefined}>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{s.createdByName ?? '—'}</TableCell>
      <TableCell sx={{ fontFamily: 'monospace', fontSize: "0.75rem" }}>
        {s.settlementNumber}
        {s.isDeleted === 1 && <DeletedChip reason={s.deletedReason} />}
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatInstant(s.settlementDate)}</TableCell>
      <TableCell>
        <Chip size="small" variant="outlined" color="success" label="Repaid" />
      </TableCell>
      <TableCell sx={{ minWidth: 150 }}>
        {s.toType === 'CASH' && !s.fromAccountNumber
          ? side(`${advance?.recipientName ?? '—'} (cash)`, null, null)
          : side(s.fromAccountName || (advance?.recipientName ?? null), s.fromBankName, s.fromAccountNumber, s.fromBankKey)}
      </TableCell>
      <TableCell sx={{ minWidth: 150 }}>
        {s.toType === 'CASH'
          ? side('Cash in hand', null, null)
          : side(s.toAccountName, s.toBankName, s.toAccountNumber, s.toBankKey)}
      </TableCell>
      <TableCell>{methodChip(s.toType)}</TableCell>
      <TableCell align="right" sx={{ fontWeight: 700, color: 'success.main', whiteSpace: 'nowrap' }}>
        {money(s.amount)}
      </TableCell>
      <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: s.feeAmount ? 'text.secondary' : 'text.disabled' }}>
        {s.feeAmount > 0 ? (
          <>
            {s.feeDirection === 'RECEIVE' ? '+' : '−'}
            {money(s.feeAmount)} ({s.feeDirection === 'RECEIVE' ? 'received' : 'paid'})
            <Typography variant="caption" sx={{ display: 'block' }}>
              Actual {money(s.actualAmount || s.amount)}
            </Typography>
          </>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell sx={{ whiteSpace: 'pre-line' }}>{s.notes || '—'}</TableCell>
      {canDelete && (
        <TableCell align="right">
          {!s.isDeleted && (
            <Tooltip title="Delete repayment">
              <IconButton size="small" color="error" onClick={() => setDeletingSettlement(s)}>
                <DeleteOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </TableCell>
      )}
    </TableRow>
  );

  return (
    <>
      <MovementDialog
        maxWidth="xl"
        onClose={onClose}
        icon={<PaymentsOutlinedIcon />}
        title={`Shop advance ${advance?.advanceNumber ?? ''}`}
        subtitle="Paid out by the shop, with every repayment received"
        badges={
          advance && (
            <>
              <Chip label={advance.status} color={advance.status === 'OPEN' ? 'warning' : 'success'} size="small" />
              {isDeleted && <DeletedChip reason={advance.deletedReason} />}
            </>
          )
        }
      >

        <DialogContent>
          <Stack spacing={3} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}

            {detail.isLoading && (
              <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                Loading advance details…
              </Typography>
            )}

            {advance && (
              <>
                {/* Summary Row */}
                <Paper variant="outlined" sx={summaryBoxSx}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={3}
                    sx={{ justifyContent: 'space-around' }}
                  >
                    <Box sx={{ textAlign: 'center' }}>
                      <Typography variant="caption" color="text.secondary">
                        Total Given
                      </Typography>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        {money(advance.amount)}
                      </Typography>
                      {advance.bankCharges > 0 && (
                        <Typography variant="caption" color="text.secondary">
                          + {money(advance.bankCharges)} bank charges paid by the shop
                        </Typography>
                      )}
                    </Box>
                    <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />
                    <Box sx={{ textAlign: 'center' }}>
                      <Typography variant="caption" color="text.secondary">
                        Total Received
                      </Typography>
                      <Typography variant="h6" color="success.main" sx={{ fontWeight: 700 }}>
                        {money(advance.received)}
                      </Typography>
                    </Box>
                    <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />
                    <Box sx={{ textAlign: 'center' }}>
                      <Typography variant="caption" color="text.secondary">
                        Outstanding Remaining
                      </Typography>
                      <Typography variant="h6" color="warning.main" sx={{ fontWeight: 700 }}>
                        {money(advance.remaining)}
                      </Typography>
                    </Box>
                  </Stack>
                </Paper>

                {/* Details Grid */}
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  {/* Recipient & Timing */}
                  <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary', mb: 1 }}>
                      Recipient Info
                    </Typography>
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                      {advance.recipientName}
                    </Typography>
                    {advance.recipientPhone && (
                      <Typography variant="body2" color="text.secondary">
                        Phone: {advance.recipientPhone}
                      </Typography>
                    )}
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      Date: {formatInstant(advance.advanceDate)}
                    </Typography>
                    {advance.notes && (
                      <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
                        Notes: {advance.notes}
                      </Typography>
                    )}
                  </Paper>

                  {/* Transfer Route */}
                  <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary', mb: 1 }}>
                      Payment Routing
                    </Typography>
                    <Box sx={{ mb: 1.5 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        From Shop
                      </Typography>
                      {advance.fromType === 'OLD' ? (
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          Old record
                        </Typography>
                      ) : advance.fromType === 'CASH' ? (
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                          <LocalAtmIcon fontSize="small" color="action" />
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            Cash in Hand
                          </Typography>
                        </Stack>
                      ) : (
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                          <AccountBalanceIcon fontSize="small" color="primary" />
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {advance.fromBankName} ({advance.fromAccountNumber}) · {advance.fromAccountName}
                          </Typography>
                        </Stack>
                      )}
                    </Box>

                    <Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        To Recipient
                      </Typography>
                      {advance.fromType === 'OLD' ? (
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          —
                        </Typography>
                      ) : advance.toType === 'CASH' ? (
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                          <LocalAtmIcon fontSize="small" color="action" />
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            Cash Handed Directly
                          </Typography>
                        </Stack>
                      ) : (
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                          <AccountBalanceIcon fontSize="small" color="action" />
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {advance.toBankName ? `${advance.toBankName} · ` : ''}
                            {advance.toAccountNumber}
                            {advance.toAccountName ? ` (${advance.toAccountName})` : ''}
                          </Typography>
                        </Stack>
                      )}
                    </Box>
                  </Paper>
                </Stack>

                {/* Payments given and repayments received, newest first */}
                <Box>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Transactions ({livePayments + liveSettlements})
                    </Typography>
                    {canManage && (
                      <Stack direction="row" spacing={1}>
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<AddIcon />}
                          onClick={() => onPayMore(advance)}
                        >
                          Pay More
                        </Button>
                        {advance.remaining > 0 && (
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            startIcon={<CallReceivedIcon />}
                            onClick={() => onReceive(advance)}
                          >
                            Receive Repayment
                          </Button>
                        )}
                      </Stack>
                    )}
                  </Stack>

                  <TableContainer component={Paper} sx={[historyTableSx, { overflowX: 'auto' }]}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Recorded by</TableCell>
                          <TableCell>Number</TableCell>
                          <TableCell>Date & Time</TableCell>
                          <TableCell>Type</TableCell>
                          <TableCell>Paid from</TableCell>
                          <TableCell>Received into</TableCell>
                          <TableCell>Cash / Bank</TableCell>
                          <TableCell align="right">Amount</TableCell>
                          <TableCell align="right">Fee</TableCell>
                          <TableCell sx={{ minWidth: 160 }}>Notes</TableCell>
                          {canDelete && <TableCell align="right">Actions</TableCell>}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.map((row) => (row.kind === 'given' ? paymentRow(row.p) : settlementRow(row.s)))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              </>
            )}
          </Stack>
        </DialogContent>

        <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
          <Box>
            {canDelete && advance && liveSettlements === 0 && livePayments <= 1 && (
              <Button
                color="error"
                startIcon={<DeleteOutlinedIcon />}
                onClick={() => setDeletingAdvance(true)}
              >
                Delete Advance
              </Button>
            )}
          </Box>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      </MovementDialog>

      {/* Delete Advance Dialog */}
      {deletingAdvance && advance && (
        <DeleteReasonDialog
          title="Delete Shop Advance"
          message={`Are you sure you want to delete advance ${advance.advanceNumber} of ${money(advance.amount)} to ${advance.recipientName}? The source balance will be restored.`}
          onClose={() => setDeletingAdvance(false)}
          onConfirm={async (reason) => {
            try {
              await api.banking.deleteShopAdvance({ id: advanceId, reason });
              onDeleted();
              onClose();
            } catch (err) {
              setError(err instanceof PosApiError ? err.message : 'Unable to delete advance.');
            }
          }}
        />
      )}

      {/* Delete Payment Dialog */}
      {deletingPayment && (
        <DeleteReasonDialog
          title="Delete Payment"
          message={`Are you sure you want to delete payment ${deletingPayment.advanceNumber} of ${money(deletingPayment.amount)}? The source balance will be restored.`}
          onClose={() => setDeletingPayment(null)}
          onConfirm={async (reason) => {
            try {
              await api.banking.deleteShopAdvance({ id: deletingPayment.id, reason });
              void queryClient.invalidateQueries({ queryKey: ['shopAdvance', advanceId] });
              void queryClient.invalidateQueries({ queryKey: ['shopAdvances'] });
              void queryClient.invalidateQueries({ queryKey: ['shopBankAccounts'] });
              void queryClient.invalidateQueries({ queryKey: ['bankingOverview'] });
            } catch (err) {
              setError(err instanceof PosApiError ? err.message : 'Unable to delete payment.');
            }
          }}
        />
      )}

      {/* Delete Settlement Dialog */}
      {deletingSettlement && (
        <DeleteReasonDialog
          title="Delete Repayment"
          message={`Are you sure you want to delete repayment ${deletingSettlement.settlementNumber} of ${money(deletingSettlement.amount)}? The balance will be adjusted accordingly.`}
          onClose={() => setDeletingSettlement(null)}
          onConfirm={async (reason) => {
            try {
              await api.banking.deleteShopAdvanceSettlement({ id: deletingSettlement.id, reason });
              void queryClient.invalidateQueries({ queryKey: ['shopAdvance', advanceId] });
              void queryClient.invalidateQueries({ queryKey: ['shopAdvances'] });
              void queryClient.invalidateQueries({ queryKey: ['shopBankAccounts'] });
              void queryClient.invalidateQueries({ queryKey: ['bankingOverview'] });
            } catch (err) {
              setError(err instanceof PosApiError ? err.message : 'Unable to delete repayment.');
            }
          }}
        />
      )}
    </>
  );
}
