import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import NorthEastIcon from '@mui/icons-material/NorthEast';
import SouthWestIcon from '@mui/icons-material/SouthWest';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useMoneyFormatter, useSettings } from '../../hooks/useSettings';
import { useDebounced } from '../../hooks/useDebounced';
import { PosApiError } from '@shared/errors';
import {
  INVENTORY_TRANSACTION_LABELS,
  INVENTORY_TRANSACTION_TYPES,
  type InventoryTransactionType,
} from '@shared/domain';
import { formatInstant } from '@shared/datetime';
import type { LowStockItem } from '@shared/api';

/**
 * The inventory side of Stocks (spec §5, §66): headline figures, the movement
 * ledger and the reorder list. Nothing in the application can move stock without
 * leaving a ledger row, which is what makes a discrepancy something you can
 * investigate rather than argue about.
 */
// -----------------------------------------------------------------------------
// Headline figures
// -----------------------------------------------------------------------------

export function StockFigures({
  data,
  lowStock,
}: {
  data: Awaited<ReturnType<typeof api.inventory.summary>> | undefined;
  lowStock: LowStockItem[] | undefined;
}) {
  const money = useMoneyFormatter();

  const figures: Array<{ label: string; value: string; hint?: string; alert?: boolean }> = [
    { label: 'Units on the shelf', value: (data?.unitsHeld ?? 0).toLocaleString('en-US') },
    {
      label: 'Stock value at cost',
      value: money(data?.stockValueAtCost ?? 0),
      hint: 'At purchase price',
    },
    {
      label: 'Potential revenue',
      value: money(data?.potentialRevenue ?? 0),
      hint: 'At current selling prices',
    },
    {
      label: 'Products in stock',
      value: `${data?.productsInStock ?? 0} of ${data?.products ?? 0}`,
    },
    {
      label: 'Low stock',
      value: String(lowStock?.length ?? data?.lowStockCount ?? 0),
      alert: (lowStock?.length ?? data?.lowStockCount ?? 0) > 0,
    },
    {
      label: 'Out of stock',
      value: String(data?.outOfStockCount ?? 0),
      alert: (data?.outOfStockCount ?? 0) > 0,
    },
    {
      label: 'Handsets available',
      value: String(data?.availableSerials ?? 0),
      hint: 'Individually tracked by IMEI',
    },
  ];

  return (
    // Flex-wrap rather than a grid: seven cards in a six-column grid leave the
    // seventh alone against a row of empty space. maxWidth matters as much as the
    // flex basis — without it, that lone seventh card stretches across the whole
    // window, which looks more broken than the gap did.
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
      {figures.map((figure) => (
        <Paper
          key={figure.label}
          sx={{
            p: 2,
            flex: '1 1 180px',
            minWidth: 180,
            maxWidth: 260,
            border: '1px solid',
            borderColor: figure.alert ? 'warning.main' : 'divider',
          }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {figure.label}
          </Typography>
          <Typography
            variant="h6"
            sx={{
              fontWeight: 700,
              mt: 0.25,
              fontVariantNumeric: 'tabular-nums',
              color: figure.alert ? 'warning.dark' : 'text.primary',
            }}
          >
            {figure.value}
          </Typography>
          {figure.hint && (
            <Typography variant="caption" color="text.secondary">
              {figure.hint}
            </Typography>
          )}
        </Paper>
      ))}
    </Box>
  );
}


// -----------------------------------------------------------------------------
// Movement ledger
// -----------------------------------------------------------------------------

/**
 * Every stock movement ever recorded (spec §5, §66).
 *
 * Shows the level before and after each movement, not just the delta: that is
 * what lets someone walk back through the ledger and find the point at which the
 * recorded stock and the shelf stopped agreeing.
 */
/** `lockedProductId` pins the ledger to one product and hides the product picker. */
export function MovementLedger({ lockedProductId }: { lockedProductId?: string }) {
  const money = useMoneyFormatter();

  const [productSearch, setProductSearch] = useState('');
  const [pickedProductId, setProductId] = useState('');
  const productId = lockedProductId ?? pickedProductId;
  const [type, setType] = useState<InventoryTransactionType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  const debouncedProductSearch = useDebounced(productSearch, 250);

  // A picker rather than a free-text product filter: the ledger is filtered by
  // productId, so the name has to be resolved to one.
  const productOptions = useQuery({
    enabled: !lockedProductId,
    queryKey: ['products', 'ledgerPicker', debouncedProductSearch],
    queryFn: () =>
      api.products.list({
        search: debouncedProductSearch || undefined,
        lowStockOnly: false,
        includeInactive: true,
        page: 0,
        pageSize: 50,
      }),
  });

  const query = useMemo(
    () => ({
      productId: productId || undefined,
      type: type || undefined,
      from: from || undefined,
      to: to || undefined,
      limit: pageSize,
      offset: page * pageSize,
    }),
    [productId, type, from, to, page, pageSize],
  );

  const history = useQuery({
    queryKey: ['inventory', 'history', query],
    queryFn: () => api.inventory.history(query),
    placeholderData: (previous) => previous,
  });

  const rows = history.data?.rows ?? [];

  return (
    <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        spacing={2}
        sx={{ p: 2, alignItems: { lg: 'center' } }}
      >
        {!lockedProductId && (
        <TextField
          select
          label="Product"
          value={productId}
          onChange={(e) => {
            setProductId(e.target.value);
            setPage(0);
          }}
          sx={{ width: 260 }}
          slotProps={{
            select: {
              MenuProps: { slotProps: { paper: { sx: { maxHeight: 420 } } } },
            },
          }}
        >
          <MenuItem value="">
            <em>Every product</em>
          </MenuItem>
          {/* Typing in the box filters the list without leaving the dropdown. */}
          <Box sx={{ px: 1.5, py: 1 }}>
            <TextField
              size="small"
              fullWidth
              placeholder="Filter products…"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </Box>
          {(productOptions.data?.rows ?? []).map((product) => (
            <MenuItem key={product.id} value={product.id}>
              {product.name}
            </MenuItem>
          ))}
        </TextField>
        )}

        <TextField
          select
          label="Movement"
          value={type}
          onChange={(e) => {
            setType(e.target.value as InventoryTransactionType | '');
            setPage(0);
          }}
          sx={{ width: 210 }}
        >
          <MenuItem value="">
            <em>Every movement</em>
          </MenuItem>
          {INVENTORY_TRANSACTION_TYPES.map((option) => (
            <MenuItem key={option} value={option}>
              {INVENTORY_TRANSACTION_LABELS[option]}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          label="From"
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(0);
          }}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ width: 190 }}
        />
        <TextField
          label="To"
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(0);
          }}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ width: 190 }}
        />

        <Box sx={{ flexGrow: 1 }} />

        {(pickedProductId || type || from || to) && (
          <Button
            size="small"
            color="inherit"
            onClick={() => {
              setProductId('');
              setType('');
              setFrom('');
              setTo('');
              setPage(0);
            }}
          >
            Clear filters
          </Button>
        )}
      </Stack>

      <Divider />

      {history.isError && (
        <Alert severity="error" sx={{ m: 2 }}>
          {history.error instanceof PosApiError
            ? history.error.message
            : 'Unable to load the movement history.'}
        </Alert>
      )}

      <TableContainer sx={{ maxHeight: 560, opacity: history.isFetching ? 0.7 : 1 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>When</TableCell>
              <TableCell>Product</TableCell>
              <TableCell>Movement</TableCell>
              <TableCell align="right">Change</TableCell>
              <TableCell align="right">Before</TableCell>
              <TableCell align="right">After</TableCell>
              <TableCell align="right">Cost each</TableCell>
              <TableCell>Reason</TableCell>
              <TableCell>By</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((movement) => {
              const incoming = movement.quantity > 0;
              return (
                <TableRow key={movement.id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {formatInstant(movement.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{movement.productName}</Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontFamily: 'monospace' }}
                    >
                      {movement.sku}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={
                        INVENTORY_TRANSACTION_LABELS[
                          movement.transactionType as InventoryTransactionType
                        ] ?? movement.transactionType
                      }
                    />
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 700,
                      color: incoming ? 'success.dark' : 'error.main',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <Stack
                      direction="row"
                      spacing={0.25}
                      sx={{ alignItems: 'center', justifyContent: 'flex-end' }}
                    >
                      {incoming ? (
                        <NorthEastIcon sx={{ fontSize: 14 }} />
                      ) : (
                        <SouthWestIcon sx={{ fontSize: 14 }} />
                      )}
                      <span>
                        {incoming ? '+' : ''}
                        {movement.quantity}
                      </span>
                    </Stack>
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}
                  >
                    {movement.previousStock}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {movement.newStock}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {movement.unitCost > 0 ? money(movement.unitCost) : '—'}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 300 }}>
                    <Typography variant="body2">{movement.reason}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {movement.createdByName ?? '—'}
                    </Typography>
                  </TableCell>
                </TableRow>
              );
            })}

            {rows.length === 0 && !history.isLoading && (
              <TableRow>
                <TableCell colSpan={9}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    No stock movements match these filters.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePagination
        component="div"
        count={history.data?.total ?? 0}
        page={page}
        onPageChange={(_e, next) => setPage(next)}
        rowsPerPage={pageSize}
        onRowsPerPageChange={(e) => {
          setPageSize(Number(e.target.value));
          setPage(0);
        }}
        // The channel caps a page at 500 rows.
        rowsPerPageOptions={[50, 100, 250]}
      />
    </Paper>
  );
}

// -----------------------------------------------------------------------------
// Low stock
// -----------------------------------------------------------------------------

/** What to reorder, worst first (spec §5, §67). */
export function LowStock({ items, loading }: { items: LowStockItem[]; loading: boolean }) {
  const { data: settings } = useSettings();
  const threshold = settings?.lowStockThreshold ?? 5;

  return (
    <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ px: 2, pt: 2, pb: 1 }}>
        <Typography variant="subtitle1">Reorder list</Typography>
        <Typography variant="caption" color="text.secondary">
          A product’s own minimum applies where it has one; otherwise the shop default of{' '}
          {threshold}. Furthest below its minimum first.
        </Typography>
      </Box>
      <Divider />

      {items.length === 0 ? (
        <Alert severity="success" sx={{ m: 2 }}>
          {loading ? 'Checking stock levels…' : 'Nothing needs reordering — every product is above its minimum.'}
        </Alert>
      ) : (
        <TableContainer sx={{ maxHeight: 560 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>SKU</TableCell>
                <TableCell>Product</TableCell>
                <TableCell>Category</TableCell>
                <TableCell align="right">In stock</TableCell>
                <TableCell align="right">Minimum</TableCell>
                <TableCell align="right">Short by</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item) => {
                const minimum = item.minimumStock > 0 ? item.minimumStock : threshold;
                const short = Math.max(0, minimum - item.stockQuantity);
                return (
                  <TableRow key={item.id} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12.5 }}>
                      {item.sku}
                    </TableCell>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {item.categoryName ?? '—'}
                      </Typography>
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 700,
                        color: item.stockQuantity <= 0 ? 'error.main' : 'warning.dark',
                      }}
                    >
                      {item.stockQuantity}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {minimum}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {short > 0 ? short : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
}
