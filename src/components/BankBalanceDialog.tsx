import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import MoneyField from './MoneyField';
import { useMoneyFormatter } from '../hooks/useSettings';
import { PosApiError } from '@shared/errors';
import type { BankAccountPosition } from '@shared/api';

/**
 * Dialog to adjust bank and wallet balances so they match statements or mobile banking apps.
 *
 * Updates each account's balance cleanly via an adjustment record without touching cash in hand.
 */
export default function BankBalanceDialog({
  accounts,
  onClose,
  onSaved,
}: {
  accounts: BankAccountPosition[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const money = useMoneyFormatter();

  const [balances, setBalances] = useState<Record<string, number>>(() =>
    Object.fromEntries(accounts.map((a) => [a.accountId, a.balance])),
  );
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const currentTotal = accounts.reduce((sum, a) => sum + a.balance, 0);
  const newTotal = accounts.reduce(
    (sum, a) => sum + (balances[a.accountId] ?? a.balance),
    0,
  );
  const totalDiff = newTotal - currentTotal;

  const hasChanges = accounts.some(
    (a) => a.isActive && (balances[a.accountId] ?? a.balance) !== a.balance,
  );

  const save = useMutation({
    mutationFn: () => {
      const changed = accounts
        .filter((a) => a.isActive && (balances[a.accountId] ?? a.balance) !== a.balance)
        .map((a) => ({
          accountId: a.accountId,
          balance: balances[a.accountId] ?? a.balance,
        }));
      return api.banking.saveBankBalances({
        balances: changed,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: onSaved,
    onError: (err) =>
      setError(
        err instanceof PosApiError ? err.message : 'Unable to update bank balances.',
      ),
  });

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>In the banks</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Typography variant="body2" color="text.secondary">
            Set the actual balance for each bank or wallet account to match your banking apps
            or statements. Each change records a balance adjustment for that account without touching cash in hand.
          </Typography>

          <Stack spacing={2}>
            {accounts.map((account) => {
              const currentBalance = account.balance;
              const newBalance = balances[account.accountId] ?? currentBalance;
              const diff = newBalance - currentBalance;

              return (
                <Paper
                  key={account.accountId}
                  variant="outlined"
                  sx={{
                    p: 2,
                    opacity: account.isActive ? 1 : 0.65,
                    bgcolor: (theme) =>
                      account.isActive ? theme.palette.background.paper : theme.palette.action.hover,
                  }}
                >
                  <Stack spacing={1.5}>
                    <Stack
                      direction="row"
                      sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {account.name}
                        </Typography>
                        <Chip
                          size="small"
                          label={account.key}
                          sx={{ fontFamily: 'monospace', fontWeight: 600 }}
                        />
                        {account.isActive === 0 && (
                          <Chip size="small" label="Off" color="default" />
                        )}
                      </Stack>

                      <Typography variant="caption" color="text.secondary">
                        Current: <strong>{money(currentBalance)}</strong>
                      </Typography>
                    </Stack>

                    {account.isActive ? (
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={2}
                        sx={{ alignItems: 'center' }}
                      >
                        <Box sx={{ flex: 1, width: '100%' }}>
                          <MoneyField
                            label="New balance"
                            required
                            value={newBalance}
                            onChange={(val) =>
                              setBalances((prev) => ({
                                ...prev,
                                [account.accountId]: val,
                              }))
                            }
                          />
                        </Box>
                        {diff !== 0 && (
                          <Chip
                            size="small"
                            color={diff > 0 ? 'success' : 'error'}
                            variant="outlined"
                            label={`${diff > 0 ? '+' : '−'}${money(Math.abs(diff))}`}
                            sx={{ fontWeight: 600, alignSelf: { xs: 'flex-start', sm: 'center' } }}
                          />
                        )}
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        This account is switched off. Turn it on in account settings to adjust its balance.
                      </Typography>
                    )}
                  </Stack>
                </Paper>
              );
            })}
          </Stack>

          <Alert severity={totalDiff === 0 ? 'info' : 'warning'} variant="outlined">
            Total in the banks: <strong>{money(currentTotal)}</strong>
            {totalDiff !== 0 && (
              <>
                {' '}
                → <strong>{money(newTotal)}</strong> (
                {totalDiff > 0 ? '+' : '−'}
                {money(Math.abs(totalDiff))})
              </>
            )}
          </Alert>

          <TextField
            label="Notes"
            multiline
            minRows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            helperText="Reason for the balance adjustment (optional)"
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
          disabled={save.isPending || !hasChanges}
        >
          {save.isPending ? 'Saving…' : 'Save balances'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
