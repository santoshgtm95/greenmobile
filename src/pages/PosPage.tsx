import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  ButtonBase,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  InputAdornment,
  Paper,
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
import ShoppingCartOutlinedIcon from '@mui/icons-material/ShoppingCartOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
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
import { alpha, keyframes } from '@mui/material/styles';

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

  const closeCompleted = () => setCompleted(null);

  return (
    <>
      <Box
        sx={{
          // Fill the window under the header (60px) and main padding, so nothing scrolls but the lists.
          height: { md: 'calc(100vh - 108px)' },
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 400px', lg: 'minmax(0, 1fr) 460px' },
          gap: 2,
        }}
      >
        {/* Left: search, category bar, product tiles */}
        <Stack spacing={1.25} sx={{ minHeight: 0, minWidth: 0 }}>
          <TextField
            inputRef={searchRef}
            autoFocus
            placeholder="Search a product, or scan a barcode / IMEI"
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
                    <SearchIcon color="primary" />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <Keycap>F2</Keycap>
                  </InputAdornment>
                ),
                sx: (theme) => ({
                  fontSize: '0.95rem',
                  py: 0.5,
                  borderRadius: 3,
                  bgcolor: 'background.paper',
                  boxShadow: '0 1px 2px rgba(16,24,40,.05)',
                  transition: 'box-shadow .2s',
                  '&.Mui-focused': { boxShadow: `0 0 0 4px ${alpha(theme.palette.primary.main, 0.15)}` },
                }),
              },
            }}
          />

          {error && (
            <Alert severity="warning" onClose={() => setError(null)} sx={{ borderRadius: 2.5 }}>
              {error}
            </Alert>
          )}

          {/* Category → Sub Category → Sub Category, one chip row per level. */}
          {categoryRows.map((row, level) => (
            <Stack
              key={level}
              direction="row"
              spacing={0.75}
              // A vertical wheel scrolls the row sideways.
              onWheel={(e) => (e.currentTarget.scrollLeft += e.deltaY)}
              sx={{
                overflowX: 'auto',
                flexShrink: 0,
                pb: 0.25,
                scrollbarWidth: 'thin',
                '& .MuiChip-root': { fontWeight: 600, borderRadius: 2, flexShrink: 0 },
              }}
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
                    label={
                      <>
                        {category.name}
                        <Box component="span" sx={{ ml: 0.75, opacity: 0.6, fontWeight: 500 }}>
                          {category.activeProductCount}
                        </Box>
                      </>
                    }
                    color={active ? 'primary' : 'default'}
                    variant={active ? 'filled' : 'outlined'}
                    onClick={() => setCategoryId(active && category.id === categoryId ? category.parentId ?? undefined : category.id)}
                  />
                );
              })}
            </Stack>
          ))}

          <Paper
            sx={{
              flex: 1,
              minHeight: { xs: 360, md: 0 },
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 3,
              overflow: 'auto',
            }}
          >
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
              <Typography variant="body2" sx={{ fontWeight: 700, flexGrow: 1 }} noWrap>
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
              <Box sx={{ p: 5, textAlign: 'center', color: 'text.secondary' }}>
                <SearchIcon sx={{ fontSize: 40, opacity: 0.35 }} />
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {search ? `Nothing matches "${search}".` : categoryId ? 'No products here.' : 'Search or scan to begin.'}
                </Typography>
              </Box>
            )}

            <Box>
              {(results.data?.rows ?? []).map((product) => (
                <ProductRow
                  key={product.id}
                  product={product}
                  inCart={cartQty.get(product.id) ?? 0}
                  price={money(product.sellingPrice)}
                  onAdd={() => addProduct(product)}
                />
              ))}
            </Box>
          </Paper>
        </Stack>

        {/* Right: who, what, and the one big button */}
        <Paper
          sx={{
            minHeight: { xs: 560, md: 0 },
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 3,
            overflow: 'hidden',
            boxShadow: '0 10px 30px -18px rgba(16,24,40,.35)',
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{ px: 2, py: 1.25, alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}
          >
            <ShoppingCartOutlinedIcon color="primary" fontSize="small" />
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
              Current sale
            </Typography>
            {cart.length > 0 && (
              <Chip
                key={itemCount}
                size="small"
                color="primary"
                label={`${itemCount} item(s)`}
                sx={{ fontWeight: 700, animation: `${pop} .35s ease-out`, ...noMotion }}
              />
            )}
            <Box sx={{ flexGrow: 1 }} />
            {cart.length > 0 && (
              <Button size="small" color="inherit" onClick={clearCart} sx={{ color: 'text.secondary' }}>
                Clear
              </Button>
            )}
          </Stack>

          {/* Customer first: it changes the price list and who the receipt is for. */}
          <Box sx={{ px: 1.5, pt: 1.25 }}>
            <Tooltip title="Choose a customer — F3">
              <ButtonBase
                onClick={() => setCustomerPickerOpen(true)}
                sx={(theme) => ({
                  width: '100%',
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  gap: 1.25,
                  p: 1,
                  borderRadius: 2.5,
                  border: '1px dashed',
                  borderColor: customer ? alpha(theme.palette.primary.main, 0.4) : 'divider',
                  bgcolor: customer ? alpha(theme.palette.primary.main, 0.05) : 'transparent',
                  transition: 'background-color .2s, border-color .2s',
                  '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.08) },
                  '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}` },
                })}
              >
                <Avatar sx={{ width: 34, height: 34, bgcolor: customer ? 'primary.main' : 'action.selected', fontSize: '0.9rem' }}>
                  {customer ? customer.name.trim().charAt(0).toUpperCase() : <PersonIcon fontSize="small" />}
                </Avatar>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 700 }}>
                    {customer ? customer.name : 'Walk-in Customer'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {customer ? customer.phone ?? 'Customer picked' : 'Tap to choose a customer'}
                  </Typography>
                </Box>
                <Keycap>F3</Keycap>
              </ButtonBase>
            </Tooltip>
            {customer && (
              <Button size="small" color="inherit" onClick={() => setCustomer(null)} sx={{ mt: 0.25, color: 'text.secondary' }}>
                Back to walk-in
              </Button>
            )}
          </Box>

          <Box sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto', px: 1.5, py: 1 }}>
            {cart.length === 0 && (
              <Stack spacing={1.25} sx={{ py: 5, alignItems: 'center', textAlign: 'center', color: 'text.secondary' }}>
                <Box
                  sx={(theme) => ({
                    width: 72,
                    height: 72,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: alpha(theme.palette.primary.main, 0.08),
                    color: 'primary.main',
                  })}
                >
                  <ShoppingCartOutlinedIcon sx={{ fontSize: 34 }} />
                </Box>
                <Typography sx={{ fontWeight: 700, color: 'text.primary' }}>Ready for the next customer</Typography>
                <Typography variant="caption">Scan a barcode or tap a product to start.</Typography>
                <Stack direction="row" spacing={1.5} sx={{ pt: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <Shortcut keycap="F2" label="Search" />
                  <Shortcut keycap="F3" label="Customer" />
                  <Shortcut keycap="F8" label="Charge" />
                </Stack>
              </Stack>
            )}

            <Stack spacing={1}>
              {cart.map((line, index) => {
                // Quote lines come back in cart order; a product can appear twice (paid and gift).
                const unitPrice = line.isGift
                  ? (line.serial?.sellingPrice ?? line.product.sellingPrice)
                  : (totals?.lines[index]?.unitPrice ?? line.product.sellingPrice);
                return (
                  <Box
                    key={line.key}
                    sx={(theme) => ({
                      p: 1.25,
                      borderRadius: 2.5,
                      border: '1px solid',
                      borderColor: line.isGift ? alpha(theme.palette.success.main, 0.4) : 'divider',
                      bgcolor: line.isGift ? alpha(theme.palette.success.main, 0.05) : 'background.paper',
                      animation: `${slideIn} .3s cubic-bezier(.2,.8,.2,1)`,
                      ...noMotion,
                    })}
                  >
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', lineHeight: 1.3, wordBreak: 'break-word' }}>
                          {line.product.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" component="div" sx={{ wordBreak: 'break-word' }}>
                          {[line.product.sku, line.product.brandName].filter(Boolean).join(' · ')}
                          {line.serial && ` · IMEI ${line.serial.imei1 ?? line.serial.serialNumber}${line.serial.color ? ` · ${line.serial.color}` : ''}`}{line.color && ` · ${line.color}`}
                        </Typography>
                      </Box>
                      {line.isGift ? (
                        <Chip size="small" color="success" icon={<CardGiftcardIcon />} label="Free" sx={{ fontWeight: 700 }} />
                      ) : (
                        <Typography sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {money(unitPrice * line.quantity)}
                        </Typography>
                      )}
                    </Stack>

                    <Stack direction="row" spacing={1} sx={{ mt: 0.75, alignItems: 'center' }}>
                      {!line.serial ? (
                        <Stack
                          direction="row"
                          sx={{ alignItems: 'center', bgcolor: 'action.hover', borderRadius: 5 }}
                        >
                          <IconButton size="small" aria-label="Decrease" onClick={() => setQuantity(line.key, line.quantity - 1)}>
                            <RemoveIcon fontSize="small" />
                          </IconButton>
                          <Typography sx={{ minWidth: 26, textAlign: 'center', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                            {line.quantity}
                          </Typography>
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
                        <Chip size="small" icon={<SmartphoneIcon sx={{ fontSize: '0.875rem' }} />} label="1 unit" />
                      )}
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ flexGrow: 1, textDecoration: line.isGift ? 'line-through' : 'none' }}
                      >
                        × {money(unitPrice)}
                      </Typography>
                      <Tooltip title={line.isGift ? 'Charge for this item' : 'Give free as a gift'}>
                        <IconButton
                          size="small"
                          aria-label={line.isGift ? 'Charge for this item' : 'Give free as a gift'}
                          aria-pressed={line.isGift}
                          color={line.isGift ? 'success' : 'default'}
                          onClick={() =>
                            setCart((current) => current.map((l) => (l.key === line.key ? { ...l, isGift: !l.isGift } : l)))
                          }
                        >
                          <CardGiftcardIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Remove">
                        <IconButton size="small" aria-label="Remove" onClick={() => setQuantity(line.key, 0)} sx={{ mr: -0.5 }}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          </Box>

          <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.default' }}>
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
            </Stack>

            {/* The one button that matters: says what it will do and for how much. */}
            <ButtonBase
              disabled={cart.length === 0 || quote.isFetching}
              onClick={checkout}
              sx={(theme) => ({
                mt: 1.5,
                width: '100%',
                px: 2,
                py: 1.5,
                borderRadius: 3,
                justifyContent: 'space-between',
                color: theme.palette.primary.contrastText,
                background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
                boxShadow: `0 10px 24px -10px ${alpha(theme.palette.primary.main, 0.8)}`,
                transition: 'transform .15s ease, box-shadow .15s ease, filter .2s',
                '&:hover': { transform: 'translateY(-1px)', boxShadow: `0 14px 28px -10px ${alpha(theme.palette.primary.main, 0.9)}` },
                '&:active': { transform: 'translateY(0)' },
                '&.Mui-disabled': { filter: 'grayscale(1)', opacity: 0.45, boxShadow: 'none' },
                '&.Mui-focusVisible': { outline: `3px solid ${alpha(theme.palette.primary.main, 0.4)}`, outlineOffset: 2 },
                ...noMotion,
              })}
            >
              <Stack sx={{ alignItems: 'flex-start' }}>
                <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', lineHeight: 1.2 }}>
                  {totals?.grandTotal === 0 && cart.length > 0 ? 'Complete free sale' : 'Charge'}
                </Typography>
                <Typography sx={{ fontSize: '0.68rem', opacity: 0.85 }}>Press F8</Typography>
              </Stack>
              <Typography sx={{ fontWeight: 800, fontSize: '1.45rem', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                {money(totals?.grandTotal ?? 0)}
              </Typography>
            </ButtonBase>
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

      {/*
        The finish line. Stays until dismissed: the cashier may still want to print.
        Change is the figure they act on next, so it is the biggest thing here.
        Enter starts the next sale and puts the cursor back in the search.
      */}
      <Dialog
        open={Boolean(completed)}
        onClose={closeCompleted}
        maxWidth="xs"
        fullWidth
        disableRestoreFocus
        slotProps={{ transition: { onExited: () => searchRef.current?.focus() }, paper: { sx: { borderRadius: 4 } } }}
      >
        <DialogContent sx={{ textAlign: 'center', pt: 4 }}>
          <Box
            sx={(theme) => ({
              mx: 'auto',
              width: 76,
              height: 76,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              color: 'success.main',
              bgcolor: alpha(theme.palette.success.main, 0.12),
              boxShadow: `0 0 0 10px ${alpha(theme.palette.success.main, 0.06)}`,
              animation: `${pop} .5s cubic-bezier(.2,1.4,.4,1)`,
              ...noMotion,
            })}
          >
            <CheckCircleIcon sx={{ fontSize: 46 }} />
          </Box>
          <Typography sx={{ mt: 2, fontWeight: 800, fontSize: '1.15rem' }}>Sale completed</Typography>
          <Typography variant="body2" color="text.secondary">
            {completed?.sale.invoiceNumber} · {money(completed?.sale.grandTotal ?? 0)}
          </Typography>
          {completed && completed.sale.changeAmount > 0 && (
            <Box
              sx={(theme) => ({
                mt: 2,
                py: 1.5,
                borderRadius: 3,
                bgcolor: alpha(theme.palette.success.main, 0.08),
                border: '1px solid',
                borderColor: alpha(theme.palette.success.main, 0.3),
              })}
            >
              <Typography variant="caption" sx={{ fontWeight: 700, color: 'success.dark', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Give change
              </Typography>
              <Typography sx={{ fontWeight: 800, fontSize: '2rem', letterSpacing: '-0.02em', color: 'success.dark', fontVariantNumeric: 'tabular-nums' }}>
                {money(completed.sale.changeAmount)}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            startIcon={<PrintIcon fontSize="small" />}
            onClick={() => {
              if (completed) void printReceipt(completed.sale.id);
            }}
          >
            Receipt
          </Button>
          <Button
            variant="outlined"
            onClick={() => {
              if (completed) void printReceipt(completed.sale.id, 'A4');
            }}
          >
            Invoice
          </Button>
          <Button variant="contained" disableElevation autoFocus onClick={closeCompleted} sx={{ flexGrow: 1 }}>
            New sale
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// --- Motion ------------------------------------------------------------------

const pop = keyframes`
  0%   { transform: scale(.6); opacity: 0; }
  70%  { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1); }
`;

const slideIn = keyframes`
  from { transform: translateX(14px); opacity: 0; }
  to   { transform: none; opacity: 1; }
`;

const noMotion = { '@media (prefers-reduced-motion: reduce)': { animation: 'none', transition: 'none' } };

// --- Pieces ------------------------------------------------------------------

/** A keyboard key, so every shortcut reads the same wherever it is hinted. */
function Keycap({ children }: { children: ReactNode }) {
  return (
    <Box
      component="kbd"
      sx={{
        px: 0.75,
        py: 0.1,
        fontFamily: 'inherit',
        fontSize: '0.66rem',
        fontWeight: 700,
        color: 'text.secondary',
        border: '1px solid',
        borderColor: 'divider',
        borderBottomWidth: 2,
        borderRadius: 1,
        bgcolor: 'background.paper',
        lineHeight: 1.6,
      }}
    >
      {children}
    </Box>
  );
}

function Shortcut({ keycap, label }: { keycap: string; label: string }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <Keycap>{keycap}</Keycap>
      <Typography variant="caption">{label}</Typography>
    </Stack>
  );
}

/**
 * One product as a full-width row: name on the left, price and stock lined up on
 * the right, so a column of prices can be scanned top to bottom.
 */
function ProductRow({
  product,
  inCart,
  price,
  onAdd,
}: {
  product: Product;
  inCart: number;
  price: string;
  onAdd: () => void;
}) {
  const out = product.stockQuantity <= 0;
  const stockLabel =
    product.isSerialized === 1
      ? `${product.availableSerials} units`
      : out
        ? 'Out of stock'
        : `${product.stockQuantity} ${product.unit || 'left'}`;
  const stockColor = product.isSerialized === 1 ? 'info' : out ? 'error' : product.stockQuantity <= 5 ? 'warning' : 'success';

  return (
    <ButtonBase
      onClick={onAdd}
      disabled={out && product.isSerialized === 0}
      title={product.name}
      aria-label={`Add ${product.name}, ${price}${inCart ? `, ${inCart} in cart` : ''}`}
      sx={(theme) => ({
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        textAlign: 'left',
        columnGap: 1.5,
        rowGap: 0.75,
        px: 2,
        py: 1,
        borderBottom: '1px solid',
        borderColor: 'divider',
        // In-cart rows keep a primary edge so the cashier sees what is already added.
        boxShadow: inCart ? `inset 3px 0 0 ${theme.palette.primary.main}` : 'none',
        bgcolor: inCart ? alpha(theme.palette.primary.main, 0.05) : 'transparent',
        transition: 'background-color .15s',
        '&:hover': { bgcolor: alpha(theme.palette.primary.main, inCart ? 0.08 : 0.04) },
        '&:hover .add-badge': { bgcolor: 'primary.main', color: 'primary.contrastText' },
        '&:active .add-badge': { transform: 'scale(.88)' },
        '&.Mui-disabled': { opacity: 0.5 },
        '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
      })}
    >
      {/* 200px basis: on narrow screens price and stock wrap below instead of crushing the name. */}
      <Stack direction="row" spacing={1.25} sx={{ flex: '1 1 200px', minWidth: 0, alignItems: 'center' }}>
        {product.isSerialized === 1 && <SmartphoneIcon fontSize="small" color="action" aria-hidden />}
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.8125rem', lineHeight: 1.3, wordBreak: 'break-word' }}>
            {product.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ wordBreak: 'break-word' }}>
            {[product.sku, product.brandName, product.categoryName].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
      </Stack>
      <Stack direction="row" spacing={1.25} sx={{ flexShrink: 0, alignItems: 'center', ml: 'auto' }}>
        {inCart > 0 && (
          <Chip
            key={inCart}
            size="small"
            color="primary"
            label={`×${inCart} in cart`}
            sx={{ fontWeight: 700, animation: `${pop} .35s ease-out`, ...noMotion }}
          />
        )}
        <Chip
          size="small"
          color={stockColor}
          variant="outlined"
          icon={product.isSerialized === 1 ? <SmartphoneIcon sx={{ fontSize: '0.875rem' }} /> : undefined}
          label={stockLabel}
          sx={{ minWidth: 96, fontWeight: 700 }}
        />
        <Typography
          sx={{ minWidth: 90, textAlign: 'right', fontWeight: 800, fontSize: '0.9rem', color: 'primary.main', fontVariantNumeric: 'tabular-nums' }}
        >
          {price}
        </Typography>
        <Box
          className="add-badge"
          aria-hidden
          sx={(theme) => ({
            width: 28,
            height: 28,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            color: 'primary.main',
            bgcolor: alpha(theme.palette.primary.main, 0.1),
            transition: 'background-color .2s, color .2s, transform .1s',
          })}
        >
          <AddIcon sx={{ fontSize: 18 }} />
        </Box>
      </Stack>
    </ButtonBase>
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
