import { useState } from 'react';
import {
  Alert,
  Button,
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
import CallMadeIcon from '@mui/icons-material/CallMade';
import CallReceivedIcon from '@mui/icons-material/CallReceived';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import MoneyField from './MoneyField';
import { PosApiError } from '@shared/errors';
import { BANK_TRANSACTION_TYPE_LABELS, type BankTransactionType } from '@shared/domain';
import { nowLocalDateTime } from '@shared/datetime';
import type { BankAccount } from '@shared/api';

/**
 * Records one movement of money.
 *
 * The form asks for both sides of the movement, but only one of them can be
 * "outside": a transfer must leave one of the shop's own accounts and a receipt
 * must arrive in one. That is what makes the balances on the Banking screen add
 * up, so the required side is marked here and refused in the main process.
 */
export default function BankTransactionDialog({
  accounts,
  onClose,
  onSaved,
}: {
  accounts: BankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<BankTransactionType>('TRANSFER');
  // Default to now, so the common case is one field the user never touches.
  const [transactionAt, setTransactionAt] = useState(nowLocalDateTime());
  const [fromAccountId, setFromAccountId] = useState('');
  const [fromAccountNumber, setFromAccountNumber] = useState('');
  const [fromName, setFromName] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [toAccountNumber, setToAccountNumber] = useState('');
  const [toName, setToName] = useState('');
  const [amount, setAmount] = useState(0);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const isTransfer = type === 'TRANSFER';

  const save = useMutation({
    mutationFn: () =>
      api.banking.createTransaction({
        type,
        transactionAt,
        fromAccountId: fromAccountId || undefined,
        fromAccountNumber: fromAccountNumber.trim(),
        fromName: fromName.trim(),
        toAccountId: toAccountId || undefined,
        toAccountNumber: toAccountNumber.trim(),
        toName: toName.trim(),
        amount,
        notes: notes.trim() || undefined,
      }),
    onSuccess: onSaved,
    onError: (err) => {
      if (err instanceof PosApiError) {
        setError(err.message);
        setFieldErrors(err.fields ?? {});
      } else {
        setError('Unable to record this transaction.');
      }
    },
  });

  /**
   * Every switched-on account, on both sides.
   *
   * Neither dropdown excludes what the other has chosen: moving money within one
   * wallet — Kpay to Kpay — is a real movement a shop wants recorded, and it nets
   * to zero against that account, which is the honest result.
   */
  const accountOptions = () => [
    <MenuItem key="__none" value="">
      <em>Not one of my accounts</em>
    </MenuItem>,
    ...accounts.map((account) => (
      <MenuItem key={account.id} value={account.id}>
        {account.name} ({account.key})
      </MenuItem>
    )),
  ];

  const ownSideMissing = isTransfer ? !fromAccountId : !toAccountId;

  return (
    // Wider than the other dialogs: each side of the movement carries three fields.
    <Dialog open fullWidth maxWidth="md" onClose={onClose}>
      <DialogTitle>New transaction</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {accounts.length === 0 && (
            <Alert severity="warning">
              No banks or mobile payments are registered yet. Add one from the Banks &amp; Payments
              button first.
            </Alert>
          )}

          <ToggleButtonGroup
            exclusive
            fullWidth
            color="primary"
            value={type}
            onChange={(_e, next: BankTransactionType | null) => {
              if (!next) return;
              setType(next);
              setFieldErrors({});
            }}
          >
            <ToggleButton value="TRANSFER">
              <CallMadeIcon fontSize="small" sx={{ mr: 1 }} />
              {BANK_TRANSACTION_TYPE_LABELS.TRANSFER}
            </ToggleButton>
            <ToggleButton value="RECEIVE">
              <CallReceivedIcon fontSize="small" sx={{ mr: 1 }} />
              {BANK_TRANSACTION_TYPE_LABELS.RECEIVE}
            </ToggleButton>
          </ToggleButtonGroup>

          <Typography variant="caption" color="text.secondary">
            {isTransfer
              ? 'Money leaving one of your accounts — choose which one below.'
              : 'Money arriving in one of your accounts — choose which one below.'}
          </Typography>

          <Stack direction="row" spacing={2}>
            <TextField
              label="Date and time"
              type="datetime-local"
              required
              value={transactionAt}
              onChange={(e) => setTransactionAt(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              error={Boolean(fieldErrors.transactionAt)}
              helperText={fieldErrors.transactionAt}
              /*
                The flexible one of the pair, on purpose. How wide Chromium's
                native datetime-local control needs to be depends on the machine's
                locale — "08/18/2026 10:30 AM" is far wider than "18/08/2026
                10:30" — so a fixed width guessed here clips the time on some
                machines and not others. The amount is the predictable field, so
                that is the one with a set width.
              */
              sx={{ flexGrow: 1, minWidth: 0 }}
            />
            <MoneyField
              label="Amount"
              required
              value={amount}
              onChange={setAmount}
              error={Boolean(fieldErrors.amount)}
              helperText={fieldErrors.amount}
              sx={{ width: 175 }}
            />
          </Stack>

          {/*
            Each side reads bank → account number → name on the account.

            The number and the holder are typed per transaction rather than looked
            up, because one registered wallet serves a different account number on
            almost every payment. A number stored against the bank could only ever
            hold one of them.
          */}
          <Stack spacing={1}>
            <Typography variant="overline" color="text.secondary">
              From
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                label="Bank / wallet"
                required={isTransfer}
                value={fromAccountId}
                onChange={(e) => {
                  setFromAccountId(e.target.value);
                  setFieldErrors({});
                }}
                error={Boolean(fieldErrors.fromAccountId)}
                helperText={
                  fieldErrors.fromAccountId ?? (isTransfer ? 'Where the money left' : ' ')
                }
                sx={{ flex: '1 1 0', minWidth: 0 }}
              >
                {accountOptions()}
              </TextField>
              <TextField
                label="Account number"
                required
                placeholder="09 7777 8888"
                value={fromAccountNumber}
                onChange={(e) => setFromAccountNumber(e.target.value)}
                error={Boolean(fieldErrors.fromAccountNumber)}
                helperText={fieldErrors.fromAccountNumber ?? ' '}
                sx={{ flex: '1 1 0', minWidth: 0 }}
              />
              <TextField
                label="Account name"
                required
                placeholder="Name on the account"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                error={Boolean(fieldErrors.fromName)}
                helperText={fieldErrors.fromName ?? ' '}
                sx={{ flex: '1 1 0', minWidth: 0 }}
              />
            </Stack>
          </Stack>

          <Stack spacing={1}>
            <Typography variant="overline" color="text.secondary">
              To
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                label="Bank / wallet"
                required={!isTransfer}
                value={toAccountId}
                onChange={(e) => {
                  setToAccountId(e.target.value);
                  setFieldErrors({});
                }}
                error={Boolean(fieldErrors.toAccountId)}
                helperText={
                  fieldErrors.toAccountId ?? (isTransfer ? ' ' : 'Where the money arrived')
                }
                sx={{ flex: '1 1 0', minWidth: 0 }}
              >
                {accountOptions()}
              </TextField>
              <TextField
                label="Account number"
                required
                placeholder="09 7777 8888"
                value={toAccountNumber}
                onChange={(e) => setToAccountNumber(e.target.value)}
                error={Boolean(fieldErrors.toAccountNumber)}
                helperText={fieldErrors.toAccountNumber ?? ' '}
                sx={{ flex: '1 1 0', minWidth: 0 }}
              />
              <TextField
                label="Account name"
                required
                placeholder="Name on the account"
                value={toName}
                onChange={(e) => setToName(e.target.value)}
                error={Boolean(fieldErrors.toName)}
                helperText={fieldErrors.toName ?? ' '}
                sx={{ flex: '1 1 0', minWidth: 0 }}
              />
            </Stack>
          </Stack>

          <TextField
            label="Notes"
            multiline
            minRows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => {
            setError(null);
            setFieldErrors({});
            save.mutate();
          }}
          disabled={
            save.isPending ||
            amount <= 0 ||
            ownSideMissing ||
            !transactionAt ||
            !fromAccountNumber.trim() ||
            !fromName.trim() ||
            !toAccountNumber.trim() ||
            !toName.trim()
          }
        >
          {save.isPending ? 'Saving…' : 'Record transaction'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
