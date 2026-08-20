import { useMemo, useState } from 'react';
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
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import AddIcon from '@mui/icons-material/Add';
import MoneyField from './MoneyField';
import { useMoneyFormatter } from '../hooks/useSettings';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  requiresReference,
  type PaymentMethod,
} from '@shared/domain';

interface PaymentLine {
  amount: number;
  paymentMethod: PaymentMethod;
  referenceNumber: string;
}

/** Quick cash amounts, rounded up from the total. */
function quickCashOptions(total: number): number[] {
  const steps = [10_000, 50_000, 100_000, 500_000, 1_000_000, 2_000_000, 5_000_000];
  const options = new Set<number>([total]);
  for (const step of steps) {
    const rounded = Math.ceil(total / step) * step;
    if (rounded > total) options.add(rounded);
  }
  return [...options].sort((a, b) => a - b).slice(0, 5);
}

/**
 * Taking payment (spec §36).
 *
 * Supports several methods on one sale (spec §17). Change is only offered
 * against cash, matching the rule the main process enforces.
 */
export default function PaymentDialog({
  grandTotal,
  submitting,
  onClose,
  onConfirm,
}: {
  grandTotal: number;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (
    payments: Array<{ amount: number; paymentMethod: string; referenceNumber?: string }>,
  ) => void;
}) {
  const money = useMoneyFormatter();
  const [lines, setLines] = useState<PaymentLine[]>([
    { amount: grandTotal, paymentMethod: 'CASH', referenceNumber: '' },
  ]);

  const paid = lines.reduce((sum, line) => sum + line.amount, 0);
  const cashPaid = lines
    .filter((l) => l.paymentMethod === 'CASH')
    .reduce((sum, line) => sum + line.amount, 0);

  const outstanding = Math.max(0, grandTotal - paid);
  const overpaid = Math.max(0, paid - grandTotal);
  const change = Math.min(overpaid, cashPaid);
  const overpaidNonCash = overpaid > cashPaid;

  const missingReference = lines.some(
    (l) => requiresReference(l.paymentMethod) && !l.referenceNumber.trim(),
  );

  const quickOptions = useMemo(() => quickCashOptions(grandTotal), [grandTotal]);

  const update = (index: number, patch: Partial<PaymentLine>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={submitting ? undefined : onClose}>
      <DialogTitle>Payment</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Box
            sx={{
              p: 2,
              borderRadius: 1,
              bgcolor: 'background.default',
              textAlign: 'center',
            }}
          >
            <Typography variant="body2" color="text.secondary">
              Grand Total
            </Typography>
            <Typography variant="h3" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {money(grandTotal)}
            </Typography>
          </Box>

          {lines.length === 1 && lines[0].paymentMethod === 'CASH' && (
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              {quickOptions.map((option) => (
                <Chip
                  key={option}
                  label={money(option)}
                  onClick={() => update(0, { amount: option })}
                  variant={lines[0].amount === option ? 'filled' : 'outlined'}
                  color={lines[0].amount === option ? 'primary' : 'default'}
                />
              ))}
            </Stack>
          )}

          {lines.map((line, index) => (
            <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <TextField
                select
                label="Method"
                value={line.paymentMethod}
                onChange={(e) =>
                  update(index, { paymentMethod: e.target.value as PaymentMethod })
                }
                sx={{ minWidth: 170 }}
              >
                {PAYMENT_METHODS.map((method) => (
                  <MenuItem key={method} value={method}>
                    {PAYMENT_METHOD_LABELS[method]}
                  </MenuItem>
                ))}
              </TextField>

              <MoneyField
                label="Amount received"
                value={line.amount}
                onChange={(amount) => update(index, { amount })}
                autoFocus={index === 0}
              />

              {requiresReference(line.paymentMethod) && (
                <TextField
                  label="Reference"
                  value={line.referenceNumber}
                  onChange={(e) => update(index, { referenceNumber: e.target.value })}
                  error={!line.referenceNumber.trim()}
                  helperText={!line.referenceNumber.trim() ? 'Required' : undefined}
                />
              )}

              {lines.length > 1 && (
                <IconButton
                  onClick={() => setLines((c) => c.filter((_, i) => i !== index))}
                  sx={{ mt: 0.5 }}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              )}
            </Stack>
          ))}

          {lines.length < 4 && (
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() =>
                setLines((c) => [
                  ...c,
                  { amount: outstanding, paymentMethod: 'BANK_TRANSFER', referenceNumber: '' },
                ])
              }
              sx={{ alignSelf: 'flex-start' }}
            >
              Split across another method
            </Button>
          )}

          <Divider />

          <Stack spacing={0.5}>
            <Row label="Paid" value={money(paid)} />
            {outstanding > 0 && (
              <Row label="Still owing" value={money(outstanding)} emphasis="warning" />
            )}
            {change > 0 && <Row label="Change" value={money(change)} emphasis="success" />}
          </Stack>

          {overpaidNonCash && (
            <Alert severity="error">
              Only a cash payment can be more than the total. Reduce the card or transfer amount.
            </Alert>
          )}

          {outstanding > 0 && (
            <Alert severity="info">
              This sale will be recorded as partially paid. The balance stays on the invoice.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          size="large"
          disabled={submitting || overpaidNonCash || missingReference}
          onClick={() =>
            onConfirm(
              lines
                .filter((line) => line.amount > 0)
                .map((line) => ({
                  amount: line.amount,
                  paymentMethod: line.paymentMethod,
                  referenceNumber: line.referenceNumber.trim() || undefined,
                })),
            )
          }
        >
          {submitting ? 'Completing…' : 'Complete Payment'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: 'warning' | 'success';
}) {
  return (
    <Stack direction="row">
      <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          fontWeight: emphasis ? 700 : 400,
          fontVariantNumeric: 'tabular-nums',
          color: emphasis ? `${emphasis}.main` : 'inherit',
        }}
      >
        {value}
      </Typography>
    </Stack>
  );
}
