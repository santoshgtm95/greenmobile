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
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import MoneyField from './MoneyField';
import { PosApiError } from '@shared/errors';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  requiresReference,
  type PaymentMethod,
} from '@shared/domain';
import { businessDay } from '@shared/datetime';
import type { Expense, ExpenseCategory } from '@shared/api';

/** Expense form (spec §19, §73). `expense === null` means "create". */
export default function ExpenseDialog({
  expense,
  categories,
  onClose,
  onSaved,
}: {
  expense: Expense | null;
  categories: ExpenseCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = expense !== null;

  const [form, setForm] = useState({
    categoryId: expense?.categoryId ?? categories[0]?.id ?? '',
    expenseDay: expense?.expenseDay ?? businessDay(),
    description: expense?.description ?? '',
    amount: expense?.amount ?? 0,
    paymentMethod: (expense?.paymentMethod as PaymentMethod) ?? 'CASH',
    referenceNumber: expense?.referenceNumber ?? '',
    notes: expense?.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        categoryId: form.categoryId,
        expenseDay: form.expenseDay,
        description: form.description.trim(),
        amount: form.amount,
        paymentMethod: form.paymentMethod,
        referenceNumber: form.referenceNumber.trim() || undefined,
        notes: form.notes.trim() || undefined,
      };
      return isEdit
        ? api.expenses.update({ ...payload, id: expense.id })
        : api.expenses.create(payload);
    },
    onSuccess: onSaved,
    onError: (err) => {
      if (err instanceof PosApiError) {
        setError(err.message);
        setFieldErrors(err.fields ?? {});
      } else {
        setError('Unable to save this expense.');
      }
    },
  });

  const referenceRequired = requiresReference(form.paymentMethod);

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>{isEdit ? `Edit ${expense.expenseNumber}` : 'Add expense'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {categories.length === 0 && (
            <Alert severity="warning">
              There are no active expense categories. Add one from the Categories button first.
            </Alert>
          )}

          <Stack direction="row" spacing={2}>
            <TextField
              select
              label="Category"
              required
              value={form.categoryId}
              onChange={(e) => set('categoryId', e.target.value)}
              error={Boolean(fieldErrors.categoryId)}
              helperText={fieldErrors.categoryId}
            >
              {categories.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label="Date"
              type="date"
              required
              value={form.expenseDay}
              onChange={(e) => set('expenseDay', e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              error={Boolean(fieldErrors.expenseDay)}
              helperText={fieldErrors.expenseDay}
            />
          </Stack>

          <TextField
            label="Description"
            required
            autoFocus
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            error={Boolean(fieldErrors.description)}
            helperText={fieldErrors.description ?? 'What the money was spent on'}
          />

          <Stack direction="row" spacing={2}>
            <MoneyField
              label="Amount"
              value={form.amount}
              onChange={(v) => set('amount', v)}
              error={Boolean(fieldErrors.amount)}
              helperText={fieldErrors.amount}
            />

            <TextField
              select
              label="Paid by"
              value={form.paymentMethod}
              onChange={(e) => set('paymentMethod', e.target.value as PaymentMethod)}
            >
              {PAYMENT_METHODS.map((method) => (
                <MenuItem key={method} value={method}>
                  {PAYMENT_METHOD_LABELS[method]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          {referenceRequired && (
            <TextField
              label="Reference number"
              value={form.referenceNumber}
              onChange={(e) => set('referenceNumber', e.target.value)}
              helperText="Transfer or card reference, so it can be matched to a bank statement"
            />
          )}

          <TextField
            label="Notes"
            multiline
            minRows={2}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => {
            setError(null);
            setFieldErrors({});
            save.mutate();
          }}
          disabled={
            save.isPending ||
            !form.categoryId ||
            !form.description.trim() ||
            form.amount <= 0
          }
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
