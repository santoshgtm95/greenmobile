import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Paper,
  Stack,
  TextField,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import MoneyField from './MoneyField';
import { useMoneyFormatter } from '../hooks/useSettings';
import { SummaryLine } from './MovementParts';
import { PosApiError } from '@shared/errors';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@shared/domain';
import type { ServiceOrderDetail } from '@shared/api';

/**
 * Handing the device back: settle what is still owed, then mark it delivered —
 * one step, one database transaction in the main process.
 *
 * A job with no parts or labour lines is charged its estimate (editable here),
 * recorded as a "Repair charge" line so reports and receipts include it.
 */
export default function ServiceDeliverDialog({
  detail,
  onClose,
  onDelivered,
}: {
  detail: ServiceOrderDetail;
  onClose: () => void;
  onDelivered: () => void;
}) {
  const money = useMoneyFormatter();
  const { order, items } = detail;
  const unpriced = items.length === 0;

  const [charge, setCharge] = useState(unpriced ? order.estimatedCost : order.finalCost);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [error, setError] = useState<string | null>(null);

  const remaining = Math.max(0, charge - order.amountPaid);
  const overpaid = order.amountPaid - charge;

  const deliver = useMutation({
    mutationFn: () =>
      api.services.changeStatus({
        serviceOrderId: order.id,
        status: 'DELIVERED',
        note: undefined,
        charge: unpriced ? charge : undefined,
        paymentMethod: remaining > 0 ? paymentMethod : undefined,
        referenceNumber: referenceNumber.trim() || undefined,
      }),
    onSuccess: onDelivered,
    onError: (err) =>
      setError(err instanceof PosApiError ? err.message : 'Unable to mark this job delivered.'),
  });

  return (
    <Dialog open fullWidth maxWidth="xs" onClose={deliver.isPending ? undefined : onClose}>
      <DialogTitle>Deliver {order.serviceNumber}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {error && <Alert severity="error">{error}</Alert>}

          {unpriced && (
            <MoneyField
              label="Repair charge"
              value={charge}
              onChange={setCharge}
              helperText="No parts or labour lines yet — the total the customer pays. Starts at the estimate."
              fullWidth
            />
          )}

          <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
            <Stack spacing={0.75}>
              <SummaryLine label="Total charge" value={money(charge)} />
              <SummaryLine label="Paid so far (incl. deposit)" value={money(order.amountPaid)} />
              <Divider sx={{ my: 0.5 }} />
              <SummaryLine
                strong
                label={remaining > 0 ? 'Take now' : 'Nothing to take'}
                value={money(remaining)}
                tone={remaining > 0 ? 'error.main' : 'success.main'}
              />
            </Stack>
          </Paper>

          {overpaid > 0 && (
            <Alert severity="warning">
              The customer has paid {money(overpaid)} more than the charge. Give that back
              before handing the device over.
            </Alert>
          )}

          {remaining > 0 && (
            <Stack direction="row" spacing={2}>
              <TextField
                select
                label="Method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                sx={{ flex: 1 }}
              >
                {PAYMENT_METHODS.map((method) => (
                  <MenuItem key={method} value={method}>
                    {PAYMENT_METHOD_LABELS[method]}
                  </MenuItem>
                ))}
              </TextField>
              {paymentMethod !== 'CASH' && (
                <TextField
                  label="Reference"
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                  sx={{ flex: 1 }}
                />
              )}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={deliver.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="success"
          disabled={deliver.isPending}
          onClick={() => {
            setError(null);
            deliver.mutate();
          }}
        >
          {deliver.isPending
            ? 'Saving…'
            : remaining > 0
              ? `Take ${money(remaining)} and deliver`
              : 'Mark delivered'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
