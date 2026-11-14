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
import type { Lookup, Product, PurchaseInvoiceDetail } from '@shared/api';

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
  quantity: number;
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
});
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
          quantity: i.quantity,
        }))
      : [emptyLine()],
  );
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
  const total = filled.reduce((sum, l) => sum + l.quantity * l.unitCost, 0);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        invoiceNo: invoiceNo.trim() || undefined,
        supplierId,
        invoiceAt,
        paymentMethod,
        remark: remark.trim() || undefined,
        items: filled.map((l) => {
          const prices = { quantity: l.quantity, unitCost: l.unitCost, sellingPrice: l.sellingPrice };
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
    filled.every((l) => l.quantity > 0 && (l.productId || l.sku.trim()));

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
            these prices, when it is marked delivered.
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
                  <TableCell sx={{ minWidth: 120 }}>Purchase price</TableCell>
                  <TableCell sx={{ minWidth: 120 }}>Selling price</TableCell>
                  <TableCell sx={{ minWidth: 80 }}>Qty</TableCell>
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
                  <TableCell colSpan={8}>
                    <Button size="small" startIcon={<AddIcon />} disabled={linesLocked} onClick={() => setLines((all) => [...all, emptyLine()])}>
                      Add product
                    </Button>
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', pt: 1.5 }}>
                    {money(total)}
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableBody>
            </Table>
          </Box>
          {fieldErrors.items && <Alert severity="error">{fieldErrors.items}</Alert>}

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
  categories: Lookup[];
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
          // Typing over a picked product starts a new one; its codes do not carry over.
          onInputChange={(_e, text, reason) => {
            if (reason !== 'input') return;
            onChange(line.productId ? { productId: null, name: text, sku: '', barcode: '', description: '' } : { name: text });
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
        <TextField size="small" fullWidth disabled={fixed} required={isNew} value={line.sku} onChange={(e) => onChange({ sku: e.target.value })} />
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
          options={categories}
          value={categories.find((c) => c.id === line.categoryId) ?? null}
          onChange={(_e, c) => onChange({ categoryId: c?.id ?? '' })}
          getOptionLabel={(c) => c.name}
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
