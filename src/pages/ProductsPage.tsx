import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Switch,
  FormControlLabel,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useMoneyFormatter } from '../hooks/useSettings';
import { useDebounced } from '../hooks/useDebounced';
import ProductDialog from '../components/ProductDialog';
import StockDialog from '../components/StockDialog';
import SerialsDialog from '../components/SerialsDialog';
import ProductImportDialog from '../components/ProductImportDialog';
import ExportMenu from '../components/ExportMenu';
import { PosApiError } from '@shared/errors';
import type { Product } from '@shared/api';

/** Product management (spec §39). */
export default function ProductsPage() {
  const { can } = useAuth();
  const money = useMoneyFormatter();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const [stockFor, setStockFor] = useState<Product | null>(null);
  const [serialsFor, setSerialsFor] = useState<Product | null>(null);
  const [importing, setImporting] = useState(false);

  // Debounced so typing a barcode does not fire a query per keystroke (spec §78).
  const debouncedSearch = useDebounced(search, 250);

  const query = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      categoryId: categoryId || undefined,
      brandId: brandId || undefined,
      lowStockOnly,
      includeInactive,
      page,
      pageSize,
    }),
    [debouncedSearch, categoryId, brandId, lowStockOnly, includeInactive, page, pageSize],
  );

  const products = useQuery({
    queryKey: ['products', query],
    queryFn: () => api.products.list(query),
  });

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.categories.list({ includeInactive: false }),
  });
  const brands = useQuery({
    queryKey: ['brands'],
    queryFn: () => api.brands.list({ includeInactive: false }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.products.delete({ id }),
    onSuccess: (result) => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      if (result.deactivated) {
        setError(
          'That product has trading history, so it was deactivated rather than deleted. Its past sales are untouched.',
        );
      }
    },
    onError: (err) =>
      setError(err instanceof PosApiError ? err.message : 'Unable to remove that product.'),
  });

  const rows = products.data?.rows ?? [];

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          Products
        </Typography>
        {/* Exports the whole filtered set, not the page on screen (spec §56). */}
        <ExportMenu target={{ dataset: 'PRODUCT_LIST', query }} />
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
      {products.isError && (
        <Alert severity="error">
          {products.error instanceof PosApiError
            ? products.error.message
            : 'Unable to load products.'}
        </Alert>
      )}

      <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
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
            sx={{ maxWidth: 380 }}
          />
          <TextField
            select
            label="Category"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setPage(0);
            }}
            sx={{ maxWidth: 200 }}
          >
            <MenuItem value="">All categories</MenuItem>
            {(categories.data ?? []).map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Brand"
            value={brandId}
            onChange={(e) => {
              setBrandId(e.target.value);
              setPage(0);
            }}
            sx={{ maxWidth: 200 }}
          >
            <MenuItem value="">All brands</MenuItem>
            {(brands.data ?? []).map((b) => (
              <MenuItem key={b.id} value={b.id}>
                {b.name}
              </MenuItem>
            ))}
          </TextField>
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

      <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
        <TableContainer>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>SKU</TableCell>
                <TableCell>Barcode</TableCell>
                <TableCell>Product</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Brand</TableCell>
                <TableCell align="right">Purchase</TableCell>
                <TableCell align="right">Selling</TableCell>
                <TableCell align="right">Stock</TableCell>
                <TableCell align="right">Min</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {products.isLoading && (
                <TableRow>
                  <TableCell colSpan={11} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    Loading…
                  </TableCell>
                </TableRow>
              )}

              {!products.isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                    {search || categoryId || brandId || lowStockOnly
                      ? 'No products match these filters.'
                      : 'No products yet. Use “Add Product” to create the first one.'}
                  </TableCell>
                </TableRow>
              )}

              {rows.map((product) => {
                const threshold = product.minimumStock;
                const isLow = threshold > 0 && product.stockQuantity <= threshold;
                const isOut = product.stockQuantity <= 0;

                return (
                  <TableRow key={product.id} hover>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{product.sku}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                      {product.barcode ?? '—'}
                    </TableCell>
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
                        fontWeight: isLow || isOut ? 700 : 400,
                        color: isOut ? 'error.main' : isLow ? 'warning.main' : 'inherit',
                      }}
                    >
                      {product.stockQuantity}
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'text.secondary' }}>
                      {product.minimumStock || '—'}
                    </TableCell>
                    <TableCell>
                      {product.isActive === 0 ? (
                        <Chip size="small" label="Inactive" />
                      ) : isOut ? (
                        <Chip size="small" color="error" label="Out of stock" />
                      ) : isLow ? (
                        <Chip size="small" color="warning" label="Low" />
                      ) : (
                        <Chip size="small" color="success" variant="outlined" label="Active" />
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
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
                        {can('products.manage') && (
                          <Tooltip title="Delete or deactivate">
                            <IconButton
                              size="small"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Remove "${product.name}"?\n\nIf it has any trading history it will be deactivated instead, so past sales and reports stay intact.`,
                                  )
                                ) {
                                  remove.mutate(product.id);
                                }
                              }}
                            >
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
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

      {editing !== undefined && (
        <ProductDialog
          product={editing}
          categories={categories.data ?? []}
          brands={brands.data ?? []}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void queryClient.invalidateQueries({ queryKey: ['products'] });
          }}
        />
      )}

      {stockFor && (
        <StockDialog
          product={stockFor}
          onClose={() => setStockFor(null)}
          onSaved={() => {
            setStockFor(null);
            void queryClient.invalidateQueries({ queryKey: ['products'] });
          }}
        />
      )}

      {serialsFor && (
        <SerialsDialog
          product={serialsFor}
          onClose={() => setSerialsFor(null)}
          onChanged={() => void queryClient.invalidateQueries({ queryKey: ['products'] })}
        />
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
          void queryClient.invalidateQueries({ queryKey: ['products'] });
          void queryClient.invalidateQueries({ queryKey: ['categories'] });
          void queryClient.invalidateQueries({ queryKey: ['brands'] });
        }}
      />
    </Stack>
  );
}
