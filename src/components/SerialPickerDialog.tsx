import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMoneyFormatter } from '../hooks/useSettings';
import type { Product, ProductSerial } from '@shared/api';

/**
 * Choosing which handset is being sold (spec §34).
 *
 * Only AVAILABLE units are requested, so a sold, returned or faulty unit can
 * never be picked. The main process re-checks this when the sale commits.
 */
export default function SerialPickerDialog({
  product,
  excludeIds,
  onClose,
  onPick,
}: {
  product: Product;
  excludeIds: string[];
  onClose: () => void;
  onPick: (serial: ProductSerial) => void;
}) {
  const money = useMoneyFormatter();

  const serials = useQuery({
    queryKey: ['serials', product.id, 'AVAILABLE'],
    queryFn: () => api.serials.list({ productId: product.id, status: 'AVAILABLE' }),
  });

  const available = (serials.data ?? []).filter((s) => !excludeIds.includes(s.id));

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>Choose an IMEI — {product.name}</DialogTitle>
      <DialogContent dividers>
        {serials.isLoading && <Typography color="text.secondary">Loading…</Typography>}

        {!serials.isLoading && available.length === 0 && (
          <Alert severity="warning">
            No units of {product.name} are available to sell. Add IMEI numbers from the Products
            screen, or check whether they have all been sold.
          </Alert>
        )}

        <List dense disablePadding>
          {available.map((serial) => (
            <ListItemButton
              key={serial.id}
              onClick={() => onPick(serial)}
              sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
            >
              <Stack sx={{ flexGrow: 1 }}>
                <Typography sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                  {serial.imei1 ?? serial.serialNumber}
                </Typography>
                {serial.imei2 && (
                  <Typography variant="caption" color="text.secondary">
                    IMEI 2 {serial.imei2}
                  </Typography>
                )}
              </Stack>
              <Typography sx={{ fontWeight: 700 }}>
                {money(serial.sellingPrice ?? product.sellingPrice)}
              </Typography>
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
