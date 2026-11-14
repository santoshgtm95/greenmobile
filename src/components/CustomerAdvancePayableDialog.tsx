import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMoneyFormatter } from '../hooks/useSettings';
import { historyTableSx } from './historyTableSx';

type Creditor = { name: string; account: string | null; count: number; remaining: number };

/** What the shop still has to pay out to customers, one line per customer, biggest amount first. */
export default function CustomerAdvancePayableDialog({ onClose }: { onClose: () => void }) {
  const money = useMoneyFormatter();
  // shortcut: only the 200 newest open advances (API page limit); add a grouped query if a shop ever has more.
  const open = useQuery({
    queryKey: ['bankAdvances', 'payable'],
    queryFn: () => api.banking.listAdvances({ status: 'OPEN', page: 0, pageSize: 200 }),
  });

  const byCustomer = new Map<string, Creditor>();
  for (const row of open.data?.rows ?? []) {
    const name = (row.fromName || row.fromAccountName || 'Unknown').trim();
    const key = name.toLowerCase();
    const creditor = byCustomer.get(key) ?? { name, account: null, count: 0, remaining: 0 };
    creditor.account ??= row.fromAccountNumber || null;
    creditor.count += 1;
    creditor.remaining += row.remaining;
    byCustomer.set(key, creditor);
  }
  const creditors = [...byCustomer.values()].sort((a, b) => b.remaining - a.remaining);
  const total = creditors.reduce((sum, c) => sum + c.remaining, 0);

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>Payable</DialogTitle>
      <DialogContent dividers>
        {open.isError && <Alert severity="error">Unable to load open advances.</Alert>}
        {open.isLoading && <Typography color="text.secondary">Loading…</Typography>}
        {open.data && creditors.length === 0 && (
          <Typography color="text.secondary">Nothing left to pay.</Typography>
        )}
        {creditors.length > 0 && (
          <Paper sx={historyTableSx}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Customer</TableCell>
                  <TableCell align="right">Advances</TableCell>
                  <TableCell align="right">To pay</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {creditors.map((c) => (
                  <TableRow key={c.name.toLowerCase()}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{c.name}</Typography>
                      {c.account && (
                        <Typography variant="caption" color="text.secondary">{c.account}</Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">{c.count}</TableCell>
                    <TableCell
                      align="right"
                      sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'warning.main', whiteSpace: 'nowrap' }}
                    >
                      {money(c.remaining)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Total</TableCell>
                  <TableCell />
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {money(total)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Paper>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
