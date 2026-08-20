import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import LockIcon from '@mui/icons-material/Lock';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { PosApiError } from '@shared/errors';
import type { BankAccount } from '@shared/api';

/**
 * The shop's own banks and mobile wallets.
 *
 * Two rules are visible on this screen rather than only enforced behind it,
 * because both are one-way doors and a user should be able to see that coming:
 *
 *   the KEY is locked once the account exists — it labels every transaction
 *   already recorded, so changing it would rewrite history
 *
 *   an account that has been USED cannot be deleted, only switched off — the
 *   delete button disappears the moment the first transaction is recorded
 */
export default function BankAccountsDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const accounts = useQuery({
    queryKey: ['bankAccounts', 'all'],
    queryFn: () => api.banking.listAccounts({ includeInactive: true }),
  });

  const reset = () => {
    setEditing(null);
    setName('');
    setKey('');
    setDescription('');
    setIsActive(true);
    setFieldErrors({});
  };

  const fail = (fallback: string) => (err: unknown) => {
    if (err instanceof PosApiError) {
      setError(err.message);
      setFieldErrors(err.fields ?? {});
    } else {
      setError(fallback);
    }
  };

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['bankAccounts'] });
    onChanged();
  };

  const save = useMutation({
    mutationFn: () =>
      api.banking.saveAccount({
        id: editing?.id,
        name: name.trim(),
        // Sent unchanged when editing; the main process refuses a different one.
        key: editing ? editing.key : key.trim(),
        description: description.trim() || undefined,
        isActive,
      }),
    onSuccess: () => {
      reset();
      refresh();
    },
    onError: fail('Unable to save that account.'),
  });

  const remove = useMutation({
    mutationFn: (account: BankAccount) => api.banking.deleteAccount({ id: account.id }),
    onSuccess: () => {
      reset();
      refresh();
    },
    onError: fail('Unable to delete that account.'),
  });

  const rows = accounts.data ?? [];

  return (
    <Dialog open fullWidth maxWidth="md" onClose={onClose}>
      <DialogTitle>Banks and mobile payments</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Typography variant="body2" color="text.secondary">
            Register each bank or mobile wallet the shop uses — the name it is known by, and a short
            key that identifies it on the transaction list. For example <strong>Kanbawza</strong>{' '}
            with the key <strong>Kpay</strong>. Account numbers are not entered here: one wallet
            serves many of them, so each is typed on the transaction itself.
          </Typography>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'flex-start' }}>
            <TextField
              label={editing ? 'Rename account' : 'Name'}
              placeholder="Kanbawza"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              error={Boolean(fieldErrors.name)}
              helperText={fieldErrors.name}
              sx={{ flex: '1 1 260px', minWidth: 240 }}
            />
            <TextField
              label="Key"
              placeholder="Kpay"
              value={editing ? editing.key : key}
              onChange={(e) => setKey(e.target.value)}
              disabled={Boolean(editing)}
              error={Boolean(fieldErrors.key)}
              // Kept to one line: at this width a longer message wrapped and made
              // the row taller than its neighbours. The lock icon's tooltip
              // carries the full explanation.
              helperText={fieldErrors.key ?? (editing ? 'Cannot be changed' : 'No spaces')}
              slotProps={
                editing
                  ? {
                      input: {
                        endAdornment: (
                          <Tooltip title="Locked — this key already labels recorded transactions">
                            <LockIcon fontSize="small" sx={{ color: 'text.disabled' }} />
                          </Tooltip>
                        ),
                      },
                    }
                  : undefined
              }
              sx={{ width: 200 }}
            />
            <TextField
              label="Description"
              placeholder="Main current account"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              sx={{ flexGrow: 1, minWidth: 240 }}
            />
            <Button
              variant="contained"
              startIcon={editing ? <EditIcon /> : <AddIcon />}
              onClick={() => {
                setError(null);
                setFieldErrors({});
                save.mutate();
              }}
              disabled={
                save.isPending || !name.trim() || (!editing && key.trim().length < 2)
              }
              sx={{ mt: 0.25 }}
            >
              {editing ? 'Save' : 'Add'}
            </Button>
            {editing && (
              <Button onClick={reset} sx={{ mt: 0.25 }}>
                Cancel
              </Button>
            )}
          </Stack>

          {editing && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <Typography variant="body2">
                {isActive
                  ? 'On — can be chosen when recording a transaction'
                  : 'Off — hidden from new transactions, and its history and balance are kept'}
              </Typography>
            </Stack>
          )}

          <Divider />

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Account</TableCell>
                <TableCell>Key</TableCell>
                <TableCell align="right">Transactions</TableCell>
                <TableCell>State</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    No accounts registered yet. Add the first one above.
                  </TableCell>
                </TableRow>
              )}

              {rows.map((account) => (
                <TableRow key={account.id} hover sx={{ opacity: account.isActive ? 1 : 0.6 }}>
                  <TableCell>
                    {account.name}
                    {account.description && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {account.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={account.key}
                      sx={{ fontFamily: 'monospace', fontWeight: 600 }}
                    />
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {account.transactionCount || '—'}
                  </TableCell>
                  <TableCell>
                    {account.isActive === 1 ? (
                      <Chip size="small" color="success" variant="outlined" label="On" />
                    ) : (
                      <Chip size="small" label="Off" />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                      <Tooltip title="Rename, describe or switch off">
                        <IconButton
                          size="small"
                          onClick={() => {
                            setError(null);
                            setFieldErrors({});
                            setEditing(account);
                            setName(account.name);
                            setDescription(account.description ?? '');
                            setIsActive(account.isActive === 1);
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>

                      {/* Gone once the key has been used — see the file comment. */}
                      {account.canDelete ? (
                        <Tooltip title="Delete — this account has never been used">
                          <IconButton
                            size="small"
                            disabled={remove.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete "${account.name}" (${account.key})?\n\n` +
                                    'It has never been used, so nothing is lost. The key becomes available again.',
                                )
                              ) {
                                setError(null);
                                remove.mutate(account);
                              }
                            }}
                          >
                            <DeleteOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : (
                        <Tooltip title="Cannot be deleted — it is used by recorded transactions. Switch it off instead.">
                          <span>
                            <IconButton size="small" disabled>
                              <LockIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
