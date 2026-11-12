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

type Debtor = { name: string; phone: string | null; count: number; remaining: number };

/** Who still owes the shop, one line per customer, biggest amount first. */
export default function ShopAdvanceCollectableDialog({ onClose }: { onClose: () => void }) {
  const money = useMoneyFormatter();
  // shortcut: only the 200 newest open advances (API page limit); add a grouped query if a shop ever has more.
  const open = useQuery({
    queryKey: ['shopAdvances', 'collectable'],
    queryFn: () => api.banking.listShopAdvances({ status: 'OPEN', page: 0, pageSize: 200 }),
  });

  const byCustomer = new Map<string, Debtor>();
  for (const row of open.data?.rows ?? []) {
    const key = row.recipientName.trim().toLowerCase();
    const debtor = byCustomer.get(key) ?? { name: row.recipientName.trim(), phone: null, count: 0, remaining: 0 };
    debtor.phone ??= row.recipientPhone || null;
    debtor.count += 1;
    debtor.remaining += row.remaining;
    byCustomer.set(key, debtor);
  }
  const debtors = [...byCustomer.values()].sort((a, b) => b.remaining - a.remaining);
  const total = debtors.reduce((sum, d) => sum + d.remaining, 0);

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>Collectable</DialogTitle>
      <DialogContent dividers>
        {open.isError && <Alert severity="error">Unable to load open advances.</Alert>}
        {open.isLoading && <Typography color="text.secondary">Loading…</Typography>}
        {open.data && debtors.length === 0 && (
          <Typography color="text.secondary">Nothing left to collect.</Typography>
        )}
        {debtors.length > 0 && (
          <Paper sx={historyTableSx}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Customer</TableCell>
                  <TableCell align="right">Advances</TableCell>
                  <TableCell align="right">To collect</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {debtors.map((d) => (
                  <TableRow key={d.name.toLowerCase()}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{d.name}</Typography>
                      {d.phone && (
                        <Typography variant="caption" color="text.secondary">{d.phone}</Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">{d.count}</TableCell>
                    <TableCell
                      align="right"
                      sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'warning.main', whiteSpace: 'nowrap' }}
                    >
                      {money(d.remaining)}
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
