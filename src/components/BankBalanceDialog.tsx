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
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import MoneyField from './MoneyField';
import { useMoneyFormatter } from '../hooks/useSettings';
import { PosApiError } from '@shared/errors';
import type { BankAccountPosition, ShopBankAccount } from '@shared/api';

interface BankShopGroup {
  bankAccountId: string;
  bankName: string;
  bankKey: string;
  accounts: ShopBankAccount[];
}

/**
 * Dialog to adjust bank and wallet balances so they match statements or mobile banking apps.
 *
 * If one bank has multiple registered shop accounts (e.g. Kanbawza Kpay), they are shown
 * together in ONE Paper Stack with the total amount of all accounts for that bank on top.
 * Updates each account's balance cleanly via an adjustment record in the DB without touching cash in hand.
 */
export default function BankBalanceDialog({
  accounts = [],
  onClose,
  onSaved,
}: {
  accounts?: BankAccountPosition[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const money = useMoneyFormatter();

  // Load registered shop accounts
  const shopAccountsQuery = useQuery({
    queryKey: ['shopBankAccounts', 'all'],
    queryFn: () => api.banking.listShopAccounts({ includeInactive: true }),
  });
  const shopAccounts = shopAccountsQuery.data ?? [];

  // Track new balances for shop accounts
  const [shopBalances, setShopBalances] = useState<Record<string, number>>({});

  // Track new balances for generic bank accounts (if any exist without shop accounts)
  const [bankBalances, setBankBalances] = useState<Record<string, number>>(() =>
    Object.fromEntries(accounts.map((a) => [a.accountId, a.balance])),
  );

  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Group shop accounts by bank/wallet provider
  const groupedShopAccounts = useMemo(() => {
    const groups = new Map<string, BankShopGroup>();

    for (const account of shopAccounts) {
      let group = groups.get(account.bankAccountId);
      if (!group) {
        group = {
          bankAccountId: account.bankAccountId,
          bankName: account.bankName,
          bankKey: account.bankKey,
          accounts: [],
        };
        groups.set(account.bankAccountId, group);
      }
      group.accounts.push(account);
    }

    return Array.from(groups.values());
  }, [shopAccounts]);

  // Bank accounts that do NOT have any registered shop account
  const bankAccountsWithoutShopAccount = useMemo(() => {
    if (shopAccounts.length === 0) return accounts;
    const coveredBankIds = new Set(shopAccounts.map((s) => s.bankAccountId));
    return accounts.filter((a) => !coveredBankIds.has(a.accountId));
  }, [accounts, shopAccounts]);

  // Calculate current & new totals across everything
  const currentTotal = useMemo(() => {
    if (shopAccounts.length > 0) {
      const shopSum = shopAccounts.reduce((sum, s) => sum + (s.balance ?? 0), 0);
      const otherBankSum = bankAccountsWithoutShopAccount.reduce((sum, b) => sum + b.balance, 0);
      return shopSum + otherBankSum;
    }
    return accounts.reduce((sum, a) => sum + a.balance, 0);
  }, [shopAccounts, bankAccountsWithoutShopAccount, accounts]);

  const newTotal = useMemo(() => {
    if (shopAccounts.length > 0) {
      const shopSum = shopAccounts.reduce(
        (sum, s) => sum + (shopBalances[s.id] ?? s.balance ?? 0),
        0,
      );
      const otherBankSum = bankAccountsWithoutShopAccount.reduce(
        (sum, b) => sum + (bankBalances[b.accountId] ?? b.balance),
        0,
      );
      return shopSum + otherBankSum;
    }
    return accounts.reduce(
      (sum, a) => sum + (bankBalances[a.accountId] ?? a.balance),
      0,
    );
  }, [shopAccounts, shopBalances, bankAccountsWithoutShopAccount, bankBalances, accounts]);

  const totalDiff = newTotal - currentTotal;

  const hasShopChanges = shopAccounts.some(
    (s) =>
      s.isActive === 1 &&
      shopBalances[s.id] !== undefined &&
      shopBalances[s.id] !== (s.balance ?? 0),
  );

  const hasBankChanges = bankAccountsWithoutShopAccount.some(
    (b) =>
      b.isActive === 1 &&
      bankBalances[b.accountId] !== undefined &&
      bankBalances[b.accountId] !== b.balance,
  );

  const hasChanges = hasShopChanges || hasBankChanges;

  const save = useMutation({
    mutationFn: () => {
      const changedShopAccounts = shopAccounts
        .filter(
          (s) =>
            s.isActive === 1 &&
            shopBalances[s.id] !== undefined &&
            shopBalances[s.id] !== (s.balance ?? 0),
        )
        .map((s) => ({
          shopAccountId: s.id,
          balance: shopBalances[s.id] ?? (s.balance ?? 0),
        }));

      const changedBankAccounts = bankAccountsWithoutShopAccount
        .filter(
          (b) =>
            b.isActive === 1 &&
            bankBalances[b.accountId] !== undefined &&
            bankBalances[b.accountId] !== b.balance,
        )
        .map((b) => ({
          accountId: b.accountId,
          balance: bankBalances[b.accountId] ?? b.balance,
        }));

      return api.banking.saveBankBalances({
        shopAccountBalances: changedShopAccounts,
        balances: changedBankAccounts,
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
    <Dialog open fullWidth maxWidth="md" onClose={onClose}>
      <DialogTitle>In the banks</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Typography variant="body2" color="text.secondary">
            Set the actual balance for each bank or wallet account to match your banking apps
            or statements. Each change records a balance adjustment in the database without touching cash in hand.
          </Typography>

          {/* Grouped Shop Accounts by Bank Provider */}
          {groupedShopAccounts.length > 0 && (
            <Stack spacing={2.5}>
              {groupedShopAccounts.map((group) => {
                const groupCurrentTotal = group.accounts.reduce(
                  (sum, a) => sum + (a.balance ?? 0),
                  0,
                );
                const groupNewTotal = group.accounts.reduce(
                  (sum, a) => sum + (shopBalances[a.id] ?? a.balance ?? 0),
                  0,
                );
                const groupDiff = groupNewTotal - groupCurrentTotal;

                return (
                  <Paper
                    key={group.bankAccountId}
                    variant="outlined"
                    sx={{
                      p: 2.5,
                      borderRadius: 2,
                      borderColor: 'divider',
                      bgcolor: (theme) =>
                        theme.palette.mode === 'dark'
                          ? 'background.paper'
                          : '#fafafa',
                    }}
                  >
                    <Stack spacing={2}>
                      {/* Header on top of the Paper Stack: Bank provider + Total amount for this bank */}
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        sx={{
                          justifyContent: 'space-between',
                          alignItems: { xs: 'flex-start', sm: 'center' },
                          pb: 1.5,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                          gap: 1.5,
                        }}
                      >
                        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 700, fontSize: '1.05rem' }}>
                            {group.bankName}
                          </Typography>
                          <Chip
                            size="small"
                            label={group.bankKey}
                            color="primary"
                            variant="outlined"
                            sx={{ fontFamily: 'monospace', fontWeight: 700 }}
                          />
                          <Chip
                            size="small"
                            label={`${group.accounts.length} ${group.accounts.length === 1 ? 'account' : 'accounts'}`}
                            sx={{ fontSize: '0.75rem' }}
                          />
                        </Stack>

                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{
                            alignItems: 'center',
                            bgcolor: (theme) =>
                              theme.palette.mode === 'dark'
                                ? 'rgba(255,255,255,0.06)'
                                : 'background.paper',
                            px: 1.5,
                            py: 0.75,
                            borderRadius: 1.5,
                            border: '1px solid',
                            borderColor: 'divider',
                          }}
                        >
                          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                            Total {group.bankKey}:
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: 700,
                              color: 'text.primary',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {money(groupNewTotal)}
                          </Typography>
                          {groupDiff !== 0 && (
                            <Chip
                              size="small"
                              color={groupDiff > 0 ? 'success' : 'error'}
                              variant="filled"
                              label={`${groupDiff > 0 ? '+' : '−'}${money(Math.abs(groupDiff))}`}
                              sx={{ fontWeight: 700, height: 20, fontSize: '0.7rem' }}
                            />
                          )}
                        </Stack>
                      </Stack>

                      {/* List of accounts belonging to this bank inside the Paper Stack */}
                      <Stack spacing={2}>
                        {group.accounts.map((account, idx) => {
                          const currentBalance = account.balance ?? 0;
                          const newBalance = shopBalances[account.id] ?? currentBalance;
                          const diff = newBalance - currentBalance;

                          return (
                            <Box
                              key={account.id}
                              sx={{
                                pt: idx === 0 ? 0.5 : 2,
                                borderTop: idx === 0 ? 'none' : '1px dashed',
                                borderColor: 'divider',
                                opacity: account.isActive ? 1 : 0.65,
                              }}
                            >
                              <Stack spacing={1.25}>
                                <Stack
                                  direction={{ xs: 'column', sm: 'row' }}
                                  sx={{
                                    justifyContent: 'space-between',
                                    alignItems: { xs: 'flex-start', sm: 'center' },
                                    gap: 1,
                                  }}
                                >
                                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                                    <Typography
                                      variant="body2"
                                      sx={{
                                        fontFamily: 'monospace',
                                        fontWeight: 700,
                                        color: 'primary.main',
                                        fontSize: '0.95rem',
                                      }}
                                    >
                                      {account.accountNumber}
                                    </Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.secondary' }}>
                                      ({account.accountName})
                                    </Typography>
                                    {account.isActive === 0 && (
                                      <Chip size="small" label="Off" color="default" sx={{ height: 20, fontSize: '0.7rem' }} />
                                    )}
                                  </Stack>

                                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
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
                                        label={`New balance · ${account.accountNumber}`}
                                        required
                                        value={newBalance}
                                        onChange={(val) =>
                                          setShopBalances((prev) => ({
                                            ...prev,
                                            [account.id]: val,
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
                                    This account is switched off. Turn it on in Register Accounts to adjust its balance.
                                  </Typography>
                                )}
                              </Stack>
                            </Box>
                          );
                        })}
                      </Stack>
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          )}

          {/* Other bank accounts without registered shop accounts */}
          {bankAccountsWithoutShopAccount.length > 0 && (
            <Stack spacing={2}>
              {groupedShopAccounts.length > 0 && (
                <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary', letterSpacing: 0.5, mt: 1 }}>
                  Other Bank Accounts
                </Typography>
              )}
              {bankAccountsWithoutShopAccount.map((account) => {
                const currentBalance = account.balance;
                const newBalance = bankBalances[account.accountId] ?? currentBalance;
                const diff = newBalance - currentBalance;

                return (
                  <Paper
                    key={account.accountId}
                    variant="outlined"
                    sx={{
                      p: 2.5,
                      borderRadius: 2,
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
                          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
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
                                setBankBalances((prev) => ({
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
          )}

          {groupedShopAccounts.length === 0 && bankAccountsWithoutShopAccount.length === 0 && (
            <Alert severity="info">
              No bank or shop accounts registered yet. Use <strong>Register Accounts</strong> to add your shop banking accounts.
            </Alert>
          )}

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
