import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import LocalAtmIcon from '@mui/icons-material/LocalAtm';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import MoneyField from './MoneyField';
import ShopAccountSelect from './ShopAccountSelect';
import CashInHandBox from './CashInHandBox';
import { useMoneyFormatter } from '../hooks/useSettings';
import { PosApiError } from '@shared/errors';
import { nowLocalDateTime } from '@shared/datetime';
import { addMoney, bankFee, formatRate, subtractMoney } from '@shared/money';
import type { ShopAdvance, ShopBankAccount } from '@shared/api';
import type { ShopAdvanceSourceType } from '@shared/domain';
import { percentToBasisPoints, Section, SummaryLine, TypeButton } from './MovementParts';

/**
 * Money lent out by the shop coming back.
 *
 * The advance goes down by the repayment.
 *   Cash      the shop PAYS the fee: cash in hand goes up by repayment − fee.
 *   Transfer  the shop RECEIVES the fee, on top of the repayment — or, when the
 *             payer already added it, the part of what arrived above it. The
 *             account it came from is recorded.
 */
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
  const [feeIncluded, setFeeIncluded] = useState(false);
  const [fromBankId, setFromBankId] = useState('');
  const [fromNumber, setFromNumber] = useState('');
  const [fromName, setFromName] = useState(advance.recipientName ?? '');
  const [receivedAt, setReceivedAt] = useState(nowLocalDateTime());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const providers = useQuery({
    queryKey: ['bankAccounts', 'active'],
    queryFn: () => api.banking.listAccounts({ includeInactive: false }),
  });

  const isCash = toType === 'CASH';
  const included = !isCash && feeIncluded;
  const shopAccount = shopAccounts.find((a) => a.id === toShopAccountId) ?? null;
  const feeBasisPoints = percentToBasisPoints(percentText);
  // Worked out with the same function the main process uses.
  const fee = feeBasisPoints === null ? 0 : bankFee(amount, feeBasisPoints, included);
  const principal = included ? subtractMoney(amount, fee) : amount;
  const total = isCash ? subtractMoney(amount, fee) : included ? amount : addMoney(amount, fee);
  const overRemaining = principal > advance.remaining;
  const left = advance.remaining - principal;

  const save = useMutation({
    mutationFn: () =>
      api.banking.receiveShopAdvance({
        shopAdvanceId: advance.id,
        toType,
        toShopAccountId: isCash ? undefined : toShopAccountId,
        amount,
        feeBasisPoints: feeBasisPoints ?? 0,
        feeIncluded: included,
        fromAccountId: isCash ? undefined : fromBankId || undefined,
        fromAccountNumber: isCash ? undefined : fromNumber.trim(),
        fromAccountName: isCash ? undefined : fromName.trim(),
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
    !save.isPending &&
    principal > 0 &&
    !overRemaining &&
    feeBasisPoints !== null &&
    (isCash || (shopAccount !== null && fromNumber.trim() !== '' && fromName.trim() !== '')) &&
    Boolean(receivedAt);

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={save.isPending ? undefined : onClose}>
      <DialogTitle>Receive advance repayment</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {error && <Alert severity="error">{error}</Alert>}

          <Alert
            severity="info"
            action={
              <Button
                color="inherit"
                size="small"
                sx={{ whiteSpace: 'nowrap' }}
                onClick={() =>
                  setAmount(
                    included
                      ? addMoney(advance.remaining, bankFee(advance.remaining, feeBasisPoints ?? 0))
                      : advance.remaining,
                  )
                }
              >
                Full amount
              </Button>
            }
          >
            <strong>{advance.advanceNumber}</strong> · {advance.recipientName}
            {advance.recipientPhone ? ` (${advance.recipientPhone})` : ''} was advanced{' '}
            {money(advance.amount)} and has repaid {money(advance.received)}.{' '}
            <strong>{money(advance.remaining)}</strong> still owed.
          </Alert>

          <ToggleButtonGroup
            exclusive
            fullWidth
            color="primary"
            value={toType}
            onChange={(_e, next: ShopAdvanceSourceType | null) => {
              if (!next) return;
              setToType(next);
              setFieldErrors({});
            }}
          >
            <TypeButton
              value="CASH"
              icon={<LocalAtmIcon fontSize="small" />}
              title="Cash"
              caption="Paid in cash into the drawer"
            />
            <TypeButton
              value="SHOP_ACCOUNT"
              icon={<AccountBalanceIcon fontSize="small" />}
              title="Transfer"
              caption="Sent to one of our accounts"
            />
          </ToggleButtonGroup>

          {isCash && <CashInHandBox />}

          {!isCash && (
            <Section title="Received in our account">
              {shopAccounts.length === 0 ? (
                <Alert severity="warning">
                  No shop account is registered yet. Add your account numbers with
                  &quot;Register Accounts&quot; on the Banking screen first.
                </Alert>
              ) : (
                <ShopAccountSelect
                  label="Our account"
                  value={toShopAccountId}
                  onChange={setToShopAccountId}
                  error={Boolean(fieldErrors.toShopAccountId)}
                  helperText={fieldErrors.toShopAccountId}
                  sx={{ width: '100%' }}
                />
              )}
            </Section>
          )}

          {!isCash && (
            <Section title="Received from">
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  select
                  label="Bank / wallet"
                  value={fromBankId}
                  onChange={(e) => setFromBankId(e.target.value)}
                  sx={{ flex: 1, minWidth: 0 }}
                >
                  <MenuItem value="">
                    <em>Not listed</em>
                  </MenuItem>
                  {(providers.data ?? []).map((bank) => (
                    <MenuItem key={bank.id} value={bank.id}>
                      {bank.name}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  required
                  label="Account number"
                  value={fromNumber}
                  onChange={(e) => setFromNumber(e.target.value)}
                  error={Boolean(fieldErrors.fromAccountNumber)}
                  helperText={fieldErrors.fromAccountNumber}
                  sx={{ flex: 1, minWidth: 0 }}
                />
                <TextField
                  required
                  label="Account name"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  error={Boolean(fieldErrors.fromAccountName)}
                  helperText={fieldErrors.fromAccountName}
                  sx={{ flex: 1.3, minWidth: 0 }}
                />
              </Stack>
            </Section>
          )}

          <Section title="Amount and fee">
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <MoneyField
                required
                label={included ? 'Total received' : 'Amount repaid'}
                value={amount}
                onChange={setAmount}
                error={overRemaining || Boolean(fieldErrors.amount)}
                helperText={
                  overRemaining
                    ? `Repays more than the ${money(advance.remaining)} owed`
                    : fieldErrors.amount
                }
                sx={{ flex: 1.4 }}
              />
              <TextField
                label="Fee"
                value={percentText}
                onChange={(e) => setPercentText(e.target.value)}
                onBlur={() => {
                  if (feeBasisPoints !== null) setPercentText(formatRate(feeBasisPoints).replace('%', ''));
                }}
                inputMode="decimal"
                error={feeBasisPoints === null || Boolean(fieldErrors.feeBasisPoints)}
                helperText={feeBasisPoints === null ? '0 to 100' : fieldErrors.feeBasisPoints}
                slotProps={{
                  input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                }}
                sx={{ flex: 0.8 }}
              />
            </Stack>
            {isCash ? (
              <Typography variant="caption" color="text.secondary">
                We pay the fee on a cash repayment: it comes off the cash we take in.
              </Typography>
            ) : (
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={feeIncluded}
                    onChange={(e) => setFeeIncluded(e.target.checked)}
                  />
                }
                label={
                  <Typography variant="body2">
                    They already added the fee to what they sent
                  </Typography>
                }
              />
            )}
          </Section>

          <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
            <Stack spacing={0.75}>
              <SummaryLine strong label={isCash ? 'We take in cash' : 'We receive'} value={money(total)} />
              <SummaryLine label="Repays the advance" value={money(principal)} />
              {fee > 0 && (
                <SummaryLine
                  label={
                    isCash
                      ? `Fee we pay (${formatRate(feeBasisPoints ?? 0)})`
                      : `Fee we keep (${formatRate(feeBasisPoints ?? 0)}${included ? ', included' : ''})`
                  }
                  value={money(fee)}
                />
              )}
              <Divider sx={{ my: 0.5 }} />
              <SummaryLine
                label={
                  isCash
                    ? 'Cash in hand'
                    : shopAccount
                      ? `${shopAccount.bankName} · ${shopAccount.accountNumber}`
                      : 'Our account'
                }
                value={`+${money(total)}`}
                tone="success.main"
              />
              <SummaryLine
                label={`Left on ${advance.advanceNumber}`}
                value={overRemaining ? '—' : left === 0 ? 'Settled' : money(left)}
                tone={left === 0 ? 'success.main' : undefined}
              />
            </Stack>
          </Paper>

          <Stack spacing={2}>
            <TextField
              label="Date and time"
              type="datetime-local"
              required
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              error={Boolean(fieldErrors.receivedAt)}
              helperText={fieldErrors.receivedAt}
              sx={{ alignSelf: 'flex-start', minWidth: 260 }}
            />
            <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} fullWidth />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={!canSave}
          onClick={() => {
            setError(null);
            setFieldErrors({});
            save.mutate();
          }}
        >
          {save.isPending ? 'Saving…' : 'Record repayment'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
