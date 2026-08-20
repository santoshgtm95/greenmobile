import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import MoneyField from './MoneyField';
import { useMoneyFormatter } from '../hooks/useSettings';
import { PosApiError } from '@shared/errors';
import { formatInstant } from '@shared/datetime';
import type { CashInHand } from '@shared/api';

/**
 * Records what is actually in the drawer.
 *
 * A counted figure, not a calculated one — cash also moves through sales,
 * refunds, expenses and service deposits, so a number derived from the banking
 * ledger alone would be a guess wearing the clothes of a fact. Every count is
 * kept, so the previous one is shown here for comparison.
 */
export default function CashCountDialog({
  current,
  onClose,
  onSaved,
}: {
  current: CashInHand;
  onClose: () => void;
  onSaved: () => void;
}) {
  const money = useMoneyFormatter();

  const [amount, setAmount] = useState(current.amount);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api.banking.saveCashCount({ amount, notes: notes.trim() || undefined }),
    onSuccess: onSaved,
    onError: (err) =>
      setError(err instanceof PosApiError ? err.message : 'Unable to save that count.'),
  });

  const difference = amount - current.amount;

  return (
    <Dialog open fullWidth maxWidth="xs" onClose={onClose}>
      <DialogTitle>Cash in hand</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Typography variant="body2" color="text.secondary">
            Count the drawer and enter what is there. This figure is recorded as you type it — it is
            not worked out from sales or from the transactions on this screen.
          </Typography>

          <MoneyField label="Counted amount" required autoFocus value={amount} onChange={setAmount} />

          {current.recorded && (
            <Alert severity={difference === 0 ? 'info' : 'warning'} variant="outlined">
              Last counted {money(current.amount)} on {formatInstant(current.countedAt)}
              {current.countedByName ? ` by ${current.countedByName}` : ''}.
              {difference !== 0 && (
                <>
                  {' '}
                  This is a change of{' '}
                  <strong>
                    {difference > 0 ? '+' : '−'}
                    {money(Math.abs(difference))}
                  </strong>
                  .
                </>
              )}
            </Alert>
          )}

          <TextField
            label="Notes"
            multiline
            minRows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            helperText="Why it changed, or who counted it"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => {
            setError(null);
            save.mutate();
          }}
          disabled={save.isPending}
        >
          {save.isPending ? 'Saving…' : 'Save count'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
