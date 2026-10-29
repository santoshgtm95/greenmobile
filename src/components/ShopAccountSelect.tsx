import { MenuItem, TextField, type SxProps, type Theme } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMoneyFormatter } from '../hooks/useSettings';

/**
 * Which of the shop's registered accounts money went into or came out of.
 * Shown wherever a payment is not cash, so every bank payment lands in — and
 * shows in the history of — a real account.
 */
export default function ShopAccountSelect({
  value,
  onChange,
  label = 'Shop account',
  error,
  helperText,
  sx,
}: {
  value: string;
  onChange: (shopAccountId: string) => void;
  label?: string;
  error?: boolean;
  helperText?: string;
  sx?: SxProps<Theme>;
}) {
  const money = useMoneyFormatter();
  const accounts = useQuery({
    queryKey: ['shopBankAccounts', 'active'],
    queryFn: () => api.banking.listShopAccounts({ includeInactive: false }),
  });
  const rows = accounts.data ?? [];
  const empty = accounts.isSuccess && rows.length === 0;
  const chosen = rows.find((a) => a.id === value);

  return (
    <TextField
      select
      required
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error || empty}
      helperText={
        helperText ??
        (empty
          ? 'No shop account registered — add one under Banking › Shop Accounts'
          : chosen
            ? `Balance ${money(chosen.balance)}`
            : ' ')
      }
      sx={{ minWidth: 220, ...sx }}
    >
      {rows.map((account) => (
        <MenuItem key={account.id} value={account.id}>
          {account.bankName} · {account.accountNumber} · {account.accountName}
        </MenuItem>
      ))}
    </TextField>
  );
}
