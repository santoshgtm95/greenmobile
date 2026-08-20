import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { PosApiError } from '@shared/errors';
import type { Product } from '@shared/api';

const REASONS = [
  'Stock count correction',
  'Received from supplier',
  'Damaged / broken',
  'Lost or stolen',
  'Used for repair',
  'Returned to supplier',
];

/**
 * Stock adjustment (spec §20, §67).
 *
 * "Count" asks for the level actually on the shelf and derives the movement,
 * which is how a stock-take is really done; "Add or remove" takes a delta.
 * A reason is required either way — stock never moves silently.
 */
export default function StockDialog({
  product,
  onClose,
  onSaved,
}: {
  product: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<'SET' | 'CHANGE'>('SET');
  const [counted, setCounted] = useState(product.stockQuantity);
  const [delta, setDelta] = useState(0);
  const [transactionType, setTransactionType] =
    useState<'PURCHASE' | 'ADJUSTMENT' | 'DAMAGE' | 'SERVICE_USAGE'>('ADJUSTMENT');
  const [reason, setReason] = useState(REASONS[0]);
  const [error, setError] = useState<string | null>(null);

  const resulting = mode === 'SET' ? counted : product.stockQuantity + delta;
  const change = resulting - product.stockQuantity;

  const save = useMutation({
    mutationFn: () =>
      api.products.adjustStock({
        productId: product.id,
        mode,
        quantity: mode === 'SET' ? counted : delta,
        transactionType,
        reason: reason.trim(),
        unitCost: undefined,
      }),
    onSuccess: onSaved,
    onError: (err) =>
      setError(err instanceof PosApiError ? err.message : 'Unable to adjust stock.'),
  });

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>Adjust stock — {product.name}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Typography variant="body2" color="text.secondary">
            Current stock: <strong>{product.stockQuantity}</strong> {product.unit}
          </Typography>

          <ToggleButtonGroup
            exclusive
            fullWidth
            value={mode}
            onChange={(_e, next) => next && setMode(next)}
          >
            <ToggleButton value="SET">Count — set the actual level</ToggleButton>
            <ToggleButton value="CHANGE">Add or remove</ToggleButton>
          </ToggleButtonGroup>

          {mode === 'SET' ? (
            <TextField
              label="Counted quantity"
              type="number"
              autoFocus
              value={counted}
              onChange={(e) => setCounted(Math.max(0, Number(e.target.value) || 0))}
              helperText="How many are actually on the shelf"
            />
          ) : (
            <TextField
              label="Change"
              type="number"
              autoFocus
              value={delta}
              onChange={(e) => setDelta(Number(e.target.value) || 0)}
              helperText="Positive to add, negative to remove"
            />
          )}

          <TextField
            select
            label="Movement type"
            value={transactionType}
            onChange={(e) => setTransactionType(e.target.value as typeof transactionType)}
          >
            <MenuItem value="ADJUSTMENT">Adjustment</MenuItem>
            <MenuItem value="PURCHASE">Purchase / stock in</MenuItem>
            <MenuItem value="DAMAGE">Damage or loss</MenuItem>
            <MenuItem value="SERVICE_USAGE">Used in a repair</MenuItem>
          </TextField>

          <TextField
            label="Reason"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            helperText="Recorded permanently in the inventory history"
            slotProps={{ htmlInput: { list: 'stock-reasons' } }}
          />
          <datalist id="stock-reasons">
            {REASONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>

          <Alert severity={change === 0 ? 'info' : change > 0 ? 'success' : 'warning'}>
            {change === 0
              ? 'No change to stock.'
              : `Stock will go from ${product.stockQuantity} to ${resulting} (${change > 0 ? '+' : ''}${change}).`}
          </Alert>
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
          disabled={save.isPending || change === 0 || !reason.trim()}
        >
          {save.isPending ? 'Saving…' : 'Apply adjustment'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
