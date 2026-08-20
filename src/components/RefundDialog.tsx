import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMoneyFormatter } from '../hooks/useSettings';
import { PosApiError } from '@shared/errors';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@shared/domain';
import type { SaleDetail } from '@shared/api';

interface RefundLine {
  saleItemId: string;
  quantity: number;
  isDefective: boolean;
}

/**
 * Refund workflow (spec §45).
 *
 * Only what is still refundable can be selected; the estimate shown is the share
 * of what was actually charged, and the main process recomputes it authoritatively
 * when the refund is committed.
 */
export default function RefundDialog({
  sale,
  onClose,
  onRefunded,
}: {
  sale: SaleDetail;
  onClose: () => void;
  onRefunded: (message: string) => void;
}) {
  const money = useMoneyFormatter();

  const refundable = useMemo(
    () => sale.items.filter((item) => item.quantity - item.returnedQuantity > 0),
    [sale.items],
  );

  const [lines, setLines] = useState<Record<string, RefundLine>>({});
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('CASH');
  const [error, setError] = useState<string | null>(null);

  const selected = Object.values(lines).filter((line) => line.quantity > 0);

  /** Indicative only — the main process is the authority on the final figure. */
  const estimate = selected.reduce((sum, line) => {
    const item = sale.items.find((i) => i.id === line.saleItemId);
    if (!item) return sum;
    const perUnit = Math.round(item.totalAmount / item.quantity);
    return sum + perUnit * line.quantity;
  }, 0);

  const setQuantity = (item: (typeof refundable)[number], quantity: number) => {
    const max = item.quantity - item.returnedQuantity;
    const clamped = Math.max(0, Math.min(quantity, max));
    setLines((current) => ({
      ...current,
      [item.id]: {
        saleItemId: item.id,
        quantity: clamped,
        isDefective: current[item.id]?.isDefective ?? false,
      },
    }));
  };

  const refund = useMutation({
    mutationFn: () =>
      api.sales.refund({
        saleId: sale.sale.id,
        items: selected,
        reason: reason.trim(),
        refundMethod,
        notes: undefined,
      }),
    onSuccess: (result) => {
      onRefunded(
        `Refund ${result.returnNumber} recorded — ${money(result.refundAmount)} returned. Stock and IMEI numbers updated.`,
      );
    },
    onError: (err) =>
      setError(err instanceof PosApiError ? err.message : 'Unable to process this refund.'),
  });

  return (
    <Dialog open fullWidth maxWidth="md" onClose={onClose}>
      <DialogTitle>Refund — invoice {sale.sale.invoiceNumber}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {error && <Alert severity="error">{error}</Alert>}

          {refundable.length === 0 && (
            <Alert severity="info">
              Every item on this invoice has already been returned.
            </Alert>
          )}

          {refundable.length > 0 && (
            <>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Product</TableCell>
                    <TableCell align="right">Sold</TableCell>
                    <TableCell align="right">Already returned</TableCell>
                    <TableCell align="center">Refund quantity</TableCell>
                    <TableCell align="center">Faulty</TableCell>
                    <TableCell align="right">Estimate</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {refundable.map((item) => {
                    const max = item.quantity - item.returnedQuantity;
                    const line = lines[item.id];
                    const quantity = line?.quantity ?? 0;
                    const perUnit = Math.round(item.totalAmount / item.quantity);
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          {item.productName}
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {item.sku}
                            {item.serials ? ` · IMEI ${item.serials}` : ''}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">{item.quantity}</TableCell>
                        <TableCell align="right" sx={{ color: 'text.secondary' }}>
                          {item.returnedQuantity || '—'}
                        </TableCell>
                        <TableCell align="center">
                          <Stack
                            direction="row"
                            spacing={0.5}
                            sx={{ alignItems: 'center', justifyContent: 'center' }}
                          >
                            <IconButton size="small" onClick={() => setQuantity(item, quantity - 1)}>
                              <RemoveIcon fontSize="small" />
                            </IconButton>
                            <Typography sx={{ minWidth: 40, textAlign: 'center', fontWeight: 700 }}>
                              {quantity}
                            </Typography>
                            <IconButton
                              size="small"
                              onClick={() => setQuantity(item, quantity + 1)}
                              disabled={quantity >= max}
                            >
                              <AddIcon fontSize="small" />
                            </IconButton>
                          </Stack>
                        </TableCell>
                        <TableCell align="center">
                          <Checkbox
                            size="small"
                            checked={line?.isDefective ?? false}
                            disabled={quantity === 0}
                            onChange={(e) =>
                              setLines((current) => ({
                                ...current,
                                [item.id]: {
                                  saleItemId: item.id,
                                  quantity: current[item.id]?.quantity ?? 0,
                                  isDefective: e.target.checked,
                                },
                              }))
                            }
                          />
                        </TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                          {quantity > 0 ? money(perUnit * quantity) : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              <Divider />

              <Stack direction="row" spacing={2}>
                <TextField
                  label="Reason for the refund"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  helperText="Stored with the refund record"
                />
                <TextField
                  select
                  label="Refund by"
                  value={refundMethod}
                  onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}
                  sx={{ maxWidth: 200 }}
                >
                  {PAYMENT_METHODS.map((method) => (
                    <MenuItem key={method} value={method}>
                      {PAYMENT_METHOD_LABELS[method]}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>

              <Box sx={{ p: 2, borderRadius: 1, bgcolor: 'background.default' }}>
                <Stack direction="row" sx={{ alignItems: 'baseline' }}>
                  <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
                    Estimated refund
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {money(estimate)}
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  The final figure is recalculated from what was actually charged when you confirm.
                </Typography>
              </Box>

              <Alert severity="info">
                Items marked <strong>faulty</strong> come back into the records but are written
                straight off, so they never return to sellable stock. Their IMEI is set to
                Defective; anything else is set to Returned.
              </Alert>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="warning"
          onClick={() => {
            setError(null);
            refund.mutate();
          }}
          disabled={refund.isPending || selected.length === 0 || !reason.trim()}
        >
          {refund.isPending ? 'Processing…' : 'Confirm refund'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
