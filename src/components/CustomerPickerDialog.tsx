import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  InputAdornment,
  List,
  ListItemButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useDebounced } from '../hooks/useDebounced';
import { useAuth } from '../hooks/useAuth';
import { PosApiError } from '@shared/errors';

export interface PickedCustomer {
  id: string;
  name: string;
  phone: string | null;
}

/** Choosing or creating a customer at the till (spec §35). */
export default function CustomerPickerDialog({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (customer: PickedCustomer) => void;
}) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  const debounced = useDebounced(search, 250);

  const customers = useQuery({
    queryKey: ['customers', debounced],
    queryFn: () =>
      api.customers.list({
        search: debounced || undefined,
        includeInactive: false,
        page: 0,
        pageSize: 30,
      }),
  });

  const create = useMutation({
    mutationFn: () =>
      api.customers.create({
        name: newName.trim(),
        phone: newPhone.trim() || undefined,
        email: undefined,
        address: undefined,
        notes: undefined,
      }),
    onSuccess: (customer) => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      onPick({ id: customer.id, name: customer.name, phone: customer.phone });
    },
    onError: (err) =>
      setError(err instanceof PosApiError ? err.message : 'Unable to create that customer.'),
  });

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>Customer</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}

          {!creating && (
            <>
              <TextField
                autoFocus
                placeholder="Search by name, phone or customer code"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  },
                }}
              />

              <List dense disablePadding sx={{ maxHeight: 320, overflow: 'auto' }}>
                {(customers.data?.rows.length ?? 0) === 0 && (
                  <Typography color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                    {search ? 'No customers match.' : 'No customers yet.'}
                  </Typography>
                )}
                {(customers.data?.rows ?? []).map((customer) => (
                  <ListItemButton
                    key={customer.id}
                    onClick={() =>
                      onPick({ id: customer.id, name: customer.name, phone: customer.phone })
                    }
                    sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
                  >
                    <Stack sx={{ flexGrow: 1 }}>
                      <Typography sx={{ fontWeight: 600 }}>{customer.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {customer.phone ?? 'No phone'} · {customer.customerCode} ·{' '}
                        {customer.totalOrders} order(s)
                      </Typography>
                    </Stack>
                  </ListItemButton>
                ))}
              </List>

              {can('customers.manage') && (
                <>
                  <Divider />
                  <Button startIcon={<PersonAddIcon />} onClick={() => setCreating(true)}>
                    New customer
                  </Button>
                </>
              )}
            </>
          )}

          {creating && (
            <Stack spacing={2}>
              <TextField
                autoFocus
                label="Name"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <TextField
                label="Phone"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                helperText="Optional, but makes the customer easy to find later"
              />
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {creating ? (
          <>
            <Button onClick={() => setCreating(false)}>Back</Button>
            <Button
              variant="contained"
              onClick={() => {
                setError(null);
                create.mutate();
              }}
              disabled={create.isPending || !newName.trim()}
            >
              {create.isPending ? 'Creating…' : 'Create and use'}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Cancel</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
