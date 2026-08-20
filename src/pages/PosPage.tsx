import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import PersonIcon from '@mui/icons-material/Person';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import PrintIcon from '@mui/icons-material/Print';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useDebounced } from '../hooks/useDebounced';
import { useMoneyFormatter } from '../hooks/useSettings';
import { PosApiError } from '@shared/errors';
import type { Product, ProductSerial, SaleDetail, SaleQuote } from '@shared/api';
import SerialPickerDialog from '../components/SerialPickerDialog';
import CustomerPickerDialog from '../components/CustomerPickerDialog';
import PaymentDialog from '../components/PaymentDialog';
import MoneyField from '../components/MoneyField';

export interface CartLine {
  key: string;
  product: Product;
  quantity: number;
  serial: ProductSerial | null;
}

/**
 * The till (spec §32).
 *
 * Totals shown here are not computed in the browser: every change asks the main
 * process to re-price the cart, and the same function commits the sale. What the
 * cashier reads and what is charged therefore cannot disagree (spec §68).
 */
export default function PosPage() {
  const money = useMoneyFormatter();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [customer, setCustomer] = useState<{ id: string; name: string; phone: string | null } | null>(null);
  const [serialPickerFor, setSerialPickerFor] = useState<Product | null>(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<SaleDetail | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const debouncedSearch = useDebounced(search, 200);

  const results = useQuery({
    queryKey: ['pos-search', debouncedSearch],
    queryFn: () =>
      api.products.list({
        search: debouncedSearch || undefined,
        categoryId: undefined,
        brandId: undefined,
        lowStockOnly: false,
        includeInactive: false,
        page: 0,
        pageSize: 30,
      }),
  });

  // The authoritative quote. Recomputed by the main process on every change.
  const quoteInput = useMemo(
    () => ({
      customerId: customer?.id,
      items: cart.map((line) => ({
        productId: line.product.id,
        quantity: line.quantity,
        productSerialId: line.serial?.id,
      })),
      discountAmount: discount,
      payments: [],
      notes: undefined,
    }),
    [cart, discount, customer],
  );

  const quote = useQuery<SaleQuote | null>({
    queryKey: ['pos-quote', quoteInput],
    queryFn: () => (cart.length === 0 ? Promise.resolve(null) : api.sales.quote(quoteInput)),
    enabled: true,
  });

  const addProduct = useCallback(
    (product: Product, serial: ProductSerial | null = null) => {
      setError(null);

      if (product.isSerialized === 1 && !serial) {
        setSerialPickerFor(product);
        return;
      }

      setCart((current) => {
        // A serialized unit is unique; anything else stacks.
        if (!serial) {
          const existing = current.find((l) => l.product.id === product.id && !l.serial);
          if (existing) {
            if (existing.quantity + 1 > product.stockQuantity && product.stockQuantity >= 0) {
              setError(`Only ${product.stockQuantity} of ${product.name} in stock.`);
              return current;
            }
            return current.map((l) =>
              l === existing ? { ...l, quantity: l.quantity + 1 } : l,
            );
          }
          if (product.stockQuantity <= 0) {
            setError(`${product.name} is out of stock.`);
            return current;
          }
          return [...current, { key: product.id, product, quantity: 1, serial: null }];
        }

        if (current.some((l) => l.serial?.id === serial.id)) {
          setError('That unit is already in the cart.');
          return current;
        }
        return [...current, { key: serial.id, product, quantity: 1, serial }];
      });
    },
    [],
  );

  /** Barcode scanners type fast and finish with Enter. */
  const onSearchEnter = useCallback(async () => {
    const code = search.trim();
    if (!code) return;
    try {
      const serial = await api.serials.findByCode({ code });
      if (serial) {
        if (serial.status !== 'AVAILABLE') {
          setError(`That IMEI is not available (${serial.status.toLowerCase()}).`);
          return;
        }
        const product = await api.products.get({ id: serial.productId });
        addProduct(product, serial);
        setSearch('');
        return;
      }

      const product = await api.products.findByCode({ code });
      if (product) {
        addProduct(product);
        setSearch('');
        return;
      }

      // Not a code — leave the text so the list keeps showing name matches.
      if (results.data && results.data.rows.length === 1) {
        addProduct(results.data.rows[0]);
        setSearch('');
      } else if (results.data && results.data.rows.length === 0) {
        setError(`Product not found: "${code}"`);
      }
    } catch (err) {
      setError(err instanceof PosApiError ? err.message : 'Search failed.');
    }
  }, [search, addProduct, results.data]);

  /**
   * Prints the just-completed sale. Not silent: the shop may not have set a
   * default printer yet, and a document vanishing into the wrong queue is worse
   * than one extra dialog.
   */
  const printReceipt = async (saleId: string, format: 'RECEIPT' | 'A4' = 'RECEIPT') => {
    try {
      await api.print.sale({ saleId, format, silent: false });
    } catch (err) {
      setError(err instanceof PosApiError ? err.message : 'Unable to print receipt.');
    }
  };

  const setQuantity = (key: string, quantity: number) => {
    setCart((current) =>
      current
        .map((line) => (line.key === key ? { ...line, quantity } : line))
        .filter((line) => line.quantity > 0),
    );
  };

  const clearCart = () => {
    setCart([]);
    setDiscount(0);
    setCustomer(null);
  };

  const completeSale = useMutation({
    mutationFn: (payments: Array<{ amount: number; paymentMethod: string; referenceNumber?: string }>) =>
      api.sales.create({
        ...quoteInput,
        payments: payments as never,
      }),
    onSuccess: (sale) => {
      setPaymentOpen(false);
      setCompleted(sale);
      clearCart();
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['pos-search'] });
      searchRef.current?.focus();
    },
    onError: (err) => {
      setPaymentOpen(false);
      setError(err instanceof PosApiError ? err.message : 'Unable to complete sale.');
    },
  });

  // Keyboard shortcuts (spec §70).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (event.key === 'F3') {
        event.preventDefault();
        setCustomerPickerOpen(true);
      } else if (event.key === 'F8' || event.key === 'F9') {
        event.preventDefault();
        if (cart.length > 0) setPaymentOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cart.length]);

  const totals = quote.data;

  return (
    <Stack sx={{ height: 'calc(100vh - 128px)' }} spacing={2}>
      <TextField
        inputRef={searchRef}
        autoFocus
        placeholder="Search a product, or scan a barcode / IMEI  —  F2"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void onSearchEnter();
          }
        }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
            sx: { fontSize: 18, py: 0.5 },
          },
        }}
      />

      {error && (
        <Alert severity="warning" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack direction="row" spacing={2} sx={{ flexGrow: 1, minHeight: 0 }}>
        {/* Search results */}
        <Paper sx={{ flex: 1, border: '1px solid', borderColor: 'divider', overflow: 'auto' }}>
          <List dense disablePadding>
            {results.isLoading && (
              <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>Searching…</Box>
            )}
            {!results.isLoading && (results.data?.rows.length ?? 0) === 0 && (
              <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                {search ? `Nothing matches "${search}".` : 'Search or scan to begin.'}
              </Box>
            )}
            {(results.data?.rows ?? []).map((product) => {
              const out = product.stockQuantity <= 0;
              return (
                <ListItemButton
                  key={product.id}
                  onClick={() => addProduct(product)}
                  disabled={out && product.isSerialized === 0}
                  sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
                >
                  <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Typography noWrap sx={{ fontWeight: 600 }}>
                        {product.name}
                      </Typography>
                      {product.isSerialized === 1 && (
                        <Chip
                          size="small"
                          variant="outlined"
                          icon={<SmartphoneIcon sx={{ fontSize: 14 }} />}
                          label={product.availableSerials}
                        />
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {product.sku}
                      {product.brandName ? ` · ${product.brandName}` : ''} · stock{' '}
                      {product.stockQuantity}
                    </Typography>
                  </Stack>
                  <Typography sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', ml: 2 }}>
                    {money(product.sellingPrice)}
                  </Typography>
                </ListItemButton>
              );
            })}
          </List>
        </Paper>

        {/* Cart */}
        <Paper
          sx={{
            width: 520,
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="subtitle1" sx={{ flexGrow: 1, fontWeight: 700 }}>
                Cart
              </Typography>
              {cart.length > 0 && (
                <Button size="small" color="inherit" onClick={clearCart}>
                  Clear
                </Button>
              )}
            </Stack>
          </Box>

          <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
            {cart.length === 0 && (
              <Box sx={{ p: 5, textAlign: 'center', color: 'text.secondary' }}>
                <Typography variant="body2">The cart is empty.</Typography>
                <Typography variant="caption">Scan a barcode or pick a product.</Typography>
              </Box>
            )}

            {cart.map((line) => {
              const lineQuote = totals?.lines.find(
                (l) =>
                  l.productId === line.product.id &&
                  (l.productSerialId ?? null) === (line.serial?.id ?? null),
              );
              return (
                <Box
                  key={line.key}
                  sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}
                >
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                    <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Typography noWrap sx={{ fontWeight: 600 }}>
                        {line.product.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {line.serial
                          ? `IMEI ${line.serial.imei1 ?? line.serial.serialNumber}`
                          : `${money(line.product.sellingPrice)} each`}
                      </Typography>
                    </Stack>

                    {!line.serial ? (
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <IconButton
                          size="small"
                          onClick={() => setQuantity(line.key, line.quantity - 1)}
                        >
                          <RemoveIcon fontSize="small" />
                        </IconButton>
                        <Typography sx={{ minWidth: 28, textAlign: 'center', fontWeight: 700 }}>
                          {line.quantity}
                        </Typography>
                        <IconButton
                          size="small"
                          onClick={() => {
                            if (
                              line.quantity + 1 > line.product.stockQuantity &&
                              line.product.stockQuantity >= 0
                            ) {
                              setError(
                                `Only ${line.product.stockQuantity} of ${line.product.name} in stock.`,
                              );
                              return;
                            }
                            setQuantity(line.key, line.quantity + 1);
                          }}
                        >
                          <AddIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    ) : (
                      <Chip size="small" label="1" />
                    )}

                    <Typography
                      sx={{ minWidth: 96, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                    >
                      {money(lineQuote?.totalAmount ?? line.product.sellingPrice * line.quantity)}
                    </Typography>

                    <IconButton size="small" onClick={() => setQuantity(line.key, 0)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </Box>
              );
            })}
          </Box>

          <Divider />

          <Box sx={{ p: 2 }}>
            <Stack spacing={1}>
              <TotalRow label="Subtotal" value={money(totals?.subtotal ?? 0)} />

              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
                  Discount
                </Typography>
                <MoneyField
                  value={discount}
                  onChange={setDiscount}
                  size="small"
                  sx={{ maxWidth: 170 }}
                  disabled={cart.length === 0}
                />
              </Stack>

              <TotalRow label="Tax" value={money(totals?.taxAmount ?? 0)} />

              <Divider />

              <Stack direction="row" sx={{ alignItems: 'baseline' }}>
                <Typography variant="h6" sx={{ flexGrow: 1 }}>
                  GRAND TOTAL
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {money(totals?.grandTotal ?? 0)}
                </Typography>
              </Stack>
            </Stack>
          </Box>

          <Divider />

          <Box sx={{ p: 2, pt: 1.5 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
              <Tooltip title="Choose a customer — F3">
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<PersonIcon />}
                  onClick={() => setCustomerPickerOpen(true)}
                  sx={{ flexGrow: 1, justifyContent: 'flex-start' }}
                >
                  {customer ? customer.name : 'Walk-in Customer'}
                </Button>
              </Tooltip>
              {customer && (
                <Button size="small" color="inherit" onClick={() => setCustomer(null)}>
                  Clear
                </Button>
              )}
            </Stack>

            <Button
              fullWidth
              size="large"
              variant="contained"
              disabled={cart.length === 0 || quote.isFetching}
              onClick={() => setPaymentOpen(true)}
              sx={{ py: 1.5, fontSize: 17 }}
            >
              Complete Sale — F8
            </Button>
          </Box>
        </Paper>
      </Stack>

      {serialPickerFor && (
        <SerialPickerDialog
          product={serialPickerFor}
          excludeIds={cart.map((l) => l.serial?.id).filter(Boolean) as string[]}
          onClose={() => setSerialPickerFor(null)}
          onPick={(serial) => {
            addProduct(serialPickerFor, serial);
            setSerialPickerFor(null);
            setSearch('');
          }}
        />
      )}

      {customerPickerOpen && (
        <CustomerPickerDialog
          onClose={() => setCustomerPickerOpen(false)}
          onPick={(picked) => {
            setCustomer(picked);
            setCustomerPickerOpen(false);
          }}
        />
      )}

      {paymentOpen && totals && (
        <PaymentDialog
          grandTotal={totals.grandTotal}
          submitting={completeSale.isPending}
          onClose={() => setPaymentOpen(false)}
          onConfirm={(payments) => completeSale.mutate(payments)}
        />
      )}

      {/* Stays until dismissed: the cashier may still want to print the receipt. */}
      <Snackbar
        open={Boolean(completed)}
        onClose={() => setCompleted(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity="success"
          onClose={() => setCompleted(null)}
          sx={{ width: '100%' }}
          action={
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                color="inherit"
                startIcon={<PrintIcon fontSize="small" />}
                onClick={() => {
                  if (completed) void printReceipt(completed.sale.id);
                }}
              >
                Receipt
              </Button>
              <Button
                size="small"
                color="inherit"
                onClick={() => {
                  if (completed) void printReceipt(completed.sale.id, 'A4');
                }}
              >
                Invoice
              </Button>
            </Stack>
          }
        >
          Sale {completed?.sale.invoiceNumber} completed —{' '}
          {money(completed?.sale.grandTotal ?? 0)}
          {completed && completed.sale.changeAmount > 0
            ? `. Change ${money(completed.sale.changeAmount)}.`
            : '.'}
        </Alert>
      </Snackbar>
    </Stack>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row">
      <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Stack>
  );
}
