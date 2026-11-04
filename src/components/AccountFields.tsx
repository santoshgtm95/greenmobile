import { MenuItem, Stack, TextField } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { BankAccount } from '@shared/api';

/**
 * Someone else's account, as the New transaction dialog asks for it:
 * Bank / Wallet (from the registered list, or "Not listed"), account number
 * and the name on the account.
 */
export default function AccountFields({
  bankId,
  onBankChange,
  number,
  onNumberChange,
  name,
  onNameChange,
  numberError,
  nameError,
}: {
  bankId: string;
  /** Also hands back the chosen bank, for callers that store its name. */
  onBankChange: (bankId: string, bank: BankAccount | null) => void;
  number: string;
  onNumberChange: (value: string) => void;
  name: string;
  onNameChange: (value: string) => void;
  numberError?: string;
  nameError?: string;
}) {
  const providers = useQuery({
    queryKey: ['bankAccounts', 'active'],
    queryFn: () => api.banking.listAccounts({ includeInactive: false }),
  });
  const banks = providers.data ?? [];

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <TextField
        select
        label="Bank / wallet"
        value={bankId}
        onChange={(e) => onBankChange(e.target.value, banks.find((b) => b.id === e.target.value) ?? null)}
        sx={{ flex: 1, minWidth: 0 }}
      >
        <MenuItem value="">
          <em>Not listed</em>
        </MenuItem>
        {banks.map((bank) => (
          <MenuItem key={bank.id} value={bank.id}>
            {bank.name}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        required
        label="Account number"
        value={number}
        onChange={(e) => onNumberChange(e.target.value)}
        error={Boolean(numberError)}
        helperText={numberError}
        sx={{ flex: 1, minWidth: 0 }}
      />
      <TextField
        required
        label="Account name"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        error={Boolean(nameError)}
        helperText={nameError}
        sx={{ flex: 1.3, minWidth: 0 }}
      />
    </Stack>
  );
}
