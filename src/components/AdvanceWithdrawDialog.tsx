import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import LocalAtmIcon from "@mui/icons-material/LocalAtm";
import CallMadeIcon from "@mui/icons-material/CallMade";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import MoneyField from "./MoneyField";
import ShopAccountSelect from "./ShopAccountSelect";
import CashInHandBox from "./CashInHandBox";
import { useMoneyFormatter } from "../hooks/useSettings";
import { PosApiError } from "@shared/errors";
import { addMoney, bankFee, formatRate, subtractMoney } from "@shared/money";
import { formatInstant, nowLocalDateTime } from "@shared/datetime";
import type { BankAccount, BankAdvance } from "@shared/api";
import { percentToBasisPoints, Section, SummaryLine, TypeButton } from "./MovementParts";

type Method = "cash" | "account";

/**
 * Paying some or all of a customer's advance back out.
 *
 * The advance goes down by the amount withdrawn. The shop keeps the fee, so the
 * customer receives the amount less the fee — in cash from the drawer, or sent
 * from one of our accounts. Bank charges on a transfer come out of our account
 * only.
 */
export default function AdvanceWithdrawDialog({
  advance,
  accounts,
  onClose,
  onSaved,
}: {
  advance: BankAdvance;
  accounts: BankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const money = useMoneyFormatter();

  const [method, setMethod] = useState<Method>("cash");
  const [shopAccountId, setShopAccountId] = useState("");
  // Sending back to where the money came from, unless the customer says otherwise.
  const [customerBankId, setCustomerBankId] = useState(
    advance.fromAccountId && accounts.some((a) => a.id === advance.fromAccountId)
      ? advance.fromAccountId
      : "",
  );
  const [customerNumber, setCustomerNumber] = useState(
    advance.fromAccountNumber && advance.fromAccountNumber !== "-" ? advance.fromAccountNumber : "",
  );
  const [customerName, setCustomerName] = useState(advance.fromName ?? "");
  const [amount, setAmount] = useState(0);
  const [percentText, setPercentText] = useState("0");
  const [otherFees, setOtherFees] = useState(0);
  const [transactionAt, setTransactionAt] = useState(nowLocalDateTime());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const shopAccountsQuery = useQuery({
    queryKey: ["shopBankAccounts", "active"],
    queryFn: () => api.banking.listShopAccounts({ includeInactive: false }),
  });
  const shopAccounts = shopAccountsQuery.data ?? [];
  // The account the deposit went into is the natural one to pay it back from.
  const defaultShopAccount = shopAccounts.find(
    (a) => a.bankAccountId === advance.toAccountId && a.accountNumber === advance.toAccountNumber,
  );
  const shopAccount =
    shopAccounts.find((a) => a.id === (shopAccountId || defaultShopAccount?.id)) ?? null;

  const isCash = method === "cash";
  const feeBasisPoints = percentToBasisPoints(percentText);
  const fee = feeBasisPoints === null ? 0 : bankFee(amount, feeBasisPoints);
  const paidOut = subtractMoney(amount, fee);
  const charges = isCash ? 0 : otherFees;
  const overRemaining = amount > advance.remaining;
  const left = advance.remaining - amount;

  const save = useMutation({
    mutationFn: () =>
      api.banking.withdrawAdvance({
        advanceId: advance.id,
        transactionAt,
        withdrawalMethod: method,
        fromAccountId: isCash ? undefined : shopAccount?.bankAccountId,
        fromAccountNumber: isCash ? "-" : (shopAccount?.accountNumber ?? ""),
        fromName: isCash ? "Cash in hand" : (shopAccount?.accountName ?? ""),
        toAccountId: isCash ? undefined : customerBankId || undefined,
        toAccountNumber: isCash ? "" : customerNumber.trim(),
        toName: customerName.trim() || "Cash",
        amount,
        // The rate, not the money: the main process works the fee out itself.
        feeBasisPoints: feeBasisPoints ?? 0,
        feeDirection: "RECEIVE",
        otherFees: charges,
        notes: notes.trim() || undefined,
      }),
    onSuccess: onSaved,
    onError: (err) => {
      if (err instanceof PosApiError) {
        setError(err.message);
        setFieldErrors(err.fields ?? {});
      } else {
        setError("Unable to record this withdrawal.");
      }
    },
  });

  const canSave =
    !save.isPending &&
    amount > 0 &&
    !overRemaining &&
    feeBasisPoints !== null &&
    Boolean(transactionAt) &&
    (isCash || (shopAccount !== null && customerNumber.trim() !== "" && customerName.trim() !== ""));

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>Withdraw from advance</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {error && <Alert severity="error">{error}</Alert>}

          <Alert
            severity="info"
            action={
              <Button color="inherit" size="small" sx={{ whiteSpace: "nowrap" }} onClick={() => setAmount(advance.remaining)}>
                Withdraw all
              </Button>
            }
          >
            <strong>{advance.transactionNumber}</strong> · {advance.fromName} deposited{" "}
            {money(advance.amount)} on {formatInstant(advance.transactionDate)}.{" "}
            <strong>{money(advance.remaining)}</strong> left to collect.
          </Alert>

          <ToggleButtonGroup
            exclusive
            fullWidth
            color="primary"
            value={method}
            onChange={(_e, next: Method | null) => {
              if (!next) return;
              setMethod(next);
              setFieldErrors({});
            }}
          >
            <TypeButton
              value="cash"
              icon={<LocalAtmIcon fontSize="small" />}
              title="Cash"
              caption="Customer takes cash from the drawer"
            />
            <TypeButton
              value="account"
              icon={<CallMadeIcon fontSize="small" />}
              title="Transfer"
              caption="We send it to the customer's account"
            />
          </ToggleButtonGroup>

          {isCash ? (
            <>
              <TextField
                label="Customer name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                fullWidth
              />
              <CashInHandBox spend={paidOut} />
            </>
          ) : (
            <>
              <Section title="Send from our account">
                {shopAccountsQuery.isSuccess && shopAccounts.length === 0 ? (
                  <Alert severity="warning">
                    No shop account is registered yet. Add your account numbers with
                    &quot;Register Accounts&quot; on the Banking screen first.
                  </Alert>
                ) : (
                  <ShopAccountSelect
                    label="Our account"
                    value={shopAccount?.id ?? ""}
                    onChange={setShopAccountId}
                    error={Boolean(fieldErrors.fromAccountId ?? fieldErrors.fromAccountNumber)}
                    helperText={fieldErrors.fromAccountId ?? fieldErrors.fromAccountNumber}
                    spend={addMoney(paidOut, charges)}
                    sx={{ width: "100%" }}
                  />
                )}
              </Section>

              <Section title="Send to customer">
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <TextField
                    select
                    label="Bank / wallet"
                    value={customerBankId}
                    onChange={(e) => setCustomerBankId(e.target.value)}
                    sx={{ flex: 1, minWidth: 0 }}
                  >
                    <MenuItem value="">
                      <em>Not listed</em>
                    </MenuItem>
                    {accounts.map((account) => (
                      <MenuItem key={account.id} value={account.id}>
                        {account.name}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    required
                    label="Account number"
                    value={customerNumber}
                    onChange={(e) => setCustomerNumber(e.target.value)}
                    error={Boolean(fieldErrors.toAccountNumber)}
                    helperText={fieldErrors.toAccountNumber}
                    sx={{ flex: 1, minWidth: 0 }}
                  />
                  <TextField
                    required
                    label="Name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    error={Boolean(fieldErrors.toName)}
                    helperText={fieldErrors.toName}
                    sx={{ flex: 1.3, minWidth: 0 }}
                  />
                </Stack>
              </Section>
            </>
          )}

          <Section title="Amount and fee">
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <MoneyField
                required
                label="Amount to withdraw"
                value={amount}
                onChange={setAmount}
                error={overRemaining || Boolean(fieldErrors.amount)}
                helperText={
                  overRemaining ? `At most ${money(advance.remaining)}` : fieldErrors.amount
                }
                sx={{ flex: 1.4 }}
              />
              <TextField
                label="Fee"
                value={percentText}
                onChange={(e) => setPercentText(e.target.value)}
                onBlur={() => {
                  if (feeBasisPoints !== null) setPercentText(formatRate(feeBasisPoints).replace("%", ""));
                }}
                inputMode="decimal"
                error={feeBasisPoints === null || Boolean(fieldErrors.feeBasisPoints)}
                helperText={feeBasisPoints === null ? "0 to 100" : fieldErrors.feeBasisPoints}
                slotProps={{
                  input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                }}
                sx={{ flex: 0.8 }}
              />
              {!isCash && (
                <MoneyField
                  label="Bank charges"
                  value={otherFees}
                  onChange={setOtherFees}
                  error={Boolean(fieldErrors.otherFees)}
                  helperText={fieldErrors.otherFees}
                  sx={{ flex: 1.2 }}
                />
              )}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {isCash
                ? "We keep the fee: it comes out of the cash the customer receives."
                : "We keep the fee. Bank charges come out of our account only, never from the customer."}
            </Typography>
          </Section>

          <Paper variant="outlined" sx={{ p: 2, bgcolor: "action.hover" }}>
            <Stack spacing={0.75}>
              <SummaryLine strong label="Customer receives" value={money(paidOut)} />
              {fee > 0 && (
                <SummaryLine
                  label={`Fee we keep (${formatRate(feeBasisPoints ?? 0)})`}
                  value={money(fee)}
                />
              )}
              <Divider sx={{ my: 0.5 }} />
              {isCash ? (
                <SummaryLine label="Cash in hand" value={`−${money(paidOut)}`} tone="error.main" />
              ) : (
                <SummaryLine
                  label={`${shopAccount ? `${shopAccount.bankName} · ${shopAccount.accountNumber}` : "Our account"}${
                    charges > 0 ? ` (incl. ${money(charges)} bank charges)` : ""
                  }`}
                  value={`−${money(addMoney(paidOut, charges))}`}
                  tone="error.main"
                />
              )}
              <SummaryLine
                label={`Left on ${advance.transactionNumber}`}
                value={overRemaining ? "—" : left === 0 ? "Settled" : money(left)}
                tone={left === 0 ? "success.main" : undefined}
              />
            </Stack>
          </Paper>

          <Stack spacing={2}>
            <TextField
              label="Date and time"
              type="datetime-local"
              required
              value={transactionAt}
              onChange={(e) => setTransactionAt(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              error={Boolean(fieldErrors.transactionAt)}
              helperText={fieldErrors.transactionAt}
              sx={{ alignSelf: "flex-start", minWidth: 260 }}
            />
            <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} fullWidth />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!canSave}
          onClick={() => {
            setError(null);
            setFieldErrors({});
            save.mutate();
          }}
        >
          {save.isPending ? "Saving…" : "Record withdrawal"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
