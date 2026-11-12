import { startTransition, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Link,
  Paper,
  Stack,
  Switch,
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
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import TuneIcon from '@mui/icons-material/Tune';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import QrCodeIcon from '@mui/icons-material/QrCode';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useMoneyFormatter, useSettings } from '../hooks/useSettings';
import { useDebounced } from '../hooks/useDebounced';
import ProductDialog from '../components/ProductDialog';
import StockDialog from '../components/StockDialog';
import SerialsDialog from '../components/SerialsDialog';
import ProductImportDialog from '../components/ProductImportDialog';
import BarcodePrintDialog from '../components/BarcodePrintDialog';
import ExportMenu from '../components/ExportMenu';
import { historyTableSx } from '../components/historyTableSx';
import CategoryTree, { type StockSelection } from './stocks/CategoryTree';
import ProductDetail from './stocks/ProductDetail';
import { LowStock, MovementLedger, StockFigures } from './stocks/InventoryParts';
import { StockStateChip, reorderPointOf } from './stocks/stockState';
import { PosApiError } from '@shared/errors';
import type { Product } from '@shared/api';

/**
 * Stocks — products and inventory in one place (spec §5, §39, §66).
 *
 * Products tab: the list on the left, a Category → Brand → Product tree on the
 * right that decides what the list shows. The tab is in the route, so
 * /stocks/movements is a real address.
 */
const TABS = [
  { value: 'products', label: 'Products' },
  { value: 'movements', label: 'Movement history' },
  { value: 'low', label: 'Low stock' },
] as const;

type TabValue = (typeof TABS)[number]['value'];

export default function StocksPage() {
  const { can } = useAuth();
  const money = useMoneyFormatter();
  const { data: settings } = useSettings();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const active: TabValue = TABS.some((entry) => entry.value === tab) ? (tab as TabValue) : 'products';

  // Paint the page first; the product table is rendered in a transition just after,
  // so the sidebar click opens Stocks at once instead of waiting for the rows.
  const [ready, setReady] = useState(false);
  useEffect(() => startTransition(() => setReady(true)), []);

  const [selection, setSelection] = useState<StockSelection>({});
  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const [stockFor, setStockFor] = useState<Product | null>(null);
  const [serialsFor, setSerialsFor] = useState<Product | null>(null);
  const [barcodeFor, setBarcodeFor] = useState<Product | null>(null);
  const [importing, setImporting] = useState(false);

  // Debounced so typing a barcode does not fire a query per keystroke (spec §78).
  const debouncedSearch = useDebounced(search, 250);

  const query = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      categoryId: selection.categoryId,
      brandId: selection.brandId,
      lowStockOnly,
      includeInactive,
      page,
      pageSize,
    }),
    [debouncedSearch, selection.categoryId, selection.brandId, lowStockOnly, includeInactive, page, pageSize],
  );

  const products = useQuery({
    queryKey: ['products', query],
    queryFn: () => api.products.list(query),
    // Keep the rows on screen while a new search or page loads.
    placeholderData: (previous) => previous,
  });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.categories.list({ includeInactive: false }),
  });
  const brands = useQuery({
    queryKey: ['brands'],
    queryFn: () => api.brands.list({ includeInactive: false }),
  });
  const summary = useQuery({
    queryKey: ['inventory', 'summary'],
    queryFn: () => api.inventory.summary(),
  });
  const lowStock = useQuery({
    queryKey: ['inventory', 'lowStock'],
    queryFn: () => api.inventory.lowStock(),
  });

  /** Stock figures and the ledger change with the products, so refetch both. */
  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['products'] });
    void queryClient.invalidateQueries({ queryKey: ['inventory'] });
  };

  const select = (next: StockSelection) => {
    setSelection(next);
    setPage(0);
  };

  const remove = useMutation({
    mutationFn: (product: Product) => api.products.delete({ id: product.id }),
    onSuccess: (result, product) => {
      setError(null);
      refreshAll();
      if (result.deactivated) {
        setError(
          'That product has trading history, so it was deactivated rather than deleted. Its past sales are untouched.',
        );
      } else if (selection.productId === product.id) {
        select({ ...selection, productId: undefined });
      }
    },
    onError: (err) => setError(err instanceof PosApiError ? err.message : 'Unable to remove that product.'),
  });

  const threshold = settings?.lowStockThreshold ?? 5;
  const rows = products.data?.rows ?? [];

  /** Shared by the list rows and the product detail. */
  const actions = (product: Product) => (
    <>
      {can('products.manage') && (
        <Tooltip title="Edit">
          <IconButton size="small" onClick={() => setEditing(product)}>
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {can('inventory.adjust') &&
        (product.isSerialized === 1 ? (
          <Tooltip title="IMEI / serial numbers">
            <IconButton size="small" onClick={() => setSerialsFor(product)}>
              <SmartphoneIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : (
          <Tooltip title="Adjust stock">
            <IconButton size="small" onClick={() => setStockFor(product)}>
              <TuneIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ))}
      {can('products.delete') && (
        <Tooltip title="Delete or deactivate">
          <IconButton
            size="small"
            onClick={() => {
              if (
                window.confirm(
                  `Remove "${product.name}"?\n\nIf it has any trading history it will be deactivated instead, so past sales and reports stay intact.`,
                )
              ) {
                remove.mutate(product);
              }
            }}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title="View & print barcode">
        <IconButton size="small" onClick={() => setBarcodeFor(product)}>
          <QrCodeIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </>
  );

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          Stocks
        </Typography>
        {/* Exports the whole filtered set, not the page on screen (spec §56). */}
        <ExportMenu target={{ dataset: 'PRODUCT_LIST', query }} label="Export products" />
        {/* The stock-on-hand sheet, which is what a stock-take is done against. */}
        <ExportMenu target={{ dataset: 'INVENTORY_LIST' }} label="Export stock sheet" />
        {can('products.import') && (
          <Button startIcon={<UploadFileIcon />} onClick={() => setImporting(true)}>
            Import Excel
          </Button>
        )}
        {can('products.manage') && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing(null)}>
            Add Product
          </Button>
        )}
      </Stack>

      {error && (
        <Alert severity="info" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {summary.isError && (
        <Alert severity="error">
          {summary.error instanceof PosApiError ? summary.error.message : 'Unable to read the stock figures.'}
        </Alert>
      )}

      <StockFigures data={summary.data} lowStock={lowStock.data} />

      <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Tabs value={active} onChange={(_e, next) => navigate(`/stocks/${next as TabValue}`)}>
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
      </Paper>

      {active === 'movements' && <MovementLedger />}
      {active === 'low' && <LowStock items={lowStock.data ?? []} loading={lowStock.isLoading} />}

      {active === 'products' && (
        // Tree on the left of the list; on a narrow window it goes above the list instead.
        <Stack direction={{ xs: 'column-reverse', lg: 'row-reverse' }} spacing={2} sx={{ alignItems: { lg: 'flex-start' } }}>
          <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
            <Breadcrumbs>
              <Link component="button" underline="hover" onClick={() => select({})}>
                All products
              </Link>
              {selection.categoryName && (
                <Link
                  component="button"
                  underline="hover"
                  onClick={() => select({ categoryId: selection.categoryId, categoryName: selection.categoryName })}
                >
                  {selection.categoryName}
                </Link>
              )}
              {selection.brandName && (
                <Link component="button" underline="hover" onClick={() => select({ ...selection, productId: undefined })}>
                  {selection.brandName}
                </Link>
              )}
            </Breadcrumbs>

            {selection.productId ? (
              <ProductDetail productId={selection.productId} actions={actions} />
            ) : (
              <>
                <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' } }}>
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
                      sx={{ maxWidth: { md: 380 } }}
                    />
                    <FormControlLabel
                      control={
                        <Switch
                          checked={lowStockOnly}
                          onChange={(e) => {
                            setLowStockOnly(e.target.checked);
                            setPage(0);
                          }}
                        />
                      }
                      label="Low stock"
                    />
                    <FormControlLabel
                      control={
                        <Switch
                          checked={includeInactive}
                          onChange={(e) => {
                            setIncludeInactive(e.target.checked);
                            setPage(0);
                          }}
                        />
                      }
                      label="Show inactive"
                    />
                  </Stack>
                </Paper>

                {products.isError && (
                  <Alert severity="error">
                    {products.error instanceof PosApiError ? products.error.message : 'Unable to load products.'}
                  </Alert>
                )}

                {!ready || products.isLoading ? (
                  <Paper sx={{ border: 1, borderColor: 'divider', py: 8, display: 'grid', placeItems: 'center', gap: 1.5 }}>
                    <CircularProgress size={30} />
                    <Typography variant="body2" color="text.secondary">
                      Loading products…
                    </Typography>
                  </Paper>
                ) : (
                <Paper sx={historyTableSx}>
                  {products.isFetching && <LinearProgress sx={{ height: 2 }} />}
                  <TableContainer sx={{ maxHeight: 620 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>SKU</TableCell>
                          <TableCell>Product</TableCell>
                          <TableCell>Category</TableCell>
                          <TableCell>Brand</TableCell>
                          <TableCell align="right">Purchase</TableCell>
                          <TableCell align="right">Selling</TableCell>
                          <TableCell align="right">Stock</TableCell>
                          <TableCell align="right">Min</TableCell>
                          <TableCell align="right">Stock value</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell align="right">Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>

                        {!products.isLoading && rows.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={11} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                              {search || selection.categoryId || lowStockOnly
                                ? 'No products match these filters.'
                                : 'No products yet. Use “Add Product” to create the first one.'}
                            </TableCell>
                          </TableRow>
                        )}

                        {rows.map((product) => {
                          const reorderPoint = reorderPointOf(product, threshold);
                          const isOut = product.stockQuantity <= 0;
                          const isLow = !isOut && product.stockQuantity <= reorderPoint;

                          return (
                            <TableRow
                              key={product.id}
                              hover
                              onClick={() => select({ ...selection, productId: product.id })}
                              sx={{ cursor: 'pointer' }}
                            >
                              <TableCell sx={{ fontFamily: 'monospace', fontSize: 12.5 }}>{product.sku}</TableCell>
                              <TableCell>
                                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                  <span>{product.name}</span>
                                  {product.isSerialized === 1 && (
                                    <Tooltip title={`${product.availableSerials} IMEI/serial available`}>
                                      <Chip
                                        size="small"
                                        icon={<SmartphoneIcon sx={{ fontSize: 14 }} />}
                                        label={product.availableSerials}
                                        variant="outlined"
                                      />
                                    </Tooltip>
                                  )}
                                </Stack>
                                {product.barcode && (
                                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                                    {product.barcode}
                                  </Typography>
                                )}
                              </TableCell>
                              <TableCell>{product.categoryName ?? '—'}</TableCell>
                              <TableCell>{product.brandName ?? '—'}</TableCell>
                              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                {money(product.purchasePrice)}
                              </TableCell>
                              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                {money(product.sellingPrice)}
                              </TableCell>
                              <TableCell
                                align="right"
                                sx={{
                                  fontVariantNumeric: 'tabular-nums',
                                  fontWeight: 700,
                                  color: isOut ? 'error.main' : isLow ? 'warning.dark' : 'inherit',
                                }}
                              >
                                {product.stockQuantity}
                              </TableCell>
                              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                <Tooltip
                                  title={product.minimumStock > 0 ? 'This product’s own minimum' : `Shop default (${threshold})`}
                                >
                                  <span style={{ opacity: product.minimumStock > 0 ? 1 : 0.55 }}>{reorderPoint}</span>
                                </Tooltip>
                              </TableCell>
                              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                {money(Math.max(0, product.stockQuantity) * product.purchasePrice)}
                              </TableCell>
                              <TableCell>
                                <StockStateChip product={product} reorderPoint={reorderPoint} />
                              </TableCell>
                              {/* Buttons act on the row; they must not also open the product. */}
                              <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                                <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                                  {actions(product)}
                                </Stack>
                              </TableCell>
                            </TableRow>
                          );
                        })}
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
                )}
              </>
            )}
          </Stack>

          <Box sx={{ width: { lg: 320 }, flexShrink: 0, position: { lg: 'sticky' }, top: { lg: 88 } }}>
            <CategoryTree
              categories={categories.data ?? []}
              includeInactive={includeInactive}
              selection={selection}
              onSelect={select}
            />
          </Box>
        </Stack>
      )}

      {editing !== undefined && (
        <ProductDialog
          product={editing}
          categories={categories.data ?? []}
          brands={brands.data ?? []}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            refreshAll();
            void queryClient.invalidateQueries({ queryKey: ['categories'] });
          }}
        />
      )}

      {stockFor && (
        <StockDialog
          product={stockFor}
          onClose={() => setStockFor(null)}
          onSaved={() => {
            setStockFor(null);
            refreshAll();
          }}
        />
      )}

      {serialsFor && (
        <SerialsDialog product={serialsFor} onClose={() => setSerialsFor(null)} onChanged={refreshAll} />
      )}

      <ProductImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        onImported={(result) => {
          setImporting(false);
          setError(
            `Import finished — ${result.created} product${result.created === 1 ? '' : 's'} created, ` +
              `${result.updated} updated` +
              (result.skipped ? `, ${result.skipped} skipped` : '') +
              (result.stockAdded ? `, ${result.stockAdded} units of stock added` : '') +
              '.',
          );
          // Categories and brands may have been created along the way.
          refreshAll();
          void queryClient.invalidateQueries({ queryKey: ['categories'] });
          void queryClient.invalidateQueries({ queryKey: ['brands'] });
        }}
      />

      {barcodeFor && <BarcodePrintDialog product={barcodeFor} onClose={() => setBarcodeFor(null)} />}
    </Stack>
  );
}
