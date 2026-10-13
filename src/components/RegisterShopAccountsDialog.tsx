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
  MenuItem,
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
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { PosApiError } from '@shared/errors';
import type { ShopBankAccount } from '@shared/api';

/**
 * Register and manage the shop's own banking accounts.
 *
 * Each registered shop account ties a Bank/Wallet provider to a specific
 * Account Number and Account Name (e.g. KBZPay - 0912345678 - Green Mobile).
 * These pre-populate the transaction form for Account Transfer (Cash In) and
 * Account Receive (Cash Out).
 */
export default function RegisterShopAccountsDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged?: () => void;
}) {
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<ShopBankAccount | null>(null);
  const [bankAccountId, setBankAccountId] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Providers registered in the system (e.g. KBZ Bank, Kpay, WavePay)
  const bankProviders = useQuery({
    queryKey: ['bankAccounts', 'active'],
    queryFn: () => api.banking.listAccounts({ includeInactive: false }),
  });

  // All shop accounts (including inactive when managing)
  const shopAccounts = useQuery({
    queryKey: ['shopBankAccounts', 'all'],
    queryFn: () => api.banking.listShopAccounts({ includeInactive: true }),
  });

  const reset = () => {
    setEditing(null);
    setBankAccountId('');
    setAccountNumber('');
    setAccountName('');
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
    void queryClient.invalidateQueries({ queryKey: ['shopBankAccounts'] });
    if (onChanged) onChanged();
  };

  const save = useMutation({
    mutationFn: () =>
      api.banking.saveShopAccount({
        id: editing?.id,
        bankAccountId,
        accountNumber: accountNumber.trim(),
        accountName: accountName.trim(),
        isActive,
      }),
    onSuccess: () => {
      reset();
      refresh();
    },
    onError: fail('Unable to save shop account.'),
  });

  const remove = useMutation({
    mutationFn: (account: ShopBankAccount) => api.banking.deleteShopAccount({ id: account.id }),
    onSuccess: () => {
      reset();
      refresh();
    },
    onError: fail('Unable to delete shop account.'),
  });

  const providers = bankProviders.data ?? [];
  const rows = shopAccounts.data ?? [];

  return (
    <Dialog open fullWidth maxWidth="md" onClose={onClose}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AccountBalanceWalletIcon color="primary" />
        Register Shop Accounts
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Typography variant="body2" color="text.secondary">
            Register each shop banking and mobile wallet account with its provider, account number,
            and account holder name. Once registered, these accounts can be selected quickly from a
            dropdown in <strong>Account Transfer (Cash In)</strong> and{' '}
            <strong>Account Receive (Cash Out)</strong> transactions.
          </Typography>

          {providers.length === 0 && (
            <Alert severity="warning">
              No banks or mobile payment providers are registered yet. Please add a bank or payment
              provider in <strong>Banks &amp; Payments</strong> first.
            </Alert>
          )}

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'flex-start' }}>
            <TextField
              select
              label="Bank / Wallet type"
              required
              disabled={providers.length === 0}
              value={bankAccountId}
              onChange={(e) => {
                setBankAccountId(e.target.value);
                setFieldErrors((prev) => ({ ...prev, bankAccountId: '' }));
              }}
              error={Boolean(fieldErrors.bankAccountId)}
              helperText={fieldErrors.bankAccountId ?? 'Choose provider'}
              sx={{ flex: '1 1 200px', minWidth: 180 }}
            >
              <MenuItem value="" disabled>
                <em>Select bank/wallet</em>
              </MenuItem>
              {providers.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name} ({p.key})
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label="Account Number"
              placeholder="09 1234 5678"
              required
              value={accountNumber}
              onChange={(e) => {
                setAccountNumber(e.target.value);
                setFieldErrors((prev) => ({ ...prev, accountNumber: '' }));
              }}
              error={Boolean(fieldErrors.accountNumber)}
              helperText={fieldErrors.accountNumber}
              sx={{ flex: '1 1 200px', minWidth: 180 }}
            />

            <TextField
              label="Account Name"
              placeholder="Green Mobile Shop"
              required
              value={accountName}
              onChange={(e) => {
                setAccountName(e.target.value);
                setFieldErrors((prev) => ({ ...prev, accountName: '' }));
              }}
              error={Boolean(fieldErrors.accountName)}
              helperText={fieldErrors.accountName}
              sx={{ flex: '1 1 220px', minWidth: 180 }}
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
                save.isPending ||
                !bankAccountId ||
                !accountNumber.trim() ||
                !accountName.trim()
              }
              sx={{ mt: 0.25, whiteSpace: 'nowrap' }}
            >
              {editing ? 'Save' : 'Register'}
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
                  ? 'On — available in transaction dropdowns'
                  : 'Off — hidden from new transaction dropdowns'}
              </Typography>
            </Stack>
          )}

          <Divider />

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Bank / Wallet</TableCell>
                <TableCell>Account Number</TableCell>
                <TableCell>Account Name</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    No shop accounts registered yet. Register your first account above.
                  </TableCell>
                </TableRow>
              )}

              {rows.map((account) => (
                <TableRow key={account.id} hover sx={{ opacity: account.isActive ? 1 : 0.6 }}>
                  <TableCell>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {account.bankName}
                      </Typography>
                      <Chip
                        size="small"
                        label={account.bankKey}
                        sx={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.75rem' }}
                      />
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                    {account.accountNumber}
                  </TableCell>
                  <TableCell>{account.accountName}</TableCell>
                  <TableCell>
                    {account.isActive === 1 ? (
                      <Chip size="small" color="success" variant="outlined" label="On" />
                    ) : (
                      <Chip size="small" label="Off" />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                      <Tooltip title="Edit account details or switch off">
                        <IconButton
                          size="small"
                          onClick={() => {
                            setError(null);
                            setFieldErrors({});
                            setEditing(account);
                            setBankAccountId(account.bankAccountId);
                            setAccountNumber(account.accountNumber);
                            setAccountName(account.accountName);
                            setIsActive(account.isActive === 1);
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>

                      <Tooltip title="Delete registered shop account">
                        <IconButton
                          size="small"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete registered account "${account.accountNumber}" (${account.accountName})?\n\n` +
                                  'This only removes the quick preset from the dropdown; recorded transaction history is preserved.',
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
