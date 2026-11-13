import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  DialogActions,
  DialogContent,
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
import { MovementDialog } from './MovementParts';
import AccountFields from './AccountFields';
import ShopAccountSelect from './ShopAccountSelect';
import { useMoneyFormatter } from '../hooks/useSettings';
import { PosApiError } from '@shared/errors';
import { nowLocalDateTime } from '@shared/datetime';
import type { ShopAdvance, ShopBankAccount } from '@shared/api';
import type { ShopAdvanceFromType, ShopAdvanceDestinationType } from '@shared/domain';
import HistoryIcon from '@mui/icons-material/History';

export default function ShopAdvanceDialog({
  shopAccounts,
  cashInHandAmount,
  parent,
  onClose,
  onSaved,
}: {
  shopAccounts: ShopBankAccount[];
  cashInHandAmount: number;
  /** Pay more on this advance instead of starting a new one. */
  parent?: ShopAdvance;
  onClose: () => void;
  onSaved: () => void;
}) {
  const money = useMoneyFormatter();

  const [fromType, setFromType] = useState<ShopAdvanceFromType>('SHOP_ACCOUNT');
  const [fromShopAccountId, setFromShopAccountId] = useState(shopAccounts[0]?.id ?? '');

  const [toType, setToType] = useState<ShopAdvanceDestinationType>(parent?.toType ?? 'ACCOUNT');
  const [recipientName, setRecipientName] = useState(parent?.recipientName ?? '');
  const [recipientPhone, setRecipientPhone] = useState(parent?.recipientPhone ?? '');
  const [toBankId, setToBankId] = useState('');
  const [toBankName, setToBankName] = useState('');
  const [toAccountNumber, setToAccountNumber] = useState(parent?.toAccountNumber ?? '');
  const [toAccountName, setToAccountName] = useState(parent?.toAccountName ?? '');

  const [amount, setAmount] = useState(0);
  const [bankCharges, setBankCharges] = useState(0);
  const [advanceAt, setAdvanceAt] = useState(nowLocalDateTime());
  const [notes, setNotes] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const fromAccount = shopAccounts.find((a) => a.id === fromShopAccountId) ?? null;

  // Validation checks for FROM balance
  // An old record takes nothing from the shop, so there is no balance to check.
  const sourceBalance =
    fromType === 'OLD' ? Infinity : fromType === 'CASH' ? cashInHandAmount : (fromAccount?.balance ?? 0);
  // Only a shop account → bank/wallet transfer carries bank charges, paid on top of the amount.
  const hasCharges = fromType === 'SHOP_ACCOUNT' && toType === 'ACCOUNT';
  const charges = hasCharges ? bankCharges : 0;
  const exceedsBalance = amount + charges > sourceBalance;
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
        bankCharges: charges || undefined,
        parentId: parent?.id,
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
    (toType !== 'ACCOUNT' || (Boolean(toAccountNumber.trim()) && Boolean(toAccountName.trim()))) &&
    advanceAt;

  return (
    <MovementDialog
      title={parent ? `Pay More · ${parent.advanceNumber}` : 'New Shop Advance'}
      subtitle={parent ? 'Add to an existing advance' : 'Money the shop lends out'}
      icon={<PaymentsOutlinedIcon />}
      onClose={save.isPending ? undefined : onClose}
    >

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
          {parent ? (
            <Alert severity="info">
              Paying more to <strong>{parent.recipientName}</strong>. Already given {money(parent.amount)},
              still owed {money(parent.remaining)}.
            </Alert>
          ) : (
          <>
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
          </>
          )}

          {/* FROM Source Selection */}
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary', mb: 1 }}>
              From (Shop Source)
            </Typography>
            <ToggleButtonGroup
              exclusive
              fullWidth
              value={fromType}
              onChange={(_e, next: ShopAdvanceFromType | null) => {
                if (next) {
                  setFromType(next);
                  if (next === 'CASH' || next === 'OLD') {
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
              <ToggleButton value="OLD">
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <HistoryIcon fontSize="small" />
                  <span>Old record</span>
                </Stack>
              </ToggleButton>
            </ToggleButtonGroup>

            {fromType === 'OLD' ? (
              <Alert severity="info">
                An advance given before this system. Nothing is taken from cash in hand or any account;
                receiving it back later works as usual.
              </Alert>
            ) : fromType === 'CASH' ? (
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
              <ShopAccountSelect
                label="Select Shop Bank Account"
                value={fromShopAccountId}
                onChange={setFromShopAccountId}
                error={Boolean(fieldErrors.fromShopAccountId)}
                helperText={fieldErrors.fromShopAccountId}
                sx={{ width: '100%' }}
              />
            )}
          </Box>

          {/* TO Destination Selection (unknown for old records) */}
          {fromType !== 'OLD' && (
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
              <AccountFields
                bankId={toBankId}
                // The advance stores the bank by name, as it always has.
                onBankChange={(id, bank) => {
                  setToBankId(id);
                  setToBankName(bank?.name ?? '');
                }}
                number={toAccountNumber}
                onNumberChange={setToAccountNumber}
                name={toAccountName}
                onNameChange={setToAccountName}
                numberError={fieldErrors.toAccountNumber}
                nameError={fieldErrors.toAccountName}
              />
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
          )}

          {/* Amount Field */}
          <Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <MoneyField
                label="Advance Amount"
                required
                fullWidth
                value={amount}
                onChange={setAmount}
                error={Boolean(fieldErrors.amount) || exceedsBalance}
                helperText={
                  exceedsBalance
                    ? `Cannot advance more than available balance (${money(sourceBalance)})${charges ? ' including bank charges' : ''}`
                    : isSourceEmpty
                      ? 'Source has zero or negative balance'
                      : fieldErrors.amount
                }
              />
              {hasCharges && (
                <MoneyField
                  label="Bank Charges"
                  fullWidth
                  value={bankCharges}
                  onChange={setBankCharges}
                  error={Boolean(fieldErrors.bankCharges)}
                  helperText={fieldErrors.bankCharges ?? 'Paid by the shop, not owed by the recipient'}
                />
              )}
            </Stack>
            {fromType !== 'OLD' && sourceBalance > charges && (
              <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: 0.5 }}>
                <Button size="small" onClick={() => setAmount(sourceBalance - charges)}>
                  Max ({money(sourceBalance - charges)})
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
    </MovementDialog>
  );
}
