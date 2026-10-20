import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import MoneyField from './MoneyField';
import { useSettings } from '../hooks/useSettings';
import { PosApiError } from '@shared/errors';
import { formatMoney } from '@shared/money';
import { nowLocalDateTime } from '@shared/datetime';
import type { ShopBankAccount } from '@shared/api';

/**
 * Records an internal account transfer between two registered shop bank accounts.
 *
 * - Only registered ShopBankAccounts appear in FROM and TO dropdowns.
 * - No percentage or fees — this is a pure balance move within the shop's accounts.
 * - Cash in hand is NOT touched.
 */
export default function InternalTransferDialog({
  shopAccounts,
  onClose,
  onSaved,
}: {
  shopAccounts: ShopBankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: settings } = useSettings();
  const currency = settings?.currency ?? 'MMK';

  const [fromShopAccountId, setFromShopAccountId] = useState('');
  const [toShopAccountId, setToShopAccountId] = useState('');
  const [amount, setAmount] = useState(0);
  const [transferAt, setTransferAt] = useState(nowLocalDateTime());
  const [notes, setNotes] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const fromAccount = shopAccounts.find((a) => a.id === fromShopAccountId) ?? null;
  const toAccount = shopAccounts.find((a) => a.id === toShopAccountId) ?? null;

  const isFromEmptyOrNegative = Boolean(fromAccount && fromAccount.balance <= 0);
  const exceedsBalance = Boolean(fromAccount && amount > fromAccount.balance);

  const save = useMutation({
    mutationFn: () =>
      api.banking.createInternalTransfer({
        fromShopAccountId,
        toShopAccountId,
        amount,
        transferAt,
        notes: notes.trim() || undefined,
      }),
    onSuccess: onSaved,
    onError: (err) => {
      if (err instanceof PosApiError) {
        setError(err.message);
        setFieldErrors(err.fields ?? {});
      } else {
        setError('Unable to record this transfer.');
      }
    },
  });

  const canSave =
    fromShopAccountId &&
    toShopAccountId &&
    fromShopAccountId !== toShopAccountId &&
    amount > 0 &&
    !exceedsBalance &&
    !isFromEmptyOrNegative &&
    transferAt;

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={save.isPending ? undefined : onClose}>
      <DialogTitle>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <SwapHorizIcon />
          <span>New Internal Account Transfer</span>
        </Stack>
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Typography variant="caption" color="text.secondary">
            Transfers money directly between two of your registered shop accounts. Cash in hand is
            not affected.
          </Typography>

          <TextField
            label="Date and time"
            type="datetime-local"
            required
            value={transferAt}
            onChange={(e) => setTransferAt(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            error={Boolean(fieldErrors.transferAt)}
            helperText={fieldErrors.transferAt}
            sx={{ alignSelf: 'flex-start', minWidth: 260 }}
          />

          {/* FROM */}
          <Stack spacing={1}>
            <Typography variant="overline" color="text.secondary">
              From
            </Typography>
            <TextField
              select
              label="Account"
              required
              value={fromShopAccountId}
              onChange={(e) => {
                setFromShopAccountId(e.target.value);
                setFieldErrors({});
              }}
              error={Boolean(fieldErrors.fromShopAccountId)}
              helperText={fieldErrors.fromShopAccountId ?? 'Money leaves this account'}
            >
              <MenuItem value="">
                <em>Select account</em>
              </MenuItem>
              {shopAccounts.map((acc) => (
                <MenuItem key={acc.id} value={acc.id} disabled={acc.id === toShopAccountId}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', width: '100%' }}>
                    <Stack sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap>
                        <strong>{acc.bankName}</strong> ({acc.bankKey}) · {acc.accountNumber}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {acc.accountName}
                      </Typography>
                    </Stack>
                    <Chip
                      label={formatMoney(acc.balance, currency)}
                      size="small"
                      variant="outlined"
                      color={acc.balance >= 0 ? 'default' : 'error'}
                    />
                  </Stack>
                </MenuItem>
              ))}
            </TextField>
            {fromAccount && (
              <Typography
                variant="caption"
                color={fromAccount.balance <= 0 ? 'error.main' : 'text.secondary'}
              >
                Current balance: <strong>{formatMoney(fromAccount.balance, currency)}</strong>
                {fromAccount.balance <= 0 && ' (No funds available for transfer)'}
              </Typography>
            )}
          </Stack>

          {/* TO */}
          <Stack spacing={1}>
            <Typography variant="overline" color="text.secondary">
              To
            </Typography>
            <TextField
              select
              label="Account"
              required
              value={toShopAccountId}
              onChange={(e) => {
                setToShopAccountId(e.target.value);
                setFieldErrors({});
              }}
              error={Boolean(fieldErrors.toShopAccountId)}
              helperText={fieldErrors.toShopAccountId ?? 'Money arrives in this account'}
            >
              <MenuItem value="">
                <em>Select account</em>
              </MenuItem>
              {shopAccounts.map((acc) => (
                <MenuItem key={acc.id} value={acc.id} disabled={acc.id === fromShopAccountId}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', width: '100%' }}>
                    <Stack sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap>
                        <strong>{acc.bankName}</strong> ({acc.bankKey}) · {acc.accountNumber}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {acc.accountName}
                      </Typography>
                    </Stack>
                    <Chip
                      label={formatMoney(acc.balance, currency)}
                      size="small"
                      variant="outlined"
                      color={acc.balance >= 0 ? 'default' : 'error'}
                    />
                  </Stack>
                </MenuItem>
              ))}
            </TextField>
            {toAccount && (
              <Typography variant="caption" color="text.secondary">
                Current balance: <strong>{formatMoney(toAccount.balance, currency)}</strong>
              </Typography>
            )}
          </Stack>

          {/* AMOUNT */}
          <MoneyField
            label="Amount"
            required
            value={amount}
            onChange={(val) => {
              setAmount(val);
              if (fieldErrors.amount) {
                setFieldErrors((prev) => {
                  const copy = { ...prev };
                  delete copy.amount;
                  return copy;
                });
              }
            }}
            error={Boolean(fieldErrors.amount) || exceedsBalance}
            helperText={
              fieldErrors.amount ??
              (exceedsBalance && fromAccount
                ? `Cannot transfer more than the current balance (${formatMoney(fromAccount.balance, currency)})`
                : ' ')
            }
            sx={{ alignSelf: 'flex-start', minWidth: 200 }}
          />

          <TextField
            label="Notes"
            placeholder="Reason for transfer (optional)"
            multiline
            minRows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            error={Boolean(fieldErrors.notes)}
            helperText={fieldErrors.notes ?? ' '}
          />
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => save.mutate()}
          disabled={!canSave || save.isPending}
          startIcon={<SwapHorizIcon />}
        >
          {save.isPending ? 'Recording…' : 'Record Transfer'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
