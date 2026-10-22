import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import LocalAtmIcon from '@mui/icons-material/LocalAtm';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useMoneyFormatter } from '../hooks/useSettings';
import DeleteReasonDialog from './DeleteReasonDialog';
import { PosApiError } from '@shared/errors';
import { formatInstant } from '@shared/datetime';
import type { ShopAdvance, ShopAdvanceSettlement } from '@shared/api';

export default function ShopAdvanceDetailDialog({
  advanceId,
  onClose,
  onReceive,
  onDeleted,
}: {
  advanceId: string;
  onClose: () => void;
  onReceive: (advance: ShopAdvance) => void;
  onDeleted: () => void;
}) {
  const { can } = useAuth();
  const money = useMoneyFormatter();
  const queryClient = useQueryClient();

  const [deletingAdvance, setDeletingAdvance] = useState(false);
  const [deletingSettlement, setDeletingSettlement] = useState<ShopAdvanceSettlement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['shopAdvance', advanceId],
    queryFn: () => api.banking.getShopAdvance({ id: advanceId }),
  });

  const advance = detail.data?.advance;
  const settlements = detail.data?.settlements ?? [];

  const canManage = can('banking.manage');
  const canDelete = can('banking.delete');

  return (
    <>
      <Dialog open fullWidth maxWidth="md" onClose={onClose}>
        <DialogTitle>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Shop Advance Details
              </Typography>
              {advance && (
                <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                  {advance.advanceNumber}
                </Typography>
              )}
            </Stack>
            {advance && (
              <Chip
                label={advance.status}
                color={advance.status === 'OPEN' ? 'warning' : 'success'}
                size="small"
              />
            )}
          </Stack>
        </DialogTitle>

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
                <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={3}
                    sx={{ justifyContent: 'space-around' }}
                  >
                    <Box sx={{ textAlign: 'center' }}>
                      <Typography variant="caption" color="text.secondary">
                        Advanced Amount
                      </Typography>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        {money(advance.amount)}
                      </Typography>
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
                      {advance.fromType === 'CASH' ? (
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
                      {advance.toType === 'CASH' ? (
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

                {/* Repayments History */}
                <Box>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Repayments Received ({settlements.length})
                    </Typography>
                    {canManage && advance.remaining > 0 && (
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

                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Repayment #</TableCell>
                          <TableCell>Date & Time</TableCell>
                          <TableCell>Received Into</TableCell>
                          <TableCell align="right">Amount</TableCell>
                          <TableCell>Notes</TableCell>
                          {canDelete && <TableCell align="right">Actions</TableCell>}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {settlements.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={canDelete ? 6 : 5} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                              No repayments recorded yet.
                            </TableCell>
                          </TableRow>
                        ) : (
                          settlements.map((s) => (
                            <TableRow key={s.id}>
                              <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                                {s.settlementNumber}
                              </TableCell>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                {formatInstant(s.settlementDate)}
                              </TableCell>
                              <TableCell>
                                {s.toType === 'CASH' ? (
                                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                                    <LocalAtmIcon fontSize="small" color="action" />
                                    <span>Cash in Hand</span>
                                  </Stack>
                                ) : (
                                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                                    <AccountBalanceIcon fontSize="small" color="primary" />
                                    <span>
                                      {s.toBankName} ({s.toAccountNumber})
                                    </span>
                                  </Stack>
                                )}
                              </TableCell>
                              <TableCell align="right" sx={{ fontWeight: 700, color: 'success.main' }}>
                                {money(s.amount)}
                                {s.feeAmount > 0 && (
                                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                    {s.feeDirection === 'RECEIVE' ? '+' : '-'}{money(s.feeAmount)} ({s.feeDirection === 'RECEIVE' ? 'Recv' : 'Pay'}) · Actual {money(s.actualAmount || s.amount)}
                                  </Typography>
                                )}
                              </TableCell>
                              <TableCell>{s.notes || '—'}</TableCell>
                              {canDelete && (
                                <TableCell align="right">
                                  <Tooltip title="Delete repayment">
                                    <IconButton
                                      size="small"
                                      color="error"
                                      onClick={() => setDeletingSettlement(s)}
                                    >
                                      <DeleteOutlinedIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                </TableCell>
                              )}
                            </TableRow>
                          ))
                        )}
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
            {canDelete && advance && settlements.length === 0 && (
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
      </Dialog>

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
