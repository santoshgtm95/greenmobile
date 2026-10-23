import { useState, type ReactNode } from "react";
import {
  Alert,
  Box,
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
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import CallMadeIcon from "@mui/icons-material/CallMade";
import CallReceivedIcon from "@mui/icons-material/CallReceived";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import MoneyField from "./MoneyField";
import { useMoneyFormatter } from "../hooks/useSettings";
import { PosApiError } from "@shared/errors";
import { addMoney, bankFee, formatRate, parseRate, subtractMoney } from "@shared/money";
import { nowLocalDateTime } from "@shared/datetime";
import type { BankTransactionType } from "@shared/domain";
import type { BankAccount } from "@shared/api";

/** 100%, as basis points. */
const MAX_FEE_BASIS_POINTS = 10_000;

/**
 * Cash In / Cash Out at the counter.
 *
 *   Cash In   customer hands over cash, the shop sends money from its account.
 *             The shop GIVES the fee: cash taken = amount − fee.
 *             Bank charges (other fees) come out of the shop's account only.
 *   Cash Out  customer sends money to the shop's account, the shop hands over
 *             cash. The shop KEEPS the fee: cash given = amount − fee. When the
 *             customer already added the fee to what they sent, the fee is the
 *             part above the cash instead.
 *
 * The summary at the bottom shows exactly what happens to the account and to
 * cash in hand, worked out with the same functions the main process uses.
 */
export default function CashTransactionDialog({
  accounts,
  onClose,
  onSaved,
}: {
  accounts: BankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const money = useMoneyFormatter();

  const [type, setType] = useState<BankTransactionType>("TRANSFER");
  const [shopAccountId, setShopAccountId] = useState("");
  const [customerBankId, setCustomerBankId] = useState("");
  const [customerNumber, setCustomerNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [amount, setAmount] = useState(0);
  // Held as typed text so "0." on the way to "0.5" is not snapped back.
  const [percentText, setPercentText] = useState("0");
  const [feeIncluded, setFeeIncluded] = useState(false);
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
  const shopAccount = shopAccounts.find((a) => a.id === shopAccountId) ?? null;

  const isCashIn = type === "TRANSFER";
  // Server errors are keyed by side; ours is "from" on a Cash In, "to" on a Cash Out.
  const own = isCashIn ? "from" : "to";
  const customer = isCashIn ? "to" : "from";

  const feeBasisPoints = (() => {
    if (percentText.trim() === "") return 0;
    const bp = parseRate(percentText);
    return bp === null || bp > MAX_FEE_BASIS_POINTS ? null : bp;
  })();
  const included = !isCashIn && feeIncluded;
  const fee = feeBasisPoints === null ? 0 : bankFee(amount, feeBasisPoints, included);
  // Both ways, the cash that changes hands is the amount less the fee.
  const cash = subtractMoney(amount, fee);
  const charges = isCashIn ? otherFees : 0;

  const save = useMutation({
    mutationFn: () => {
      const ours = {
        accountId: shopAccount?.bankAccountId,
        number: shopAccount?.accountNumber ?? "",
        name: shopAccount?.accountName ?? "",
      };
      const theirs = {
        accountId: customerBankId || undefined,
        number: customerNumber.trim(),
        name: customerName.trim(),
      };
      const [from, to] = isCashIn ? [ours, theirs] : [theirs, ours];
      return api.banking.createTransaction({
        type,
        transactionAt,
        fromAccountId: from.accountId,
        fromAccountNumber: from.number,
        fromName: from.name,
        toAccountId: to.accountId,
        toAccountNumber: to.number,
        toName: to.name,
        amount,
        // The rate, not the money: the main process works the fee out itself.
        feeBasisPoints: feeBasisPoints ?? 0,
        feeDirection: isCashIn ? "PAY" : "RECEIVE",
        feeIncluded: included,
        otherFees: charges,
        notes: notes.trim() || undefined,
      });
    },
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

  const canSave =
    !save.isPending &&
    shopAccount !== null &&
    amount > 0 &&
    feeBasisPoints !== null &&
    customerNumber.trim() !== "" &&
    customerName.trim() !== "" &&
    Boolean(transactionAt);

  const accountLabel = shopAccount
    ? `${shopAccount.bankName} · ${shopAccount.accountNumber}`
    : "Our account";

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>New transaction</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {error && <Alert severity="error">{error}</Alert>}

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
            <TypeButton
              value="TRANSFER"
              icon={<CallMadeIcon fontSize="small" />}
              title="Cash In"
              caption="Customer gives cash, we send money"
            />
            <TypeButton
              value="RECEIVE"
              icon={<CallReceivedIcon fontSize="small" />}
              title="Cash Out"
              caption="Customer sends money, we give cash"
            />
          </ToggleButtonGroup>

          <Section title={isCashIn ? "Send from our account" : "Received in our account"}>
            {shopAccountsQuery.isSuccess && shopAccounts.length === 0 ? (
              <Alert severity="warning">
                No shop account is registered yet. Add your account numbers with
                &quot;Register Accounts&quot; on the Banking screen first.
              </Alert>
            ) : (
              <TextField
                select
                required
                fullWidth
                label="Our account"
                value={shopAccountId}
                onChange={(e) => {
                  setShopAccountId(e.target.value);
                  setFieldErrors({});
                }}
                error={Boolean(fieldErrors[`${own}AccountId`] ?? fieldErrors[`${own}AccountNumber`])}
                helperText={
                  fieldErrors[`${own}AccountId`] ??
                  fieldErrors[`${own}AccountNumber`] ??
                  (shopAccount ? `Balance ${money(shopAccount.balance)}` : " ")
                }
              >
                {shopAccounts.map((account) => (
                  <MenuItem key={account.id} value={account.id}>
                    {account.bankName} · {account.accountNumber} · {account.accountName}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Section>

          <Section title={isCashIn ? "Send to customer" : "Received from customer"}>
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
                error={Boolean(fieldErrors[`${customer}AccountNumber`])}
                helperText={fieldErrors[`${customer}AccountNumber`]}
                sx={{ flex: 1, minWidth: 0 }}
              />
              <TextField
                required
                label="Name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                error={Boolean(fieldErrors[`${customer}Name`])}
                helperText={fieldErrors[`${customer}Name`]}
                sx={{ flex: 1.3, minWidth: 0 }}
              />
            </Stack>
          </Section>

          <Section title="Amount and fee">
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <MoneyField
                required
                label={isCashIn ? "Amount to send" : "Amount received"}
                value={amount}
                onChange={setAmount}
                error={Boolean(fieldErrors.amount)}
                helperText={fieldErrors.amount}
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
              {isCashIn && (
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
            {isCashIn ? (
              <Typography variant="caption" color="text.secondary">
                Bank charges are bank-to-bank fees. They come out of our account
                only, never from the customer.
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
                    The customer already added the fee to what they sent
                  </Typography>
                }
              />
            )}
          </Section>

          <Paper variant="outlined" sx={{ p: 2, bgcolor: "action.hover" }}>
            <Stack spacing={0.75}>
              <SummaryLine
                strong
                label={isCashIn ? "Take cash from customer" : "Give cash to customer"}
                value={money(cash)}
              />
              {fee > 0 && (
                <SummaryLine
                  label={
                    isCashIn
                      ? `Fee we give (${formatRate(feeBasisPoints ?? 0)})`
                      : `Fee we keep (${formatRate(feeBasisPoints ?? 0)}${included ? ", included" : ""})`
                  }
                  value={money(fee)}
                />
              )}
              <Divider sx={{ my: 0.5 }} />
              <SummaryLine
                label={`${accountLabel}${charges > 0 ? ` (incl. ${money(charges)} bank charges)` : ""}`}
                value={isCashIn ? `−${money(addMoney(amount, charges))}` : `+${money(amount)}`}
                tone={isCashIn ? "error.main" : "success.main"}
              />
              <SummaryLine
                label="Cash in hand"
                value={isCashIn ? `+${money(cash)}` : `−${money(cash)}`}
                tone={isCashIn ? "success.main" : "error.main"}
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
              // Sized by the browser: the native control's width depends on the
              // machine's date format, so a fixed width clips it on some PCs.
              sx={{ alignSelf: "flex-start", minWidth: 260 }}
            />
            <TextField
              label="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              fullWidth
            />
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
          {save.isPending ? "Saving…" : isCashIn ? "Record Cash In" : "Record Cash Out"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function TypeButton({
  value,
  icon,
  title,
  caption,
  ...rest
}: {
  value: BankTransactionType;
  icon: ReactNode;
  title: string;
  caption: string;
}) {
  // ToggleButtonGroup passes selection props down; forward them to the button.
  return (
    <ToggleButton value={value} {...rest} sx={{ py: 1.25, textTransform: "none" }}>
      <Stack spacing={0.25} sx={{ alignItems: "center" }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          {icon}
          <Typography sx={{ fontWeight: 700 }}>{title}</Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {caption}
        </Typography>
      </Stack>
    </ToggleButton>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack spacing={1.25}>
      <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.5 }}>
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

function SummaryLine({
  label,
  value,
  tone,
  strong = false,
}: {
  label: string;
  value: string;
  tone?: string;
  strong?: boolean;
}) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, alignItems: "baseline" }}>
      <Typography variant={strong ? "body1" : "body2"} sx={{ fontWeight: strong ? 700 : 400 }}>
        {label}
      </Typography>
      <Typography
        variant={strong ? "h6" : "body2"}
        sx={{
          fontWeight: strong ? 700 : 600,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          color: tone,
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}
