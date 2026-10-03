import { useState } from "react";
import {
  Alert,
  Button,
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
} from "@mui/material";
import CallMadeIcon from "@mui/icons-material/CallMade";
import CallReceivedIcon from "@mui/icons-material/CallReceived";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import MoneyField from "./MoneyField";
import { useSettings } from "../hooks/useSettings";
import { PosApiError } from "@shared/errors";
import {
  BANK_FEE_DIRECTIONS,
  BANK_FEE_DIRECTION_LABELS,
  BANK_TRANSACTION_TYPE_LABELS,
  type BankFeeDirection,
  type BankTransactionType,
} from "@shared/domain";
import {
  amountAfterFee,
  formatMoney,
  formatRate,
  parseRate,
  rateOf,
} from "@shared/money";
import { nowLocalDateTime } from "@shared/datetime";
import type { BankAccount } from "@shared/api";

/** 100%, the ceiling the form offers. Basis points, so 100% is 10,000. */
const MAX_FEE_BASIS_POINTS = 10_000;

/** Basis points back to what belongs in the box: 50 → "0.5", 0 → "0". */
function formatPercent(basisPoints: number | null): string {
  if (basisPoints === null) return "";
  return formatRate(basisPoints).replace("%", "");
}

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
  const [type, setType] = useState<BankTransactionType>("TRANSFER");
  // Default to now, so the common case is one field the user never touches.
  const [transactionAt, setTransactionAt] = useState(nowLocalDateTime());
  const [fromAccountId, setFromAccountId] = useState("");
  const [fromAccountNumber, setFromAccountNumber] = useState("");
  const [fromName, setFromName] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [toAccountNumber, setToAccountNumber] = useState("");
  const [toName, setToName] = useState("");
  const [amount, setAmount] = useState(0);
  // The percentage is held as the TEXT being typed, like MoneyField does, so
  // that "0." on the way to "0.5" is not snapped back to "0" mid-keystroke.
  const [percentText, setPercentText] = useState("0");
  const [feeDirection, setFeeDirection] = useState<BankFeeDirection>("RECEIVE");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { data: settings } = useSettings();
  const currency = settings?.currency ?? "THB";

  const isTransfer = type === "TRANSFER";

  /**
   * The typed percentage as basis points: "0.5" → 50.
   *
   * Null means the text is not a usable rate — either unparseable or above the
   * 100% ceiling — which blocks saving rather than quietly being read as zero.
   * An empty box is 0, so clearing the field is not an error.
   */
  const feeBasisPoints = (() => {
    if (percentText.trim() === "") return 0;
    const bp = parseRate(percentText);
    return bp === null || bp > MAX_FEE_BASIS_POINTS ? null : bp;
  })();

  const percentError =
    feeBasisPoints === null
      ? "Enter a number from 0 to 100"
      : (fieldErrors.feeBasisPoints ?? null);

  // Exactly what the main process will store: 1,000,000.00 at 0.5% → 5,000.00.
  const feeAmount =
    feeBasisPoints === null ? 0 : rateOf(amount, feeBasisPoints);

  // 1,000,000 with a 5,000 fee: 1,005,000 received, 995,000 paid.
  const actualAmount = amountAfterFee(amount, feeAmount, feeDirection);

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
        // The rate, not the money. The main process works the fee out itself.
        feeBasisPoints: feeBasisPoints ?? 0,
        feeDirection,
        notes: notes.trim() || undefined,
      }),
    onSuccess: onSaved,
    onError: (err) => {
      if (err instanceof PosApiError) {
        setError(err.message);
        setFieldErrors(err.fields ?? {});
      } else {
        setError("Unable to record this transaction.");
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
              No banks or mobile payments are registered yet. Add one from the
              Banks &amp; Payments button first.
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
              ? "Money leaving one of your accounts — choose which one below."
              : "Money arriving in one of your accounts — choose which one below."}
          </Typography>

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
              Left to size itself rather than given a width. How wide Chromium's
              native datetime-local control needs to be depends on the machine's
              locale — "08/18/2026 10:30 AM" is far wider than "18/08/2026
              10:30" — so a fixed width guessed here clips the time on some
              machines and not others.
            */
            sx={{ alignSelf: "flex-start", minWidth: 260 }}
          />

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
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
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
                  fieldErrors.fromAccountId ??
                  (isTransfer ? "Where the money left" : " ")
                }
                sx={{ flex: "1 1 0", minWidth: 0 }}
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
                helperText={fieldErrors.fromAccountNumber ?? " "}
                sx={{ flex: "1 1 0", minWidth: 0 }}
              />
              <TextField
                label="Account name"
                required
                placeholder="Name on the account"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                error={Boolean(fieldErrors.fromName)}
                helperText={fieldErrors.fromName ?? " "}
                sx={{ flex: "1 1 0", minWidth: 0 }}
              />
            </Stack>
          </Stack>

          <Stack spacing={1}>
            <Typography variant="overline" color="text.secondary">
              To
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
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
                  fieldErrors.toAccountId ??
                  (isTransfer ? " " : "Where the money arrived")
                }
                sx={{ flex: "1 1 0", minWidth: 0 }}
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
                helperText={fieldErrors.toAccountNumber ?? " "}
                sx={{ flex: "1 1 0", minWidth: 0 }}
              />
              <TextField
                label="Account name"
                required
                placeholder="Name on the account"
                value={toName}
                onChange={(e) => setToName(e.target.value)}
                error={Boolean(fieldErrors.toName)}
                helperText={fieldErrors.toName ?? " "}
                sx={{ flex: "1 1 0", minWidth: 0 }}
              />
            </Stack>
          </Stack>

          {/*
            The amount sits below both sides of the movement, because the fee
            beside it is a percentage OF this amount — reading downwards, the row
            is "how much moved, at what rate, which came to this, and who kept
            it". Putting it above the two accounts would separate the rate from
            the figure it is taken from.
          */}
          <Stack spacing={1}>
            <Typography variant="overline" color="text.secondary">
              Amount and fee
            </Typography>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              sx={{ alignItems: { sm: "flex-start" } }}
            >
              <MoneyField
                label="Amount"
                required
                value={amount}
                onChange={setAmount}
                error={Boolean(fieldErrors.amount)}
                helperText={fieldErrors.amount ?? " "}
                sx={{ width: { xs: "100%", sm: 190 } }}
              />
              <TextField
                label="Percentage"
                value={percentText}
                onChange={(e) => setPercentText(e.target.value)}
                onBlur={() => setPercentText(formatPercent(feeBasisPoints))}
                inputMode="decimal"
                error={Boolean(percentError)}
                helperText={percentError ?? "0 to 100"}
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">%</InputAdornment>
                    ),
                  },
                }}
                sx={{ width: { xs: "100%", sm: 150 } }}
              />
              <TextField
                label="Fees"
                /*
                  Read-only rather than disabled: a disabled field is greyed to
                  near-invisibility, and this is a figure the shop is meant to
                  check before saving. The main process calculates it again from
                  the amount and the rate, with this same function, so what is on
                  screen is what gets stored.
                */
                value={formatMoney(feeAmount, currency)}
                slotProps={{
                  input: {
                    readOnly: true,
                    endAdornment: (
                      <InputAdornment position="end">{currency}</InputAdornment>
                    ),
                  },
                }}
                helperText={
                  feeBasisPoints
                    ? `${formatRate(feeBasisPoints)} of the amount`
                    : " "
                }
                sx={{
                  width: { xs: "100%", sm: 190 },
                  "& .MuiInputBase-input": {
                    fontVariantNumeric: "tabular-nums",
                  },
                }}
              />
              <FormControl sx={{ pt: { sm: 0.5 } }}>
                <RadioGroup
                  row
                  value={feeDirection}
                  onChange={(e) =>
                    setFeeDirection(e.target.value as BankFeeDirection)
                  }
                >
                  {BANK_FEE_DIRECTIONS.map((direction) => (
                    <FormControlLabel
                      key={direction}
                      value={direction}
                      control={<Radio size="small" />}
                      label={
                        <Typography variant="body2">
                          {BANK_FEE_DIRECTION_LABELS[direction]}
                        </Typography>
                      }
                    />
                  ))}
                </RadioGroup>
                <FormLabel sx={{ fontSize: 12 }}>The fee is</FormLabel>
              </FormControl>
            </Stack>

            {/*
              Directly under Amount, and the same width, because it is the same
              figure after the fee — not a separate thing to fill in. A fee
              received is on top of the amount, a fee paid comes out of it, so
              this is the number that actually changed hands.
            */}
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              sx={{ alignItems: { sm: "center" } }}
            >
              <TextField
                label="Actual amount"
                value={formatMoney(actualAmount, currency)}
                slotProps={{
                  input: {
                    readOnly: true,
                    endAdornment: (
                      <InputAdornment position="end">{currency}</InputAdornment>
                    ),
                  },
                }}
                sx={{
                  width: { xs: "100%", sm: 190 },
                  "& .MuiInputBase-input": {
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 600,
                  },
                }}
              />
              {feeAmount > 0 && (
                <Typography variant="caption" color="text.secondary">
                  {formatMoney(amount, currency)}{" "}
                  {feeDirection === "RECEIVE" ? "plus" : "less"} the{" "}
                  {formatMoney(feeAmount, currency)} fee
                  {feeDirection === "RECEIVE" ? " you received" : " you paid"}
                </Typography>
              )}
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
            feeBasisPoints === null ||
            ownSideMissing ||
            !transactionAt ||
            !fromAccountNumber.trim() ||
            !fromName.trim() ||
            !toAccountNumber.trim() ||
            !toName.trim()
          }
        >
          {save.isPending ? "Saving…" : "Record transaction"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
