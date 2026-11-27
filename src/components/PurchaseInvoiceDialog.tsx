import { useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import PersonAddIcon from '@mui/icons-material/PersonAddAlt';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import MoneyField from './MoneyField';
import SupplierDialog from './SupplierDialog';
import { useDebounced } from '../hooks/useDebounced';
import { useMoneyFormatter } from '../hooks/useSettings';
import { PosApiError } from '@shared/errors';
import { nowLocalDateTime } from '@shared/datetime';
import { generateEan13Candidate } from '@shared/barcode';
import { PURCHASE_PAYMENT_METHODS, PURCHASE_PAYMENT_LABELS, type PurchasePaymentMethod } from '@shared/domain';
import type { Lookup, Product, ProductCategory, PurchaseInvoiceDetail } from '@shared/api';

/**
 * One product row. With productId it is a product already in Stocks (only its
 * prices and quantity are set here); without, the typed details create a new
 * product when it is first delivered.
 */
type Line = {
  key: number;
  productId: string | null;
  name: string;
  sku: string;
  barcode: string;
  categoryId: string;
  brandName: string;
  description: string;
  unitCost: number;
  sellingPrice: number;
  /** Paid units; free ones are extra. */
  quantity: number;
  freeQty: number;
  /** One of the picked product's colours (colorOptions); empty when it has none. */
  color: string;
  colorOptions: string[];
  /** New product: how its units split by colour. */
  newColors: Array<{ name: string; quantity: number }>;
  /** IMEI phones get their colour per handset on delivery, so theirs is only a default. */
  isSerialized: boolean;
};

let nextKey = 0;
const emptyLine = (): Line => ({
  key: nextKey++,
  productId: null,
  name: '',
  sku: '',
  barcode: '',
  categoryId: '',
  brandName: '',
  description: '',
  unitCost: 0,
  sellingPrice: 0,
  quantity: 1,
  freeQty: 0,
  color: '',
  colorOptions: [],
  newColors: [],
  isSerialized: false,
});
const newColorsTotal = (l: Line) => l.newColors.reduce((sum, c) => sum + c.quantity, 0);
// A product with colours, without IMEI tracking, is ordered one colour per line.
const needsColor = (l: Line) => !l.isSerialized && l.colorOptions.length > 0 && !l.color;
const isFilled = (l: Line) => Boolean(l.productId || l.name.trim());

/** New purchase invoice, or edit one (`invoice` given). */
export default function PurchaseInvoiceDialog({
  invoice,
  onClose,
  onSaved,
}: {
  invoice: PurchaseInvoiceDetail | null;
  onClose: () => void;
  onSaved: (invoice: PurchaseInvoiceDetail) => void;
}) {
  const money = useMoneyFormatter();
  const queryClient = useQueryClient();
  // Lines are fixed once something has arrived (the server checks too).
  const linesLocked = Boolean(invoice?.items.some((i) => i.receivedQty || i.refundedQty || i.replacedQty));

  const [invoiceAt, setInvoiceAt] = useState(invoice ? nowLocalDateTime(new Date(invoice.invoiceDate)) : nowLocalDateTime());
  const [invoiceNo, setInvoiceNo] = useState(invoice?.invoiceNo ?? '');
  const [supplierId, setSupplierId] = useState(invoice?.supplierId ?? '');
  const [paymentMethod, setPaymentMethod] = useState<PurchasePaymentMethod>(invoice?.paymentMethod ?? 'COD');
  const [remark, setRemark] = useState(invoice?.remark ?? '');
  const [lines, setLines] = useState<Line[]>(
    invoice
      ? invoice.items.map((i) => ({
          key: nextKey++,
          productId: i.productId,
          name: i.productName,
          sku: i.sku,
          barcode: i.barcode ?? '',
          categoryId: i.categoryId ?? '',
          brandName: i.brandName ?? '',
          description: i.description ?? '',
          unitCost: i.unitCost,
          sellingPrice: i.sellingPrice,
          quantity: i.quantity - i.freeQty,
          freeQty: i.freeQty,
          color: i.color ?? '',
          colorOptions: i.colors,
          newColors: i.newProduct?.colors ?? [],
          isSerialized: i.isSerialized === 1,
        }))
      : [emptyLine()],
  );
  const [discount, setDiscount] = useState(invoice?.discount ?? 0);
  // While set, the discount follows the subtotal at this percentage.
  const [discountPct, setDiscountPct] = useState<string | null>(null);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const suppliers = useQuery({
    queryKey: ['suppliers', false],
    queryFn: () => api.suppliers.list({ includeInactive: false }),
  });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.categories.list({ includeInactive: false }) });
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => api.brands.list({ includeInactive: false }) });

  const setLine = (key: number, patch: Partial<Line>) =>
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const filled = lines.filter(isFilled);
  const subtotal = filled.reduce((sum, l) => sum + l.quantity * l.unitCost, 0);
  const discountAmount = discountPct !== null ? Math.round((subtotal * (Number(discountPct) || 0)) / 100) : discount;
  const total = subtotal - discountAmount;

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        invoiceNo: invoiceNo.trim() || undefined,
        supplierId,
        invoiceAt,
        paymentMethod,
        remark: remark.trim() || undefined,
        discount: discountAmount,
        items: filled.map((l) => {
          const prices = {
            quantity: l.quantity + l.freeQty,
            freeQty: l.freeQty,
            unitCost: l.unitCost,
            sellingPrice: l.sellingPrice,
            color: l.color || undefined,
          };
          if (l.productId) return { productId: l.productId, ...prices };
          return {
            newProduct: {
              name: l.name.trim(),
              sku: l.sku.trim(),
              barcode: l.barcode.trim() || undefined,
              categoryId: l.categoryId || undefined,
              brandName: l.brandName.trim() || undefined,
              sellingPrice: l.sellingPrice,
              description: l.description.trim() || undefined,
              colors: l.newColors.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), quantity: c.quantity })),
            },
            ...prices,
          };
        }),
      };
      return invoice ? api.purchases.update({ ...payload, id: invoice.id }) : api.purchases.create(payload);
    },
    onSuccess: onSaved,
    onError: (err) => {
      setError(err instanceof PosApiError ? err.message : 'Unable to save this invoice.');
      setFieldErrors(err instanceof PosApiError ? (err.fields ?? {}) : {});
    },
  });

  const canSave =
    supplierId &&
    invoiceAt &&
    filled.length > 0 &&
    total >= 0 &&
    !filled.some(needsColor) &&
    filled.every((l) => l.productId || newColorsTotal(l) <= l.quantity + l.freeQty) &&
    filled.every((l) => l.quantity > 0);

  return (
    <Dialog open fullWidth maxWidth="xl" onClose={save.isPending ? undefined : onClose}>
      <DialogTitle>{invoice ? `Edit invoice ${invoice.invoiceNo}` : 'New purchase invoice'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'flex-start' }}>
            <TextField
              label="Date and time"
              type="datetime-local"
              required
              value={invoiceAt}
              onChange={(e) => setInvoiceAt(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              error={Boolean(fieldErrors.invoiceAt)}
              helperText={fieldErrors.invoiceAt}
            />
            <TextField
              label="Invoice No"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              placeholder={invoice ? undefined : 'Auto'}
              slotProps={{ inputLabel: { shrink: true } }}
              error={Boolean(fieldErrors.invoiceNo)}
              helperText={fieldErrors.invoiceNo ?? (invoice ? ' ' : 'Leave empty to auto-generate (PI-YYYYMM-0001)')}
            />
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', flexGrow: 1, minWidth: 260 }}>
              <TextField
                select
                label="Supplier"
                required
                fullWidth
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                error={Boolean(fieldErrors.supplierId)}
                helperText={fieldErrors.supplierId ?? (suppliers.data?.length === 0 ? 'No supplier yet — register one' : ' ')}
              >
                {/* An inactive supplier being edited still needs to show. */}
                {invoice && !suppliers.data?.some((s) => s.id === invoice.supplierId) && (
                  <MenuItem value={invoice.supplierId}>{invoice.supplierName}</MenuItem>
                )}
                {(suppliers.data ?? []).map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.name}
                    {s.phone && (
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        {s.phone}
                      </Typography>
                    )}
                  </MenuItem>
                ))}
              </TextField>
              <Tooltip title="Register supplier">
                <IconButton onClick={() => setAddingSupplier(true)} sx={{ mt: 1 }}>
                  <PersonAddIcon />
                </IconButton>
              </Tooltip>
            </Stack>
            <ToggleButtonGroup
              exclusive
              color="primary"
              value={paymentMethod}
              onChange={(_e, next: PurchasePaymentMethod | null) => next && setPaymentMethod(next)}
              sx={{ height: 40 }}
            >
              {PURCHASE_PAYMENT_METHODS.map((m) => (
                <ToggleButton key={m} value={m} sx={{ px: 2 }}>
                  {PURCHASE_PAYMENT_LABELS[m]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Stack>

          {linesLocked && (
            <Alert severity="info">Products have arrived on this invoice, so its product lines can no longer change.</Alert>
          )}
          <Typography variant="caption" color="text.secondary">
            Pick a product from Stocks or type a new name. A new product is added to Stocks, and an existing one takes
            these prices, when it is marked delivered. Leave a new product's SKU empty to generate one (P-00001, …).
          </Typography>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ '& td': { px: 0.5, verticalAlign: 'top' }, '& th': { px: 0.5 } }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ minWidth: 220 }}>Product</TableCell>
                  <TableCell sx={{ minWidth: 120 }}>SKU/Code</TableCell>
                  <TableCell sx={{ minWidth: 160 }}>Barcode</TableCell>
                  <TableCell sx={{ minWidth: 150 }}>Category</TableCell>
                  <TableCell sx={{ minWidth: 140 }}>Brand</TableCell>
                  <TableCell sx={{ minWidth: 130 }}>Colour</TableCell>
                  <TableCell sx={{ minWidth: 120 }}>Purchase price</TableCell>
                  <TableCell sx={{ minWidth: 120 }}>Selling price</TableCell>
                  <TableCell sx={{ minWidth: 80 }}>Qty</TableCell>
                  <TableCell sx={{ minWidth: 70 }}>Free</TableCell>
                  <TableCell align="right" sx={{ minWidth: 100 }}>
                    Amount
                  </TableCell>
                  <TableCell sx={{ minWidth: 160 }}>Description</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {lines.map((line) => (
                  <ProductRow
                    key={line.key}
                    line={line}
                    locked={linesLocked}
                    canRemove={lines.length > 1}
                    categories={categories.data ?? []}
                    brands={brands.data ?? []}
                    onChange={(patch) => setLine(line.key, patch)}
                    onRemove={() => setLines((all) => all.filter((l) => l.key !== line.key))}
                  />
                ))}
                <TableRow>
                  <TableCell colSpan={10}>
                    <Button size="small" startIcon={<AddIcon />} disabled={linesLocked} onClick={() => setLines((all) => [...all, emptyLine()])}>
                      Add product
                    </Button>
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', pt: 1.5 }}>
                    {money(subtotal)}
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableBody>
            </Table>
          </Box>
          {fieldErrors.items && <Alert severity="error">{fieldErrors.items}</Alert>}

          <Stack spacing={1} sx={{ alignSelf: 'flex-end', width: 360, maxWidth: '100%' }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
              <Typography variant="body2">Subtotal</Typography>
              <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {money(subtotal)}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <TextField
                label="Discount %"
                type="number"
                size="small"
                sx={{ width: 110 }}
                value={discountPct ?? (subtotal && discount ? String(Math.round((discount / subtotal) * 10000) / 100) : '')}
                onChange={(e) => setDiscountPct(e.target.value)}
                slotProps={{ htmlInput: { min: 0, max: 100, step: 0.5 } }}
              />
              <MoneyField
                label="Discount amount"
                size="small"
                fullWidth
                value={discountAmount}
                onChange={(v) => {
                  setDiscountPct(null);
                  setDiscount(v);
                }}
                error={total < 0 || Boolean(fieldErrors.discount)}
                helperText={total < 0 ? 'More than the subtotal' : fieldErrors.discount}
              />
            </Stack>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Typography variant="subtitle2">Total</Typography>
              <Typography variant="h6" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {money(total)}
              </Typography>
            </Stack>
          </Stack>

          <TextField label="Remark" multiline minRows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>

      {addingSupplier && (
        <SupplierDialog
          supplier={null}
          onClose={() => setAddingSupplier(false)}
          onSaved={(s) => {
            setAddingSupplier(false);
            setSupplierId(s.id);
            void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
          }}
        />
      )}
    </Dialog>
  );
}

/** A new product's colours and how many of the line's units (Qty + Free) are each. */
function NewColors({
  line,
  locked,
  onChange,
}: {
  line: Line;
  locked: boolean;
  onChange: (colors: Line['newColors']) => void;
}) {
  const units = line.quantity + line.freeQty;
  const total = newColorsTotal(line);
  const set = (index: number, patch: Partial<Line['newColors'][number]>) =>
    onChange(line.newColors.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  return (
    <Stack spacing={0.5} sx={{ minWidth: 170 }}>
      {line.newColors.map((c, index) => (
        <Stack key={index} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="Colour"
            disabled={locked}
            value={c.name}
            onChange={(e) => set(index, { name: e.target.value })}
            sx={{ flex: 1 }}
          />
          <TextField
            size="small"
            type="number"
            disabled={locked}
            value={c.quantity}
            onChange={(e) => set(index, { quantity: Math.max(0, Math.floor(Number(e.target.value)) || 0) })}
            slotProps={{ htmlInput: { min: 0, style: { textAlign: 'right' } } }}
            sx={{ width: 64 }}
          />
          <IconButton
            size="small"
            aria-label={`Remove colour ${c.name || index + 1}`}
            disabled={locked}
            onClick={() => onChange(line.newColors.filter((_, i) => i !== index))}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Stack>
      ))}
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Button
          size="small"
          startIcon={<AddIcon />}
          disabled={locked}
          onClick={() => onChange([...line.newColors, { name: '', quantity: Math.max(units - total, 0) }])}
        >
          Colour
        </Button>
        {line.newColors.length > 0 && (
          <Typography variant="caption" color={total > units ? 'error.main' : total < units ? 'warning.main' : 'text.secondary'}>
            {total} of {units}
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}

function ProductRow({
  line,
  locked,
  canRemove,
  categories,
  brands,
  onChange,
  onRemove,
}: {
  line: Line;
  locked: boolean;
  canRemove: boolean;
  categories: ProductCategory[];
  brands: Lookup[];
  onChange: (patch: Partial<Line>) => void;
  onRemove: () => void;
}) {
  const money = useMoneyFormatter();
  const search = useDebounced(line.name, 250);
  const products = useQuery({
    queryKey: ['purchaseProductSearch', search],
    queryFn: () =>
      api.products.list({ search: search || undefined, lowStockOnly: false, includeInactive: false, page: 0, pageSize: 30 }),
    enabled: !locked && !line.productId,
  });

  const isNew = !line.productId && line.name.trim() !== '';
  // An existing product's details belong to Stocks; only prices and quantity are set here.
  const fixed = locked || Boolean(line.productId);
  const brandIsNew =
    isNew && line.brandName.trim() !== '' && !brands.some((b) => b.name.toLowerCase() === line.brandName.trim().toLowerCase());

  const pick = (p: Product) =>
    onChange({
      productId: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode ?? '',
      categoryId: p.categoryId ?? '',
      brandName: p.brandName ?? '',
      description: p.description ?? '',
      unitCost: p.purchasePrice,
      sellingPrice: p.sellingPrice,
      colorOptions: p.colors.map((c) => c.name),
      color: '',
      newColors: [],
      isSerialized: p.isSerialized === 1,
    });

  return (
    <TableRow>
      <TableCell>
        <Autocomplete<Product, false, false, true>
          freeSolo
          size="small"
          disabled={locked}
          options={products.data?.rows ?? []}
          value={null}
          inputValue={line.name}
          // Typing over a picked product starts a new one; its codes and colours do not carry over.
          onInputChange={(_e, text, reason) => {
            if (reason !== 'input') return;
            onChange(
              line.productId
                ? { productId: null, name: text, sku: '', barcode: '', description: '', color: '', colorOptions: [], isSerialized: false }
                : { name: text },
            );
          }}
          onChange={(_e, value) => value && typeof value !== 'string' && pick(value)}
          // The server already filtered.
          filterOptions={(options) => options}
          getOptionLabel={(p) => (typeof p === 'string' ? p : p.name)}
          renderOption={({ key, ...props }, p) => (
            <li key={key} {...props}>
              <Stack>
                <span>{p.name}</span>
                <Typography variant="caption" color="text.secondary">
                  {p.sku} · {p.stockQuantity} in stock · {money(p.purchasePrice)} / {money(p.sellingPrice)}
                </Typography>
              </Stack>
            </li>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="Pick or type a product"
              helperText={isNew ? 'New product' : undefined}
              slotProps={{ ...params.slotProps, formHelperText: { sx: { color: 'info.main', mx: 0 } } }}
            />
          )}
        />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          fullWidth
          disabled={fixed}
          value={line.sku}
          placeholder={isNew ? 'Auto' : undefined}
          onChange={(e) => onChange({ sku: e.target.value })}
        />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          fullWidth
          disabled={fixed}
          value={line.barcode}
          placeholder={isNew ? 'Auto' : undefined}
          onChange={(e) => onChange({ barcode: e.target.value })}
          slotProps={{
            input: {
              endAdornment: !fixed && (
                <Tooltip title="Generate barcode">
                  <IconButton size="small" edge="end" onClick={() => onChange({ barcode: generateEan13Candidate() })}>
                    <AutorenewIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ),
            },
          }}
        />
      </TableCell>
      <TableCell>
        <Autocomplete
          size="small"
          disabled={fixed}
          // A sub category, or a category that has none.
          options={categories.filter(
            (c) => c.depth > 0 || c.id === line.categoryId || !categories.some((s) => s.parentId === c.id),
          )}
          value={categories.find((c) => c.id === line.categoryId) ?? null}
          onChange={(_e, c) => onChange({ categoryId: c?.id ?? '' })}
          getOptionLabel={(c) => c.path}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          noOptionsText="No matching category"
          renderInput={(params) => <TextField {...params} />}
        />
      </TableCell>
      <TableCell>
        <Autocomplete
          size="small"
          freeSolo
          disabled={fixed}
          options={brands.map((b) => b.name)}
          inputValue={line.brandName}
          onInputChange={(_e, text) => onChange({ brandName: text })}
          renderInput={(params) => (
            <TextField
              {...params}
              helperText={brandIsNew ? 'New brand' : undefined}
              slotProps={{ ...params.slotProps, formHelperText: { sx: { color: 'info.main', mx: 0 } } }}
            />
          )}
        />
      </TableCell>
      <TableCell>
        {isNew ? (
          <NewColors line={line} locked={locked} onChange={(newColors) => onChange({ newColors })} />
        ) : line.colorOptions.length > 0 ? (
          <TextField
            select
            size="small"
            fullWidth
            disabled={locked}
            value={line.colorOptions.includes(line.color) ? line.color : ''}
            onChange={(e) => onChange({ color: e.target.value })}
            error={needsColor(line)}
            helperText={line.isSerialized ? 'Default; set per phone on delivery' : undefined}
            slotProps={{ formHelperText: { sx: { mx: 0 } } }}
          >
            {line.isSerialized && <MenuItem value="">Choose on delivery</MenuItem>}
            {line.colorOptions.map((name) => (
              <MenuItem key={name} value={name}>
                {name}
              </MenuItem>
            ))}
          </TextField>
        ) : (
          <Typography variant="body2" color="text.disabled" sx={{ pt: 1 }}>
            —
          </Typography>
        )}
      </TableCell>
      <TableCell>
        <MoneyField size="small" disabled={locked} value={line.unitCost} onChange={(v) => onChange({ unitCost: v })} />
      </TableCell>
      <TableCell>
        <MoneyField size="small" disabled={locked} value={line.sellingPrice} onChange={(v) => onChange({ sellingPrice: v })} />
      </TableCell>
      <TableCell>
        <TextField
          type="number"
          size="small"
          disabled={locked}
          value={line.quantity}
          onChange={(e) => onChange({ quantity: Math.max(1, Math.floor(Number(e.target.value)) || 1) })}
          slotProps={{ htmlInput: { min: 1, style: { textAlign: 'right' } } }}
        />
      </TableCell>
      <TableCell>
        <TextField
          type="number"
          size="small"
          disabled={locked}
          value={line.freeQty}
          onChange={(e) => onChange({ freeQty: Math.max(0, Math.floor(Number(e.target.value)) || 0) })}
          slotProps={{ htmlInput: { min: 0, style: { textAlign: 'right' } } }}
        />
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', pt: 1.5 }}>
        {money(line.quantity * line.unitCost)}
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          fullWidth
          multiline
          maxRows={3}
          disabled={fixed}
          value={line.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </TableCell>
      <TableCell>
        <IconButton size="small" disabled={locked || !canRemove} onClick={onRemove}>
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </TableCell>
    </TableRow>
  );
}
