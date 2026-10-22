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
  FormControl,
  FormControlLabel,
  FormLabel,
  InputAdornment,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import CallReceivedIcon from '@mui/icons-material/CallReceived';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import LocalAtmIcon from '@mui/icons-material/LocalAtm';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import MoneyField from './MoneyField';
import { useMoneyFormatter } from '../hooks/useSettings';
import { PosApiError } from '@shared/errors';
import { nowLocalDateTime } from '@shared/datetime';
import type { ShopAdvance, ShopBankAccount } from '@shared/api';
import type { BankFeeDirection, ShopAdvanceSourceType } from '@shared/domain';
import { formatRate, parseRate, rateOf } from '@shared/money';

const MAX_FEE_BASIS_POINTS = 10_000;

function formatPercent(basisPoints: number | null): string {
  if (basisPoints === null || basisPoints === 0) return '0';
  const whole = Math.floor(basisPoints / 100);
  const frac = basisPoints % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, '0').replace(/0+$/, '')}`;
}

export default function ShopAdvanceReceiveDialog({
  advance,
  shopAccounts,
  onClose,
  onSaved,
}: {
  advance: ShopAdvance;
  shopAccounts: ShopBankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const money = useMoneyFormatter();

  const [toType, setToType] = useState<ShopAdvanceSourceType>('SHOP_ACCOUNT');
  const [toShopAccountId, setToShopAccountId] = useState(shopAccounts[0]?.id ?? '');
  const [amount, setAmount] = useState(advance.remaining);
  const [percentText, setPercentText] = useState('0');
  const [feeDirection, setFeeDirection] = useState<BankFeeDirection>('RECEIVE');
  const [receivedAt, setReceivedAt] = useState(nowLocalDateTime());
  const [notes, setNotes] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const exceedsRemaining = amount > advance.remaining;

  const feeBasisPoints = (() => {
    if (percentText.trim() === '') return 0;
    const bp = parseRate(percentText);
    return bp === null || bp > MAX_FEE_BASIS_POINTS ? null : bp;
  })();

  const percentError =
    feeBasisPoints === null
      ? 'Enter a number from 0 to 100'
      : (fieldErrors.feeBasisPoints ?? null);

  const feeAmount = feeBasisPoints === null ? 0 : rateOf(amount, feeBasisPoints);

  const actualRepaymentAmount =
    feeDirection === 'RECEIVE'
      ? amount + feeAmount
      : amount - feeAmount;

  const save = useMutation({
    mutationFn: () =>
      api.banking.receiveShopAdvance({
        shopAdvanceId: advance.id,
        toType,
        toShopAccountId: toType === 'SHOP_ACCOUNT' ? toShopAccountId : undefined,
        amount,
        feeBasisPoints: feeBasisPoints ?? 0,
        feeDirection,
        receivedAt,
        notes: notes.trim() || undefined,
      }),
    onSuccess: onSaved,
    onError: (err) => {
      if (err instanceof PosApiError) {
        setError(err.message);
        setFieldErrors(err.fields ?? {});
      } else {
        setError('Unable to record repayment.');
      }
    },
  });

  const canSave =
    amount > 0 &&
    !exceedsRemaining &&
    feeBasisPoints !== null &&
    actualRepaymentAmount > 0 &&
    (toType !== 'SHOP_ACCOUNT' || Boolean(toShopAccountId)) &&
    receivedAt;

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={save.isPending ? undefined : onClose}>
      <DialogTitle>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <CallReceivedIcon color="success" />
          <span>Receive Advance Repayment</span>
        </Stack>
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {/* Advance Info Banner */}
          <Box
            sx={{
              p: 2,
              borderRadius: 1.5,
              bgcolor: 'action.hover',
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                {advance.advanceNumber}
              </Typography>
              <Chip
                size="small"
                label={advance.status}
                color={advance.status === 'OPEN' ? 'warning' : 'success'}
              />
            </Stack>

            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {advance.recipientName}
              {advance.recipientPhone && (
                <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                  ({advance.recipientPhone})
                </Typography>
              )}
            </Typography>

            <Stack direction="row" spacing={3} sx={{ mt: 1.5 }}>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Total Advanced
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {money(advance.amount)}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Received So Far
                </Typography>
                <Typography variant="body2" color="success.main" sx={{ fontWeight: 600 }}>
                  {money(advance.received)}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Remaining
                </Typography>
                <Typography variant="body2" color="warning.main" sx={{ fontWeight: 700 }}>
                  {money(advance.remaining)}
                </Typography>
              </Box>
            </Stack>
          </Box>

          {/* Date & Time */}
          <TextField
            label="Received Date & Time"
            type="datetime-local"
            value={receivedAt}
            onChange={(e) => setReceivedAt(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            error={Boolean(fieldErrors.receivedAt)}
            helperText={fieldErrors.receivedAt}
            fullWidth
          />

          {/* Receive Into (TO) */}
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary', mb: 1 }}>
              Receive Into (Shop Destination)
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

            {toType === 'CASH' ? (
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
                  Cash will be added to the cash drawer.
                </Typography>
              </Box>
            ) : (
              <TextField
                select
                fullWidth
                label="Select Shop Bank Account"
                value={toShopAccountId}
                onChange={(e) => setToShopAccountId(e.target.value)}
                error={Boolean(fieldErrors.toShopAccountId)}
                helperText={fieldErrors.toShopAccountId}
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

          {/* Amount Field */}
          <Box>
            <MoneyField
              label="Repayment Amount"
              required
              fullWidth
              value={amount}
              onChange={setAmount}
              error={Boolean(fieldErrors.amount) || exceedsRemaining}
              helperText={
                exceedsRemaining
                  ? `Cannot exceed remaining balance of ${money(advance.remaining)}`
                  : fieldErrors.amount
              }
            />
            {amount !== advance.remaining && (
              <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: 0.5 }}>
                <Button size="small" onClick={() => setAmount(advance.remaining)}>
                  Full Amount ({money(advance.remaining)})
                </Button>
              </Stack>
            )}
          </Box>

          {/* Percent and Fees below Repayment Amount */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
            <TextField
              label="Percent"
              value={percentText}
              onChange={(e) => setPercentText(e.target.value)}
              onBlur={() => setPercentText(formatPercent(feeBasisPoints))}
              inputMode="decimal"
              error={Boolean(percentError)}
              helperText={percentError ?? '0 to 100'}
              slotProps={{
                input: {
                  endAdornment: <InputAdornment position="end">%</InputAdornment>,
                },
              }}
              sx={{ width: { xs: '100%', sm: 140 } }}
            />
            <TextField
              label="Fees"
              value={money(feeAmount)}
              slotProps={{
                input: {
                  readOnly: true,
                },
              }}
              helperText={feeBasisPoints ? `${formatRate(feeBasisPoints)} of repayment` : ' '}
              sx={{
                width: { xs: '100%', sm: 160 },
                '& .MuiInputBase-input': {
                  fontVariantNumeric: 'tabular-nums',
                },
              }}
            />
            <FormControl sx={{ pt: { sm: 0.5 } }}>
              <RadioGroup
                row
                value={feeDirection}
                onChange={(e) => setFeeDirection(e.target.value as BankFeeDirection)}
              >
                <FormControlLabel
                  value="RECEIVE"
                  control={<Radio size="small" />}
                  label={<Typography variant="body2">Receive</Typography>}
                />
                <FormControlLabel
                  value="PAY"
                  control={<Radio size="small" />}
                  label={<Typography variant="body2">Pay</Typography>}
                />
              </RadioGroup>
              <FormLabel sx={{ fontSize: 12 }}>The fee is</FormLabel>
            </FormControl>
          </Stack>

          {/* Actual Repayment Amount */}
          <TextField
            label="Actual Repayment Amount"
            fullWidth
            value={money(actualRepaymentAmount)}
            slotProps={{
              input: {
                readOnly: true,
              },
            }}
            helperText={
              feeAmount > 0
                ? `${money(amount)} ${
                    feeDirection === 'RECEIVE' ? 'plus' : 'less'
                  } ${money(feeAmount)} fee ${feeDirection === 'RECEIVE' ? 'received' : 'paid'}`
                : 'Credited to shop balance'
            }
            sx={{
              '& .MuiInputBase-input': {
                fontVariantNumeric: 'tabular-nums',
                fontWeight: 700,
                color: actualRepaymentAmount > 0 ? 'success.main' : 'error.main',
              },
            }}
          />

          {/* Notes */}
          <TextField
            label="Notes"
            multiline
            rows={2}
            fullWidth
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. First partial repayment by cash"
          />
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="success"
          onClick={() => save.mutate()}
          disabled={!canSave || save.isPending}
        >
          {save.isPending ? 'Recording…' : 'Record Repayment'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
