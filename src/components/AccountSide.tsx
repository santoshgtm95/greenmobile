import { Box, Chip, Stack, Typography } from '@mui/material';

/**
 * One side of a movement: the name on the account, the registered bank's key
 * when it is one of the shop's own, and the account number typed for it.
 *
 * Shared by the transaction history and the advances list, so a customer's
 * account reads the same on both tabs.
 */
export default function AccountSide({
  accountName,
  accountKey,
  accountNumber,
  typedName,
}: {
  accountName: string | null;
  accountKey: string | null;
  accountNumber: string | null;
  typedName: string | null;
}) {
  return (
    <Stack spacing={0.25}>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
        <Typography
          variant="body2"
          sx={{ fontWeight: 600 }}
          color={typedName ? 'text.primary' : 'text.disabled'}
        >
          {typedName ?? '—'}
        </Typography>
        {accountKey && (
          <Chip
            size="small"
            variant="outlined"
            label={accountKey}
            sx={{ fontFamily: 'monospace', height: 20, fontSize: 11 }}
          />
        )}
      </Stack>
      {(accountNumber || accountName) && (
        <Typography variant="caption" color="text.secondary">
          <Box component="span" sx={{ fontFamily: 'monospace' }}>
            {accountNumber}
          </Box>
          {accountNumber && accountName ? ' · ' : ''}
          {accountName}
        </Typography>
      )}
    </Stack>
  );
}
