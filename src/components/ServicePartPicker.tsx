import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  List,
  ListItemButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useDebounced } from '../hooks/useDebounced';
import { useMoneyFormatter } from '../hooks/useSettings';
import type { Product } from '@shared/api';

/**
 * Picks a spare part to consume on a repair.
 *
 * Serialized products are hidden: a handset tracked by IMEI is stock to sell,
 * not a component to fit, and the service layer refuses them anyway.
 */
export default function ServicePartPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (product: Product, quantity: number) => void;
}) {
  const money = useMoneyFormatter();
  const [search, setSearch] = useState('');
  const [quantity, setQuantity] = useState(1);
  const debounced = useDebounced(search, 250);

  const products = useQuery({
    queryKey: ['serviceParts', debounced],
    queryFn: () =>
      api.products.list({
        search: debounced || undefined,
        categoryId: undefined,
        brandId: undefined,
        lowStockOnly: false,
        includeInactive: false,
        page: 0,
        pageSize: 30,
      }),
  });

  const parts = (products.data?.rows ?? []).filter((p) => p.isSerialized === 0);

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>Add a part from stock</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack direction="row" spacing={2}>
            <TextField
              autoFocus
              placeholder="Search parts by name, SKU or barcode"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <TextField
              label="Qty"
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
              sx={{ maxWidth: 90 }}
            />
          </Stack>

          <Alert severity="info">
            Taking a part here removes it from stock and records it in the inventory history against
            this job.
          </Alert>

          <List dense disablePadding sx={{ maxHeight: 340, overflow: 'auto' }}>
            {products.isLoading && (
              <Typography color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                Searching…
              </Typography>
            )}
            {!products.isLoading && parts.length === 0 && (
              <Typography color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                {search ? 'No parts match that search.' : 'No stock items found.'}
              </Typography>
            )}
            {parts.map((product) => {
              const short = product.stockQuantity < quantity;
              return (
                <ListItemButton
                  key={product.id}
                  onClick={() => onPick(product, quantity)}
                  disabled={short}
                  sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
                >
                  <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography noWrap sx={{ fontWeight: 600 }}>
                      {product.name}
                    </Typography>
                    <Typography variant="caption" color={short ? 'error' : 'text.secondary'}>
                      {product.sku} · {short ? `only ${product.stockQuantity} in stock` : `${product.stockQuantity} in stock`}
                    </Typography>
                  </Stack>
                  <Typography sx={{ fontWeight: 700 }}>{money(product.sellingPrice)}</Typography>
                </ListItemButton>
              );
            })}
          </List>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
