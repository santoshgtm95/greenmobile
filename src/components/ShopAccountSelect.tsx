import { Chip, MenuItem, Stack, TextField, type SxProps, type Theme } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMoneyFormatter } from '../hooks/useSettings';

/**
 * Which of the shop's registered accounts money went into or came out of.
 * Shown wherever a payment is not cash, so every bank payment lands in — and
 * shows in the history of — a real account. Each option shows its balance;
 * `spend` (money going out) is flagged when it is more than that balance.
 */
export default function ShopAccountSelect({
  value,
  onChange,
  label = 'Shop account',
  error,
  helperText,
  spend,
  sx,
}: {
  value: string;
  onChange: (shopAccountId: string) => void;
  label?: string;
  error?: boolean;
  helperText?: string;
  spend?: number;
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
  const short = chosen !== undefined && spend !== undefined && spend > chosen.balance;

  return (
    <TextField
      select
      required
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error || empty || short}
      helperText={
        helperText ??
        (empty
          ? 'No shop account registered — add one under Banking › Shop Accounts'
          : short
            ? `More than the balance of ${money(chosen.balance)}`
            : chosen
              ? `Balance ${money(chosen.balance)}`
              : ' ')
      }
      slotProps={{ select: { renderValue: () => (chosen ? `${chosen.bankName} · ${chosen.accountNumber} · ${chosen.accountName}` : '') } }}
      sx={{ minWidth: 220, ...sx }}
    >
      {rows.map((account) => (
        <MenuItem key={account.id} value={account.id}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
            <span>
              <strong>{account.bankName}</strong> ({account.accountNumber}) · {account.accountName}
            </span>
            <Chip
              size="small"
              variant="outlined"
              label={money(account.balance)}
              color={account.balance > 0 ? 'success' : 'default'}
            />
          </Stack>
        </MenuItem>
      ))}
    </TextField>
  );
}
