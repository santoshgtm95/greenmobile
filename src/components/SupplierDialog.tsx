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
import type { Supplier } from '@shared/api';

/** Registers a supplier, or edits one. `supplier === null` means "create". */
export default function SupplierDialog({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: (supplier: Supplier) => void;
}) {
  const [name, setName] = useState(supplier?.name ?? '');
  const [address, setAddress] = useState(supplier?.address ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [isActive, setIsActive] = useState(supplier ? supplier.isActive === 1 : true);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () =>
      api.suppliers.save({ id: supplier?.id, name: name.trim(), address: address.trim(), phone: phone.trim(), isActive }),
    onSuccess: onSaved,
    onError: (err) => {
      setError(err instanceof PosApiError ? err.message : 'Unable to save this supplier.');
      setFieldErrors(err instanceof PosApiError ? (err.fields ?? {}) : {});
    },
  });

  return (
    <Dialog open fullWidth maxWidth="xs" onClose={save.isPending ? undefined : onClose}>
      <DialogTitle>{supplier ? `Edit ${supplier.name}` : 'Register supplier'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Name"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={Boolean(fieldErrors.name)}
            helperText={fieldErrors.name}
          />
          <TextField
            label="Phone number"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={Boolean(fieldErrors.phone)}
            helperText={fieldErrors.phone}
          />
          <TextField label="Address" multiline minRows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
          {supplier && (
            <FormControlLabel
              control={<Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />}
              label="Active (shown when ordering)"
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
