import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  Divider,
  IconButton,
  InputAdornment,
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
import CardGiftcardIcon from '@mui/icons-material/CardGiftcardOutlined';
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
import ColorPickerDialog from '../components/ColorPickerDialog';
import CustomerPickerDialog from '../components/CustomerPickerDialog';
import PaymentDialog from '../components/PaymentDialog';
import MoneyField from '../components/MoneyField';
import { alpha } from '@mui/material/styles';

/** Gives each cart line a unique React key. */
let lineCounter = 0;

export interface CartLine {
  key: string;
  product: Product;
  quantity: number;
  serial: ProductSerial | null;
  /** Without IMEI tracking: the colour chosen; each colour is its own line. */
  color: string | null;
  /** Given free: priced at 0 by the main process. */
  isGift: boolean;
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
  const [colorPickerFor, setColorPickerFor] = useState<Product | null>(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<SaleDetail | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const debouncedSearch = useDebounced(search, 200);

  // Category picked in the chip bar; narrows the product list like Stocks does.
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.categories.list({ includeInactive: false }),
  });

  const results = useQuery({
    queryKey: ['pos-search', debouncedSearch, categoryId],
    queryFn: () =>
      api.products.list({
        search: debouncedSearch || undefined,
        categoryId,
        lowStockOnly: false,
        inStockOnly: true,
        includeInactive: false,
        page: 0,
        pageSize: 100,
      }),
    placeholderData: (previous) => previous,
  });

  // The authoritative quote. Recomputed by the main process on every change.
  const quoteInput = useMemo(
    () => ({
      customerId: customer?.id,
      items: cart.map((line) => ({
        productId: line.product.id,
        quantity: line.quantity,
        productSerialId: line.serial?.id,
        isGift: line.isGift || undefined,
        color: line.color ?? undefined,
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
    (product: Product, serial: ProductSerial | null = null, color: string | null = null) => {
      setError(null);

      if (product.isSerialized === 1 && !serial) {
        setSerialPickerFor(product);
        return;
      }
      if (product.isSerialized !== 1 && product.colors.length > 0 && !color) {
        setColorPickerFor(product);
        return;
      }

      setCart((current) => {
        // A serialized unit is unique; anything else stacks.
        if (!serial) {
          // A gift line, or another colour, of the same product stays separate; stock counts all.
          const existing = current.find(
            (l) => l.product.id === product.id && !l.serial && !l.isGift && l.color === color,
          );
          const inCart = current.reduce((n, l) => (l.product.id === product.id ? n + l.quantity : n), 0);
          if (existing) {
            if (inCart + 1 > product.stockQuantity && product.stockQuantity >= 0) {
              setError(`Only ${product.stockQuantity} of ${product.name} in stock.`);
              return current;
            }
            return current.map((l) =>
              l === existing ? { ...l, quantity: l.quantity + 1 } : l,
            );
          }
          if (inCart + 1 > product.stockQuantity) {
            setError(`${product.name} is out of stock.`);
            return current;
          }
          // Not crypto.randomUUID: it is missing on plain-http pages (network access from another PC).
          return [...current, { key: `line-${++lineCounter}`, product, quantity: 1, serial: null, color, isGift: false }];
        }

        if (current.some((l) => l.serial?.id === serial.id)) {
          setError('That unit is already in the cart.');
          return current;
        }
        return [...current, { key: serial.id, product, quantity: 1, serial, color: null, isGift: false }];
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
        if (!product.isActive || product.stockQuantity <= 0) {
          setError(`${product.name} is ${product.isActive ? 'out of stock' : 'inactive'}.`);
          return;
        }
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
    mutationFn: (
      payments: Array<{ amount: number; paymentMethod: string; shopAccountId?: string; referenceNumber?: string }>,
    ) =>
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
        if (cart.length > 0) checkout();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const totals = quote.data;

  // Nothing to collect when every line is a gift, so skip the payment dialog.
  const checkout = () => {
    if (!totals || quote.isFetching) return;
    if (totals.grandTotal === 0) completeSale.mutate([]);
    else setPaymentOpen(true);
  };

  // The selected category's ancestry, top level first, and one chip row per level.
  const allCategories = categories.data ?? [];
  const selected = allCategories.find((c) => c.id === categoryId);
  const chain: typeof allCategories = [];
  for (let c = selected; c; c = allCategories.find((p) => p.id === c!.parentId)) chain.unshift(c);
  const categoryRows = [
    allCategories.filter((c) => !c.parentId),
    ...chain.map((c) => allCategories.filter((child) => child.parentId === c.id)).filter((row) => row.length > 0),
  ];

  const cartQty = new Map<string, number>();
  for (const line of cart) cartQty.set(line.product.id, (cartQty.get(line.product.id) ?? 0) + line.quantity);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <>
      <Box
        sx={{
          // Fill the window under the header (60px) and main padding, so nothing scrolls but the lists.
          height: { md: 'calc(100vh - 108px)' },
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 420px', lg: 'minmax(0, 1fr) 500px' },
          gap: 2,
        }}
      >
        {/* Left: search, category bar, product grid */}
        <Stack spacing={1.5} sx={{ minHeight: 0, minWidth: 0 }}>
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
                sx: { fontSize: "0.875rem", py: 0.25 },
              },
            }}
          />

          {error && (
            <Alert severity="warning" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {/* Category → Sub Category → Sub Category, one chip row per level. */}
          {categoryRows.map((row, level) => (
            <Stack
              key={level}
              direction="row"
              spacing={1}
              // A vertical wheel scrolls the row sideways.
              onWheel={(e) => (e.currentTarget.scrollLeft += e.deltaY)}
              sx={{ overflowX: 'auto', flexShrink: 0, pb: 0.25, scrollbarWidth: 'thin' }}
            >
              {level === 0 && (
                <Chip
                  label="All products"
                  color={!categoryId ? 'primary' : 'default'}
                  variant={!categoryId ? 'filled' : 'outlined'}
                  onClick={() => setCategoryId(undefined)}
                />
              )}
              {row.map((category) => {
                const active = chain.some((c) => c.id === category.id);
                return (
                  <Chip
                    key={category.id}
                    label={`${category.name}  ${category.activeProductCount}`}
                    color={active ? 'primary' : 'default'}
                    variant={active ? 'filled' : 'outlined'}
                    onClick={() => setCategoryId(active && category.id === categoryId ? category.parentId ?? undefined : category.id)}
                    sx={{ flexShrink: 0 }}
                  />
                );
              })}
            </Stack>
          ))}

          <Paper sx={{ flex: 1, minHeight: { xs: 360, md: 0 }, border: '1px solid', borderColor: 'divider', overflow: 'auto' }}>
            <Stack
              direction="row"
              spacing={1}
              sx={{
                px: 2,
                py: 1,
                alignItems: 'center',
                borderBottom: '1px solid',
                borderColor: 'divider',
                position: 'sticky',
                top: 0,
                zIndex: 1,
                bgcolor: 'background.paper',
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600, flexGrow: 1 }} noWrap>
                {selected?.path ?? 'All products'}
              </Typography>
              {results.data && (
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {results.data.total > results.data.rows.length
                    ? `First ${results.data.rows.length} of ${results.data.total} — search to narrow`
                    : `${results.data.total} product(s)`}
                </Typography>
              )}
            </Stack>

            {results.isLoading && <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>Searching…</Box>}
            {!results.isLoading && (results.data?.rows.length ?? 0) === 0 && (
              <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                {search ? `Nothing matches "${search}".` : categoryId ? 'No products here.' : 'Search or scan to begin.'}
              </Box>
            )}

            <Box>
              {(results.data?.rows ?? []).map((product) => {
                const out = product.stockQuantity <= 0;
                const inCart = cartQty.get(product.id) ?? 0;
                return (
                  <ButtonBase
                    key={product.id}
                    onClick={() => addProduct(product)}
                    disabled={out && product.isSerialized === 0}
                    title={product.name}
                    sx={(theme) => ({
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      textAlign: 'left',
                      columnGap: 2,
                      rowGap: 0.75,
                      px: 2,
                      py: 1.25,
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      // In-cart rows keep an indigo edge so the cashier sees what is already added.
                      boxShadow: inCart ? `inset 3px 0 0 ${theme.palette.primary.main}` : 'none',
                      bgcolor: inCart ? alpha(theme.palette.primary.main, 0.04) : 'transparent',
                      transition: 'background-color 120ms',
                      '&:hover': { bgcolor: alpha(theme.palette.primary.main, inCart ? 0.07 : 0.035) },
                      '&.Mui-disabled': { opacity: 0.5 },
                      '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
                    })}
                  >
                    {/* 200px basis: on narrow screens (tablet) price and stock wrap below instead of crushing the name. */}
                    <Box sx={{ flex: '1 1 200px', minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 600, fontSize: "0.8125rem", lineHeight: 1.3, wordBreak: 'break-word' }}>
                        {product.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" component="div" sx={{ wordBreak: 'break-word' }}>
                        {[product.sku, product.brandName, product.categoryName].filter(Boolean).join(' · ')}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1.5} sx={{ flexShrink: 0, alignItems: 'center', ml: 'auto' }}>
                      {inCart > 0 && <Chip size="small" color="primary" label={`×${inCart} in cart`} />}
                      <Typography sx={{ minWidth: 90, textAlign: 'right', fontWeight: 700, fontSize: "0.875rem", fontVariantNumeric: 'tabular-nums' }}>
                        {money(product.sellingPrice)}
                      </Typography>
                      {product.isSerialized === 1 ? (
                        <Chip
                          size="small"
                          icon={<SmartphoneIcon sx={{ fontSize: "0.875rem" }} />}
                          label={`${product.availableSerials} units`}
                          color="info"
                          sx={{ minWidth: 104 }}
                        />
                      ) : (
                        <Chip
                          size="small"
                          label={out ? 'Out of stock' : `${product.stockQuantity} ${product.unit || 'in stock'}`}
                          color={out ? 'error' : product.stockQuantity <= 5 ? 'warning' : 'success'}
                          sx={{ minWidth: 104 }}
                        />
                      )}
                    </Stack>
                  </ButtonBase>
                );
              })}
            </Box>
          </Paper>
        </Stack>

        {/* Right: cart, full height */}
        <Paper
          sx={{
            minHeight: { xs: 560, md: 0 },
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid',
            borderColor: 'divider',
            overflow: 'hidden',
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{ px: 2, py: 1.25, alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}
          >
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Cart
            </Typography>
            {cart.length > 0 && <Chip size="small" label={`${itemCount} item(s)`} />}
            <Box sx={{ flexGrow: 1 }} />
            {cart.length > 0 && (
              <Button size="small" color="inherit" onClick={clearCart}>
                Clear
              </Button>
            )}
          </Stack>

          <Box sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto' }}>
            {cart.length === 0 && (
              <Box sx={{ p: 5, textAlign: 'center', color: 'text.secondary' }}>
                <Typography variant="body2">The cart is empty.</Typography>
                <Typography variant="caption">Scan a barcode or pick a product.</Typography>
              </Box>
            )}

            {cart.map((line, index) => {
              // Quote lines come back in cart order; a product can appear twice (paid and gift).
              const unitPrice = line.isGift
                ? (line.serial?.sellingPrice ?? line.product.sellingPrice)
                : (totals?.lines[index]?.unitPrice ?? line.product.sellingPrice);
              return (
                <Box key={line.key} sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 600, lineHeight: 1.3, wordBreak: 'break-word' }}>
                        {line.product.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" component="div" sx={{ wordBreak: 'break-word' }}>
                        {[line.product.sku, line.product.brandName].filter(Boolean).join(' · ')}
                        {line.serial && ` · IMEI ${line.serial.imei1 ?? line.serial.serialNumber}${line.serial.color ? ` · ${line.serial.color}` : ''}`}{line.color && ` · ${line.color}`}
                      </Typography>
                    </Box>
                    <Tooltip title={line.isGift ? 'Charge for this item' : 'Give free as a gift'}>
                      <IconButton
                        size="small"
                        aria-pressed={line.isGift}
                        color={line.isGift ? 'success' : 'default'}
                        onClick={() =>
                          setCart((current) => current.map((l) => (l.key === line.key ? { ...l, isGift: !l.isGift } : l)))
                        }
                        sx={{ mt: -0.5 }}
                      >
                        <CardGiftcardIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Remove">
                      <IconButton size="small" onClick={() => setQuantity(line.key, 0)} sx={{ mt: -0.5, mr: -0.75 }}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>

                  <Stack direction="row" spacing={1} sx={{ mt: 0.75, alignItems: 'center' }}>
                    {!line.serial ? (
                      <Stack
                        direction="row"
                        sx={{ alignItems: 'center', border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
                      >
                        <IconButton size="small" aria-label="Decrease" onClick={() => setQuantity(line.key, line.quantity - 1)}>
                          <RemoveIcon fontSize="small" />
                        </IconButton>
                        <Typography sx={{ minWidth: 28, textAlign: 'center', fontWeight: 700 }}>{line.quantity}</Typography>
                        <IconButton
                          size="small"
                          aria-label="Increase"
                          onClick={() => {
                            if ((cartQty.get(line.product.id) ?? 0) + 1 > line.product.stockQuantity && line.product.stockQuantity >= 0) {
                              setError(`Only ${line.product.stockQuantity} of ${line.product.name} in stock.`);
                              return;
                            }
                            setQuantity(line.key, line.quantity + 1);
                          }}
                        >
                          <AddIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    ) : (
                      <Chip size="small" label="1 unit" />
                    )}
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ flexGrow: 1, textDecoration: line.isGift ? 'line-through' : 'none' }}
                    >
                      × {money(unitPrice)}
                    </Typography>
                    {line.isGift ? (
                      <Chip size="small" color="success" icon={<CardGiftcardIcon />} label="Free gift" />
                    ) : (
                      <Typography sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {money(unitPrice * line.quantity)}
                      </Typography>
                    )}
                  </Stack>
                </Box>
              );
            })}
          </Box>

          <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider', bgcolor: '#fafbfc' }}>
            <Stack spacing={0.75}>
              <TotalRow label="Subtotal" value={money(totals?.subtotal ?? 0)} />
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
                  Discount
                </Typography>
                <MoneyField
                  value={discount}
                  onChange={setDiscount}
                  size="small"
                  fullWidth={false}
                  sx={{ width: 150 }}
                  disabled={cart.length === 0}
                />
              </Stack>
              <TotalRow label="Tax" value={money(totals?.taxAmount ?? 0)} />
              <Divider sx={{ my: 0.5 }} />
              <Stack direction="row" sx={{ alignItems: 'baseline' }}>
                <Typography sx={{ flexGrow: 1, fontWeight: 600 }}>Total</Typography>
                <Typography variant="h5" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {money(totals?.grandTotal ?? 0)}
                </Typography>
              </Stack>
            </Stack>

            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1.5 }}>
              <Tooltip title="Choose a customer — F3">
                <Button
                  variant="outlined"
                  startIcon={<PersonIcon />}
                  onClick={() => setCustomerPickerOpen(true)}
                  sx={{ flexGrow: 1, justifyContent: 'flex-start', minWidth: 0 }}
                >
                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {customer ? customer.name : 'Walk-in Customer'}
                  </Box>
                </Button>
              </Tooltip>
              {customer && (
                <Button color="inherit" onClick={() => setCustomer(null)}>
                  Clear
                </Button>
              )}
            </Stack>

            <Button
              fullWidth
              size="large"
              variant="contained"
              disabled={cart.length === 0 || quote.isFetching}
              onClick={checkout}
              sx={{ mt: 1.25, py: 1, fontSize: "0.875rem" }}
            >
              Complete Sale — F8
            </Button>
          </Box>
        </Paper>
      </Box>

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

      {colorPickerFor && (
        <ColorPickerDialog
          product={colorPickerFor}
          onClose={() => setColorPickerFor(null)}
          onPick={(color) => {
            addProduct(colorPickerFor, null, color);
            setColorPickerFor(null);
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
          summary={<CartSummary cart={cart} quote={totals} customerName={customer?.name ?? 'Walk-in Customer'} />}
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
    </>
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

/** Read-only list of what is being paid for, shown in the payment dialog. */
function CartSummary({ cart, quote, customerName }: { cart: CartLine[]; quote: SaleQuote; customerName: string }) {
  const money = useMoneyFormatter();
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2.5, overflow: 'hidden' }}>
      <Stack direction="row" spacing={1} sx={{ px: 2, py: 1.25, alignItems: 'center', bgcolor: 'background.default' }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          {count} item(s)
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {customerName}
        </Typography>
      </Stack>
      <Box sx={{ maxHeight: 340, overflow: 'auto' }}>
        {cart.map((line, index) => {
          // Quote lines come back in cart order.
          const priced = quote.lines[index];
          const unitPrice = line.isGift ? (line.serial?.sellingPrice ?? line.product.sellingPrice) : (priced?.unitPrice ?? 0);
          return (
            <Box key={line.key} sx={{ px: 2, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: 'break-word' }}>
                    {line.product.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" component="div" sx={{ wordBreak: 'break-word' }}>
                    {[line.product.brandName, line.product.sku].filter(Boolean).join(' · ')}
                    {line.serial && ` · IMEI ${line.serial.imei1 ?? line.serial.serialNumber}${line.serial.color ? ` · ${line.serial.color}` : ''}`}{line.color && ` · ${line.color}`}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ textDecoration: line.isGift ? 'line-through' : 'none' }}
                  >
                    {line.quantity} × {money(unitPrice)}
                  </Typography>
                </Box>
                {line.isGift ? (
                  <Chip size="small" color="success" label="Gift" />
                ) : (
                  <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {/* Gross, so the lines add up to the subtotal below. */}
                    {money(unitPrice * line.quantity)}
                  </Typography>
                )}
              </Stack>
            </Box>
          );
        })}
      </Box>
      <Stack spacing={0.5} sx={{ px: 2, py: 1.25, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.default' }}>
        <TotalRow label="Subtotal" value={money(quote.subtotal)} />
        {quote.discountAmount > 0 && <TotalRow label="Discount" value={`−${money(quote.discountAmount)}`} />}
        {quote.taxAmount > 0 && <TotalRow label="Tax" value={money(quote.taxAmount)} />}
      </Stack>
    </Box>
  );
}
