import { Autocomplete, Chip, Stack, TextField, type SxProps, type Theme } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMoneyFormatter } from '../hooks/useSettings';
import type { ShopBankAccount } from '@shared/api';

const accountLabel = (a: ShopBankAccount) => `${a.bankName} · ${a.accountNumber} · ${a.accountName}`;

/**
 * Which of the shop's registered accounts money went into or came out of.
 * Shown wherever a payment is not cash, so every bank payment lands in — and
 * shows in the history of — a real account. Typing filters the list by bank,
 * number or name. Each option shows its balance; `spend` (money going out) is
 * flagged when it is more than that balance.
 */
export default function ShopAccountSelect({
  value,
  onChange,
  label = 'Shop account',
  error,
  helperText,
  spend,
  exclude,
  required = true,
  placeholder,
  sx,
}: {
  value: string;
  onChange: (shopAccountId: string) => void;
  label?: string;
  error?: boolean;
  helperText?: string;
  spend?: number;
  /** An account that cannot be picked here, e.g. the other side of a transfer. */
  exclude?: string;
  required?: boolean;
  placeholder?: string;
  sx?: SxProps<Theme>;
}) {
  const money = useMoneyFormatter();
  const accounts = useQuery({
    queryKey: ['shopBankAccounts', 'active'],
    queryFn: () => api.banking.listShopAccounts({ includeInactive: false }),
  });
  const rows = accounts.data ?? [];
  const empty = accounts.isSuccess && rows.length === 0;
  const chosen = rows.find((a) => a.id === value) ?? null;
  const short = chosen !== null && spend !== undefined && spend > chosen.balance;

  return (
    <Autocomplete
      options={rows}
      value={chosen}
      onChange={(_, account) => onChange(account?.id ?? '')}
      getOptionLabel={accountLabel}
      getOptionDisabled={(account) => account.id === exclude}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      noOptionsText="No matching shop account"
      renderOption={({ key, ...props }, account) => (
        <li key={key} {...props}>
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
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          required={required}
          label={label}
          placeholder={placeholder}
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
        />
      )}
      sx={{ minWidth: 220, ...sx }}
    />
  );
}
