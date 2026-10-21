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
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import LocalAtmIcon from '@mui/icons-material/LocalAtm';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import MoneyField from './MoneyField';
import { useMoneyFormatter } from '../hooks/useSettings';
import { PosApiError } from '@shared/errors';
import { nowLocalDateTime } from '@shared/datetime';
import type { ShopBankAccount } from '@shared/api';
import type { ShopAdvanceSourceType, ShopAdvanceDestinationType } from '@shared/domain';

export default function ShopAdvanceDialog({
  shopAccounts,
  cashInHandAmount,
  onClose,
  onSaved,
}: {
  shopAccounts: ShopBankAccount[];
  cashInHandAmount: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const money = useMoneyFormatter();

  const [fromType, setFromType] = useState<ShopAdvanceSourceType>('SHOP_ACCOUNT');
  const [fromShopAccountId, setFromShopAccountId] = useState(shopAccounts[0]?.id ?? '');

  const [toType, setToType] = useState<ShopAdvanceDestinationType>('ACCOUNT');
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [toBankName, setToBankName] = useState('');
  const [toAccountNumber, setToAccountNumber] = useState('');
  const [toAccountName, setToAccountName] = useState('');

  const [amount, setAmount] = useState(0);
  const [advanceAt, setAdvanceAt] = useState(nowLocalDateTime());
  const [notes, setNotes] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const fromAccount = shopAccounts.find((a) => a.id === fromShopAccountId) ?? null;

  // Validation checks for FROM balance
  const sourceBalance = fromType === 'CASH' ? cashInHandAmount : (fromAccount?.balance ?? 0);
  const exceedsBalance = amount > sourceBalance;
  const isSourceEmpty = sourceBalance <= 0;

  const save = useMutation({
    mutationFn: () =>
      api.banking.createShopAdvance({
        fromType,
        fromShopAccountId: fromType === 'SHOP_ACCOUNT' ? fromShopAccountId : undefined,
        toType,
        recipientName: recipientName.trim(),
        recipientPhone: recipientPhone.trim() || undefined,
        toBankName: toType === 'ACCOUNT' ? toBankName.trim() || undefined : undefined,
        toAccountNumber: toType === 'ACCOUNT' ? toAccountNumber.trim() : undefined,
        toAccountName: toType === 'ACCOUNT' ? toAccountName.trim() || undefined : undefined,
        amount,
        advanceAt,
        notes: notes.trim() || undefined,
      }),
    onSuccess: onSaved,
    onError: (err) => {
      if (err instanceof PosApiError) {
        setError(err.message);
        setFieldErrors(err.fields ?? {});
      } else {
        setError('Unable to record this shop advance.');
      }
    },
  });

  const canSave =
    recipientName.trim().length > 0 &&
    amount > 0 &&
    !exceedsBalance &&
    !isSourceEmpty &&
    (fromType !== 'SHOP_ACCOUNT' || Boolean(fromShopAccountId)) &&
    (toType !== 'ACCOUNT' || Boolean(toAccountNumber.trim())) &&
    advanceAt;

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={save.isPending ? undefined : onClose}>
      <DialogTitle>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <PaymentsOutlinedIcon color="primary" />
          <span>New Shop Advance</span>
        </Stack>
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {/* Date & Time */}
          <TextField
            label="Advance Date & Time"
            type="datetime-local"
            value={advanceAt}
            onChange={(e) => setAdvanceAt(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            error={Boolean(fieldErrors.advanceAt)}
            helperText={fieldErrors.advanceAt}
            fullWidth
          />

          {/* Recipient Details */}
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary', mb: -1 }}>
            Recipient Details
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Recipient Name"
              required
              fullWidth
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              error={Boolean(fieldErrors.recipientName)}
              helperText={fieldErrors.recipientName}
              placeholder="e.g. U Thura"
            />
            <TextField
              label="Recipient Phone"
              fullWidth
              value={recipientPhone}
              onChange={(e) => setRecipientPhone(e.target.value)}
              placeholder="e.g. 09123456789"
            />
          </Stack>

          {/* FROM Source Selection */}
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary', mb: 1 }}>
              From (Shop Source)
            </Typography>
            <ToggleButtonGroup
              exclusive
              fullWidth
              value={fromType}
              onChange={(_e, next: ShopAdvanceSourceType | null) => {
                if (next) {
                  setFromType(next);
                  if (next === 'CASH') {
                    setToType('CASH');
                  } else if (next === 'SHOP_ACCOUNT') {
                    setToType('ACCOUNT');
                  }
                }
              }}
              sx={{ mb: 1.5 }}
            >
              <ToggleButton value="SHOP_ACCOUNT">
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <AccountBalanceIcon fontSize="small" />
                  <span>Shop Account</span>
                </Stack>
              </ToggleButton>
              <ToggleButton value="CASH">
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <LocalAtmIcon fontSize="small" />
                  <span>Cash in Hand</span>
                </Stack>
              </ToggleButton>
            </ToggleButtonGroup>

            {fromType === 'CASH' ? (
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  alignItems: 'center',
                  p: 1.5,
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <LocalAtmIcon color="action" />
                <Typography variant="body2" sx={{ flexGrow: 1 }}>
                  Deduct from cash drawer:
                </Typography>
                <Chip
                  label={`Available: ${money(cashInHandAmount)}`}
                  color={cashInHandAmount > 0 ? 'success' : 'error'}
                  variant="outlined"
                  size="small"
                  sx={{ fontWeight: 600 }}
                />
              </Stack>
            ) : (
              <TextField
                select
                fullWidth
                label="Select Shop Bank Account"
                value={fromShopAccountId}
                onChange={(e) => setFromShopAccountId(e.target.value)}
                error={Boolean(fieldErrors.fromShopAccountId)}
                helperText={fieldErrors.fromShopAccountId}
              >
                {shopAccounts.map((account) => (
                  <MenuItem key={account.id} value={account.id}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', width: '100%', justifyContent: 'space-between' }}
                    >
                      <span>
                        <strong>{account.bankName}</strong> ({account.accountNumber}) · {account.accountName}
                      </span>
                      <Chip
                        size="small"
                        label={money(account.balance)}
                        color={account.balance > 0 ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </Stack>
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Box>

          {/* TO Destination Selection */}
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary', mb: 1 }}>
              To (Recipient Receives Via)
            </Typography>
            <ToggleButtonGroup
              exclusive
              fullWidth
              value={toType}
              onChange={(_e, next) => {
                if (next) setToType(next);
              }}
              sx={{ mb: 1.5 }}
            >
              <ToggleButton value="ACCOUNT">
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <AccountBalanceIcon fontSize="small" />
                  <span>Bank / Wallet Account</span>
                </Stack>
              </ToggleButton>
              <ToggleButton value="CASH">
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <LocalAtmIcon fontSize="small" />
                  <span>Cash</span>
                </Stack>
              </ToggleButton>
            </ToggleButtonGroup>

            {toType === 'ACCOUNT' ? (
              <Stack spacing={1.5}>
                <TextField
                  label="Provider / Bank Name"
                  fullWidth
                  value={toBankName}
                  onChange={(e) => setToBankName(e.target.value)}
                  placeholder="e.g. KBZ Bank, Kpay, CB, AYA"
                />
                <TextField
                  label="Recipient Account / Wallet Number"
                  required
                  fullWidth
                  value={toAccountNumber}
                  onChange={(e) => setToAccountNumber(e.target.value)}
                  error={Boolean(fieldErrors.toAccountNumber)}
                  helperText={fieldErrors.toAccountNumber}
                  placeholder="e.g. 09123456789 or account number"
                />
                <TextField
                  label="Recipient Account Name"
                  fullWidth
                  value={toAccountName}
                  onChange={(e) => setToAccountName(e.target.value)}
                  placeholder="e.g. U Thura"
                />
              </Stack>
            ) : (
              <Box
                sx={{
                  p: 1.5,
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  Cash will be handed directly to recipient.
                </Typography>
              </Box>
            )}
          </Box>

          {/* Amount Field */}
          <Box>
            <MoneyField
              label="Advance Amount"
              required
              fullWidth
              value={amount}
              onChange={setAmount}
              error={Boolean(fieldErrors.amount) || exceedsBalance}
              helperText={
                exceedsBalance
                  ? `Cannot advance more than available balance (${money(sourceBalance)})`
                  : isSourceEmpty
                    ? 'Source has zero or negative balance'
                    : fieldErrors.amount
              }
            />
            {sourceBalance > 0 && (
              <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: 0.5 }}>
                <Button size="small" onClick={() => setAmount(sourceBalance)}>
                  Max ({money(sourceBalance)})
                </Button>
              </Stack>
            )}
          </Box>

          {/* Notes */}
          <TextField
            label="Notes / Reason"
            multiline
            rows={2}
            fullWidth
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Temporary cash advance for emergency purchase"
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
        >
          {save.isPending ? 'Recording…' : 'Record Advance'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
