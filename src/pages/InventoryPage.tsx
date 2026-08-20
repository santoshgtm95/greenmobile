import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import TuneIcon from '@mui/icons-material/Tune';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import NorthEastIcon from '@mui/icons-material/NorthEast';
import SouthWestIcon from '@mui/icons-material/SouthWest';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useMoneyFormatter, useSettings } from '../hooks/useSettings';
import { useDebounced } from '../hooks/useDebounced';
import StockDialog from '../components/StockDialog';
import SerialsDialog from '../components/SerialsDialog';
import ExportMenu from '../components/ExportMenu';
import { PosApiError } from '@shared/errors';
import {
  INVENTORY_TRANSACTION_LABELS,
  INVENTORY_TRANSACTION_TYPES,
  type InventoryTransactionType,
} from '@shared/domain';
import { formatInstant } from '@shared/datetime';
import type { LowStockItem, Product } from '@shared/api';

/**
 * Inventory (spec §5: stock, stock adjustment, inventory history, low stock).
 *
 * The Products screen is about what the shop sells — names, SKUs, prices. This
 * screen is about what is actually on the shelf, and it is where the movement
 * ledger lives: every change to a stock level, what caused it, who did it and
 * what the level was before and after (spec §66). Nothing in the application can
 * move stock without leaving a row here, which is what makes a discrepancy
 * something you can investigate rather than argue about.
 */
const TABS = [
  { value: 'levels', label: 'Stock levels' },
  { value: 'movements', label: 'Movement history' },
  { value: 'low', label: 'Low stock' },
] as const;

type TabValue = (typeof TABS)[number]['value'];

export default function InventoryPage() {
  // The tab is in the route rather than in component state, so /inventory/movements
  // is a real address — reachable from a link, from the back button, and from the
  // screenshot harness.
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const active: TabValue = TABS.some((entry) => entry.value === tab)
    ? (tab as TabValue)
    : 'levels';

  const summary = useQuery({
    queryKey: ['inventory', 'summary'],
    queryFn: () => api.inventory.summary(),
  });

  const lowStock = useQuery({
    queryKey: ['inventory', 'lowStock'],
    queryFn: () => api.inventory.lowStock(),
  });

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          Inventory
        </Typography>
        {/* The stock-on-hand sheet, which is what a stock-take is done against. */}
        <ExportMenu target={{ dataset: 'INVENTORY_LIST' }} label="Export stock sheet" />
      </Stack>

      {summary.isError && (
        <Alert severity="error">
          {summary.error instanceof PosApiError
            ? summary.error.message
            : 'Unable to read the stock figures.'}
        </Alert>
      )}

      <StockFigures data={summary.data} lowStock={lowStock.data} />

      <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Tabs value={active} onChange={(_e, next) => navigate(`/inventory/${next as TabValue}`)}>
          {TABS.map((entry) => (
            <Tab
              key={entry.value}
              value={entry.value}
              label={
                entry.value === 'low' && (lowStock.data?.length ?? 0) > 0
                  ? `${entry.label} (${lowStock.data?.length})`
                  : entry.label
              }
            />
          ))}
        </Tabs>
        <Divider />
      </Paper>

      {active === 'levels' && <StockLevels />}
      {active === 'movements' && <MovementLedger />}
      {active === 'low' && <LowStock items={lowStock.data ?? []} loading={lowStock.isLoading} />}
    </Stack>
  );
}

// -----------------------------------------------------------------------------
// Headline figures
// -----------------------------------------------------------------------------

function StockFigures({
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
// Stock levels
// -----------------------------------------------------------------------------

/** What is on the shelf, and what it is worth. Quantities, not prices. */
function StockLevels() {
  const { can } = useAuth();
  const money = useMoneyFormatter();
  const { data: settings } = useSettings();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [serialsFor, setSerialsFor] = useState<Product | null>(null);

  const debouncedSearch = useDebounced(search, 250);

  const query = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      lowStockOnly,
      includeInactive: false,
      page,
      pageSize,
    }),
    [debouncedSearch, lowStockOnly, page, pageSize],
  );

  const products = useQuery({
    queryKey: ['products', query],
    queryFn: () => api.products.list(query),
  });

  /** Refetch the figures too — an adjustment changes them. */
  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['products'] });
    void queryClient.invalidateQueries({ queryKey: ['inventory'] });
  };

  const threshold = settings?.lowStockThreshold ?? 5;
  const rows = products.data?.rows ?? [];

  return (
    <>
      <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ p: 2 }}>
          <TextField
            placeholder="Search name, SKU, barcode or IMEI"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ flexGrow: 1 }}
          />
          <TextField
            select
            label="Show"
            value={lowStockOnly ? 'LOW' : 'ALL'}
            onChange={(e) => {
              setLowStockOnly(e.target.value === 'LOW');
              setPage(0);
            }}
            sx={{ width: 200 }}
          >
            <MenuItem value="ALL">All products</MenuItem>
            <MenuItem value="LOW">At or below minimum</MenuItem>
          </TextField>
        </Stack>

        <Divider />

        {products.isError && (
          <Alert severity="error" sx={{ m: 2 }}>
            {products.error instanceof PosApiError
              ? products.error.message
              : 'Unable to load stock levels.'}
          </Alert>
        )}

        <TableContainer sx={{ maxHeight: 560 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>SKU</TableCell>
                <TableCell>Product</TableCell>
                <TableCell>Category</TableCell>
                <TableCell align="right">In stock</TableCell>
                <TableCell align="right">Minimum</TableCell>
                <TableCell align="right">Cost each</TableCell>
                <TableCell align="right">Stock value</TableCell>
                <TableCell>State</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((product) => {
                const reorderPoint = product.minimumStock > 0 ? product.minimumStock : threshold;
                const state =
                  product.stockQuantity <= 0
                    ? 'out'
                    : product.stockQuantity <= reorderPoint
                      ? 'low'
                      : 'ok';

                return (
                  <TableRow key={product.id} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12.5 }}>
                      {product.sku}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <span>{product.name}</span>
                        {product.isSerialized === 1 && (
                          <Tooltip title={`${product.availableSerials} available by IMEI`}>
                            <Chip
                              size="small"
                              variant="outlined"
                              icon={<SmartphoneIcon sx={{ fontSize: 14 }} />}
                              label={product.availableSerials}
                            />
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {product.categoryName ?? '—'}
                      </Typography>
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 700,
                        color:
                          state === 'out' ? 'error.main' : state === 'low' ? 'warning.dark' : undefined,
                      }}
                    >
                      {product.stockQuantity}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      <Tooltip
                        title={
                          product.minimumStock > 0
                            ? 'This product’s own minimum'
                            : `Shop default (${threshold})`
                        }
                      >
                        <span style={{ opacity: product.minimumStock > 0 ? 1 : 0.55 }}>
                          {reorderPoint}
                        </span>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {money(product.purchasePrice)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {money(Math.max(0, product.stockQuantity) * product.purchasePrice)}
                    </TableCell>
                    <TableCell>
                      {state === 'out' ? (
                        <Chip size="small" color="error" label="Out of stock" />
                      ) : state === 'low' ? (
                        <Chip size="small" color="warning" label="Low" />
                      ) : (
                        <Chip size="small" variant="outlined" label="OK" />
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {can('inventory.adjust') && (
                        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                          {product.isSerialized === 1 ? (
                            <Tooltip title="IMEIs and serial numbers">
                              <IconButton size="small" onClick={() => setSerialsFor(product)}>
                                <SmartphoneIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          ) : (
                            <Tooltip title="Adjust stock">
                              <IconButton size="small" onClick={() => setAdjusting(product)}>
                                <TuneIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Stack>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}

              {rows.length === 0 && !products.isLoading && (
                <TableRow>
                  <TableCell colSpan={9}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      {lowStockOnly
                        ? 'Every product is above its minimum.'
                        : 'No products match this search.'}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          component="div"
          count={products.data?.total ?? 0}
          page={page}
          onPageChange={(_e, next) => setPage(next)}
          rowsPerPage={pageSize}
          onRowsPerPageChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(0);
          }}
          rowsPerPageOptions={[25, 50, 100]}
        />
      </Paper>

      {adjusting && (
        <StockDialog
          product={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={() => {
            setAdjusting(null);
            refreshAll();
          }}
        />
      )}

      {serialsFor && (
        <SerialsDialog
          product={serialsFor}
          onClose={() => setSerialsFor(null)}
          onChanged={refreshAll}
        />
      )}
    </>
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
function MovementLedger() {
  const money = useMoneyFormatter();

  const [productSearch, setProductSearch] = useState('');
  const [productId, setProductId] = useState('');
  const [type, setType] = useState<InventoryTransactionType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  const debouncedProductSearch = useDebounced(productSearch, 250);

  // A picker rather than a free-text product filter: the ledger is filtered by
  // productId, so the name has to be resolved to one.
  const productOptions = useQuery({
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

        {(productId || type || from || to) && (
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
function LowStock({ items, loading }: { items: LowStockItem[]; loading: boolean }) {
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
