import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { PosApiError } from '@shared/errors';
import type { Customer } from '@shared/api';

/** Customer form (spec §14, §73). `customer === null` means "create". */
export default function CustomerDialog({
  customer,
  onClose,
  onSaved,
}: {
  customer: Customer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = customer !== null;

  const [form, setForm] = useState({
    name: customer?.name ?? '',
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    address: customer?.address ?? '',
    notes: customer?.notes ?? '',
    isActive: customer ? customer.isActive === 1 : true,
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
        notes: form.notes.trim() || undefined,
      };
      return isEdit
        ? api.customers.update({ ...payload, id: customer.id, isActive: form.isActive })
        : api.customers.create(payload);
    },
    onSuccess: onSaved,
    onError: (err) => {
      if (err instanceof PosApiError) {
        setError(err.message);
        setFieldErrors(err.fields ?? {});
      } else {
        setError('Unable to save this customer.');
      }
    },
  });

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>
        {isEdit ? `Edit ${customer.name}` : 'Add customer'}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="Name"
            required
            autoFocus
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            error={Boolean(fieldErrors.name)}
            helperText={fieldErrors.name}
          />

          <Stack direction="row" spacing={2}>
            <TextField
              label="Phone"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              error={Boolean(fieldErrors.phone)}
              helperText={fieldErrors.phone ?? 'The fastest way to find someone later'}
            />
            <TextField
              label="Email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              error={Boolean(fieldErrors.email)}
              helperText={fieldErrors.email}
            />
          </Stack>

          <TextField
            label="Address"
            multiline
            minRows={2}
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
          />

          <TextField
            label="Notes"
            multiline
            minRows={2}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />

          {isEdit && (
            <>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.isActive}
                    onChange={(e) => set('isActive', e.target.checked)}
                  />
                }
                label="Active"
              />
              <Alert severity="info">
                Customers are never deleted — deactivating one hides them from new sales while
                keeping their purchase and service history intact.
              </Alert>
            </>
          )}
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
          disabled={save.isPending || !form.name.trim()}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
