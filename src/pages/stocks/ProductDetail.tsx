import type { ReactNode } from 'react';
import { Alert, Box, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useMoneyFormatter, useSettings } from '../../hooks/useSettings';
import { PosApiError } from '@shared/errors';
import { formatInstant } from '@shared/datetime';
import { formatRate } from '@shared/money';
import type { Product } from '@shared/api';
import { MovementLedger } from './InventoryParts';
import { SerialTable } from '../../components/SerialsDialog';
import { historyTableSx } from '../../components/historyTableSx';
import { StockStateChip, reorderPointOf } from './stockState';

/** One product: what it is, what is on the shelf, and every movement of it. */
export default function ProductDetail({
  productId,
  actions,
}: {
  productId: string;
  /** The same edit / adjust / barcode / delete buttons as the product list row. */
  actions: (product: Product) => ReactNode;
}) {
  const money = useMoneyFormatter();
  const { data: settings } = useSettings();
  const detail = useQuery({
    queryKey: ['products', 'detail', productId],
    queryFn: () => api.products.get({ id: productId }),
  });

  if (detail.isLoading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress size={26} />
      </Box>
    );
  }
  if (!detail.data) {
    return (
      <Alert severity="error">
        {detail.error instanceof PosApiError ? detail.error.message : 'This product could not be loaded.'}
      </Alert>
    );
  }

  const product = detail.data;
  const reorderPoint = reorderPointOf(product, settings?.lowStockThreshold ?? 5);
  const facts: Array<[string, ReactNode]> = [
    ['SKU', <Box component="span" sx={{ fontFamily: 'monospace' }}>{product.sku}</Box>],
    ['Barcode', <Box component="span" sx={{ fontFamily: 'monospace' }}>{product.barcode ?? '—'}</Box>],
    ['Category', product.categoryName ?? '—'],
    ['Brand', product.brandName ?? '—'],
    ['Purchase price', money(product.purchasePrice)],
    ['Selling price', money(product.sellingPrice)],
    ['Tax rate', product.taxRateOverride ? formatRate(product.taxRate) : 'Shop default'],
    ['Unit', product.unit],
    ['Warranty', product.warrantyMonths ? `${product.warrantyMonths} months` : '—'],
    ['Tracked by IMEI', product.isSerialized ? `Yes · ${product.availableSerials} available` : 'No'],
    ['Created', formatInstant(product.createdAt)],
    ['Updated', formatInstant(product.updatedAt)],
  ];
  const figures: Array<[string, string, string?]> = [
    ['In stock', String(product.stockQuantity), product.stockQuantity <= 0 ? 'error.main' : product.stockQuantity <= reorderPoint ? 'warning.dark' : undefined],
    ['Minimum', String(reorderPoint)],
    ['Stock value at cost', money(Math.max(0, product.stockQuantity) * product.purchasePrice)],
    ['Value at selling price', money(Math.max(0, product.stockQuantity) * product.sellingPrice)],
  ];

  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }} noWrap>
                {product.name}
              </Typography>
              <StockStateChip product={product} reorderPoint={reorderPoint} />
            </Stack>
            {product.description && (
              <Typography variant="body2" color="text.secondary">
                {product.description}
              </Typography>
            )}
          </Box>
          <Stack direction="row" spacing={0.5}>{actions(product)}</Stack>
        </Stack>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 2 }}>
          {figures.map(([label, value, color]) => (
            <Paper key={label} variant="outlined" sx={{ p: 1.5, flex: '1 1 150px' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {label}
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color }}>
                {value}
              </Typography>
            </Paper>
          ))}
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' },
            columnGap: 3,
            rowGap: 1,
            mt: 2,
          }}
        >
          {facts.map(([label, value]) => (
            <Box key={label}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {label}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {value}
              </Typography>
            </Box>
          ))}
        </Box>
      </Paper>

      {product.isSerialized === 1 && (
        <>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            IMEI numbers
          </Typography>
          <Paper sx={historyTableSx}>
            <SerialTable productId={product.id} />
          </Paper>
        </>
      )}

      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        Movement history
      </Typography>
      <MovementLedger lockedProductId={product.id} />
    </Stack>
  );
}
