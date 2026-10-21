import { useState } from "react";
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
} from "@mui/material";
import PaymentsOutlinedIcon from "@mui/icons-material/PaymentsOutlined";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import LocalAtmIcon from "@mui/icons-material/LocalAtm";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import MoneyField from "./MoneyField";
import { useMoneyFormatter } from "../hooks/useSettings";
import { PosApiError } from "@shared/errors";
import { nowLocalDateTime } from "@shared/datetime";
import type { ShopBankAccount } from "@shared/api";

export default function CustomerAdvanceDialog({
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

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [fromType, setFromType] = useState<"ACCOUNT" | "CASH">("ACCOUNT");
  const [fromBankName, setFromBankName] = useState("");
  const [fromAccountNumber, setFromAccountNumber] = useState("");

  const [toType, setToType] = useState<"SHOP_ACCOUNT" | "CASH">("SHOP_ACCOUNT");
  const [toShopAccountId, setToShopAccountId] = useState(
    shopAccounts[0]?.id ?? "",
  );

  const [amount, setAmount] = useState(0);
  const [transactionAt, setTransactionAt] = useState(nowLocalDateTime());
  const [notes, setNotes] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const selectedShopAccount =
    shopAccounts.find((a) => a.id === toShopAccountId) ?? null;

  const save = useMutation({
    mutationFn: () => {
      const isCashDeposit = toType === "CASH";
      const isFromAccount = fromType === "ACCOUNT";

      const combinedNotes = [
        customerPhone.trim() ? `Phone: ${customerPhone.trim()}` : "",
        isFromAccount && fromBankName.trim()
          ? `Customer Bank: ${fromBankName.trim()}`
          : "",
        notes.trim(),
      ]
        .filter(Boolean)
        .join(" · ");

      return api.banking.openAdvance({
        transactionAt,
        fromAccountNumber:
          isFromAccount && fromAccountNumber.trim()
            ? fromAccountNumber.trim()
            : customerPhone.trim() || "-",
        fromName: customerName.trim(),
        toAccountId: isCashDeposit
          ? undefined
          : (selectedShopAccount?.bankAccountId ?? undefined),
        toAccountNumber: isCashDeposit
          ? "-"
          : (selectedShopAccount?.accountNumber ?? "-"),
        toName: isCashDeposit
          ? "Cash in hand"
          : (selectedShopAccount?.accountName ?? "Shop Account"),
        amount,
        depositMethod: isCashDeposit ? "cash" : "account",
        customerPhone: customerPhone.trim() || undefined,
        notes: combinedNotes || undefined,
      });
    },
    onSuccess: onSaved,
    onError: (err) => {
      if (err instanceof PosApiError) {
        setError(err.message);
        setFieldErrors(err.fields ?? {});
      } else {
        setError("Unable to record this advance.");
      }
    },
  });

  const canSave =
    customerName.trim().length > 0 &&
    amount > 0 &&
    (toType !== "SHOP_ACCOUNT" || Boolean(toShopAccountId)) &&
    (fromType !== "ACCOUNT" || Boolean(fromAccountNumber.trim())) &&
    transactionAt;

  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      onClose={save.isPending ? undefined : onClose}
    >
      <DialogTitle>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <PaymentsOutlinedIcon color="primary" />
          <span>New Customer Advance</span>
        </Stack>
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {/* Date & Time */}
          <TextField
            label="Date & Time"
            type="datetime-local"
            value={transactionAt}
            onChange={(e) => setTransactionAt(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            error={Boolean(fieldErrors.transactionAt)}
            helperText={fieldErrors.transactionAt}
            fullWidth
          />

          {/* Customer Details */}
          <Typography
            variant="subtitle2"
            sx={{ fontWeight: 600, color: "text.secondary", mb: -1 }}
          >
            Customer Details
          </Typography>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Customer Name"
              required
              fullWidth
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              error={Boolean(fieldErrors.fromName)}
              helperText={fieldErrors.fromName}
              placeholder="e.g. Ko Aung"
            />
            <TextField
              label="Customer Phone"
              fullWidth
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="e.g. 09123456789"
            />
          </Stack>

          {/* Customer payment source (FROM) */}
          <Box>
            <Typography
              variant="subtitle2"
              sx={{ fontWeight: 600, color: "text.secondary", mb: 1 }}
            >
              From (Customer Payment Method)
            </Typography>
            <ToggleButtonGroup
              exclusive
              fullWidth
              value={fromType}
              onChange={(_e, next: "ACCOUNT" | "CASH" | null) => {
                if (next) {
                  setFromType(next);
                  if (next === "CASH") {
                    setToType("CASH");
                  } else if (next === "ACCOUNT") {
                    setToType("SHOP_ACCOUNT");
                    if (!toShopAccountId && shopAccounts[0]) {
                      setToShopAccountId(shopAccounts[0].id);
                    }
                  }
                }
              }}
              sx={{ mb: 1.5 }}
            >
              <ToggleButton value="ACCOUNT">
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center" }}
                >
                  <AccountBalanceIcon fontSize="small" />
                  <span>Bank / Wallet Account</span>
                </Stack>
              </ToggleButton>
              <ToggleButton value="CASH">
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center" }}
                >
                  <LocalAtmIcon fontSize="small" />
                  <span>Cash</span>
                </Stack>
              </ToggleButton>
            </ToggleButtonGroup>

            {fromType === "ACCOUNT" ? (
              <Stack spacing={1.5}>
                <TextField
                  label="Customer Bank / Wallet Provider"
                  fullWidth
                  value={fromBankName}
                  onChange={(e) => setFromBankName(e.target.value)}
                  placeholder="e.g. KBZ Bank, Kpay, AYA, CB"
                />
                <TextField
                  label="Customer Account / Wallet Number"
                  required
                  fullWidth
                  value={fromAccountNumber}
                  onChange={(e) => setFromAccountNumber(e.target.value)}
                  placeholder="e.g. 09123456789"
                />
              </Stack>
            ) : (
              <Box
                sx={{
                  p: 1.5,
                  bgcolor: "action.hover",
                  borderRadius: 1,
                  border: "1px solid",
                  borderColor: "divider",
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  Customer gives physical cash directly.
                </Typography>
              </Box>
            )}
          </Box>

          {/* Shop Destination (TO - Receive Into) */}
          <Box>
            <Typography
              variant="subtitle2"
              sx={{ fontWeight: 600, color: "text.secondary", mb: 1 }}
            >
              To (Shop Receives Into)
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
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center" }}
                >
                  <AccountBalanceIcon fontSize="small" />
                  <span>Shop Bank Account</span>
                </Stack>
              </ToggleButton>
              <ToggleButton value="CASH">
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center" }}
                >
                  <LocalAtmIcon fontSize="small" />
                  <span>Cash in Hand</span>
                </Stack>
              </ToggleButton>
            </ToggleButtonGroup>

            {toType === "CASH" ? (
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  alignItems: "center",
                  p: 1.5,
                  bgcolor: "action.hover",
                  borderRadius: 1,
                  border: "1px solid",
                  borderColor: "divider",
                }}
              >
                <LocalAtmIcon color="action" />
                <Typography variant="body2" sx={{ flexGrow: 1 }}>
                  Adds directly to shop cash drawer:
                </Typography>
                <Chip
                  label={`Current Cash: ${money(cashInHandAmount)}`}
                  color="default"
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
                value={toShopAccountId}
                onChange={(e) => setToShopAccountId(e.target.value)}
                error={Boolean(fieldErrors.toAccountId)}
                helperText={fieldErrors.toAccountId}
              >
                {shopAccounts.map((account) => (
                  <MenuItem key={account.id} value={account.id}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{
                        alignItems: "center",
                        width: "100%",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>
                        <strong>{account.bankName}</strong> (
                        {account.accountNumber}) · {account.accountName}
                      </span>
                      <Chip
                        size="small"
                        label={money(account.balance)}
                        color={account.balance > 0 ? "success" : "default"}
                        variant="outlined"
                      />
                    </Stack>
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Box>

          {/* Amount Field */}
          <MoneyField
            label="Advance Amount"
            required
            fullWidth
            value={amount}
            onChange={setAmount}
            error={Boolean(fieldErrors.amount)}
            helperText={fieldErrors.amount}
          />

          {/* Notes */}
          <TextField
            label="Notes"
            multiline
            rows={2}
            fullWidth
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Advance deposit to hold for upcoming order"
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
          {save.isPending ? "Recording…" : "Record Advance"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
