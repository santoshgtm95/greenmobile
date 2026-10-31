import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import DeleteForeverOutlinedIcon from '@mui/icons-material/DeleteForeverOutlined';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { PosApiError } from '@shared/errors';
import { DATA_MODULES, DATA_MODULE_LABELS, type DataModule } from '@shared/domain';

/** What each button removes, and what it leaves alone — shown before and in the dialog. */
const WHAT: Record<DataModule, { deletes: string; keeps: string }> = {
  BANKING: {
    deletes:
      'All bank transactions, customer and shop advances, internal transfers, cash in hand counts and history, and every account history. Balances go back to zero.',
    keeps: 'Your banks and wallets and registered shop accounts.',
  },
  PRODUCTS: {
    deletes: 'All products, IMEI / serial numbers and stock history.',
    keeps:
      'Product categories and brands. Refused while any sale or repair job still uses a product — delete Sales and Services first.',
  },
  SERVICES: {
    deletes: 'All repair jobs with their parts, labour and payments.',
    keeps: 'Products and stock levels, customers, and the money already in cash or banks.',
  },
  SALES: {
    deletes: 'All sales invoices, their payments and refunds.',
    keeps: 'Products and stock levels, customers, and the money already in cash or banks.',
  },
  EXPENSES: {
    deletes: 'All expenses.',
    keeps: 'Expense categories, and the money already in cash or banks.',
  },
};

/**
 * Settings › Data Control. Wipes one module at a time, for clearing test data
 * before going live. Every delete is confirmed by typing DELETE, and a safety
 * backup is taken first so it can be restored from Backup & Restore.
 */
export default function DataControlPanel() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<DataModule | null>(null);
  const [typed, setTyped] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const purge = useMutation({
    mutationFn: (module: DataModule) => api.data.purgeModule({ module, confirm: 'DELETE' }),
    onSuccess: (result, module) => {
      setConfirming(null);
      setDone(
        `${DATA_MODULE_LABELS[module]}: ${result.deleted} records permanently deleted. ` +
          `A safety backup was saved first: ${result.backupPath}`,
      );
      // Every screen may be showing something that is gone now.
      void queryClient.invalidateQueries();
    },
  });

  const open = (module: DataModule) => {
    purge.reset();
    setTyped('');
    setConfirming(module);
  };

  return (
    <Paper sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
      <Typography variant="h6">Data Control</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
        Permanently delete all data in one module — for example test entries before you start
        trading. Other modules are not touched. A safety backup is saved before every delete.
      </Typography>

      {done && (
        <Alert severity="success" onClose={() => setDone(null)} sx={{ mb: 2, wordBreak: 'break-all' }}>
          {done}
        </Alert>
      )}

      <Stack divider={<Divider />} spacing={2}>
        {DATA_MODULES.map((module) => (
          <Stack
            key={module}
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: { sm: 'center' } }}
          >
            <Stack spacing={0.25} sx={{ flex: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {DATA_MODULE_LABELS[module]}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {WHAT[module].deletes}
              </Typography>
            </Stack>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteForeverOutlinedIcon />}
              onClick={() => open(module)}
              sx={{ alignSelf: { xs: 'flex-start', sm: 'center' }, whiteSpace: 'nowrap' }}
            >
              Delete {DATA_MODULE_LABELS[module]} data
            </Button>
          </Stack>
        ))}
      </Stack>

      {confirming && (
        <Dialog open fullWidth maxWidth="xs" onClose={purge.isPending ? undefined : () => setConfirming(null)}>
          <DialogTitle>Delete all {DATA_MODULE_LABELS[confirming]} data?</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {purge.isError && (
                <Alert severity="error">
                  {purge.error instanceof PosApiError ? purge.error.message : 'Unable to delete this data.'}
                </Alert>
              )}
              <Alert severity="warning">This cannot be undone.</Alert>
              <Typography variant="body2">
                <strong>Deletes:</strong> {WHAT[confirming].deletes}
              </Typography>
              <Typography variant="body2">
                <strong>Keeps:</strong> {WHAT[confirming].keeps}
              </Typography>
              <TextField
                autoFocus
                label="Type DELETE to confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && typed === 'DELETE' && !purge.isPending) purge.mutate(confirming);
                }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirming(null)} disabled={purge.isPending}>
              Cancel
            </Button>
            <Button
              variant="contained"
              color="error"
              disabled={typed !== 'DELETE' || purge.isPending}
              onClick={() => purge.mutate(confirming)}
            >
              {purge.isPending ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Paper>
  );
}
