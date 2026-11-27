import { useState, type KeyboardEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Autocomplete,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import MoneyField from './MoneyField';
import { PosApiError } from '@shared/errors';
import { formatRate, parseRate } from '@shared/money';
import { PRODUCT_UNITS } from '@shared/domain';
import { generateEan13Candidate } from '@shared/barcode';
import type { Lookup, Product, ProductCategory } from '@shared/api';
import ShopAccountSelect from './ShopAccountSelect';
import { SerialTable } from './SerialsDialog';
import CashInHandBox from './CashInHandBox';
import { useMoneyFormatter } from '../hooks/useSettings';
import { multiplyMoney } from '@shared/money';

/** Product form (spec §40). `product === null` means "create". */
export default function ProductDialog({
  product,
  categories,
  brands,
  onClose,
  onSaved,
}: {
  product: Product | null;
  categories: ProductCategory[];
  brands: Lookup[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = product !== null;

  const [form, setForm] = useState({
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    name: product?.name ?? '',
    description: product?.description ?? '',
    categoryId: product?.categoryId ?? '',
    brandId: product?.brandId ?? '',
    purchasePrice: product?.purchasePrice ?? 0,
    sellingPrice: product?.sellingPrice ?? 0,
    taxRate: product?.taxRate ?? 0,
    taxRateOverride: product?.taxRateOverride === 1,
    minimumStock: product?.minimumStock ?? 0,
    unit: product?.unit ?? 'pcs',
    isSerialized: product?.isSerialized === 1,
    warrantyMonths: product?.warrantyMonths ?? 0,
    isActive: product ? product.isActive === 1 : true,
    initialStock: 0,
    // Who pays for the opening stock: cash in hand or a shop account.
    paidBy: 'CASH' as 'CASH' | 'BANK',
    purchaseShopAccountId: '',
  });
  // The colours it comes in; quantities are typed only without IMEI tracking.
  const [colors, setColors] = useState(product?.colors.map((c) => ({ ...c })) ?? []);
  const colorNames = colors.map((c) => c.name.trim()).filter(Boolean);
  const colorTotal = colors.reduce((sum, c) => sum + c.quantity, 0);
  const setColor = (index: number, patch: Partial<{ name: string; quantity: number }>) =>
    setColors((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  // One row per phone; a dual-SIM phone has two IMEIs.
  const [phones, setPhones] = useState([{ imei1: '', imei2: '', color: '' }]);
  const filledPhones = phones.filter((p) => p.imei1.trim() || p.imei2.trim());
  const serials = filledPhones.map((p) => {
    const [imei1, imei2] = [p.imei1.trim(), p.imei2.trim()].filter(Boolean);
    return { imei1, imei2, color: p.color || undefined };
  });
  // With colours listed, every phone says which one it is.
  const missingColor = colorNames.length > 0 && filledPhones.some((p) => !colorNames.includes(p.color));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const money = useMoneyFormatter();
  // Editing: IMEIs go on units already in stock, one per unit that has none yet.
  const untagged = isEdit ? Math.max(product.stockQuantity - product.availableSerials, 0) : Infinity;
  const openingUnits = form.isSerialized ? serials.length : form.initialStock;
  const paysForStock = !isEdit && openingUnits > 0;
  const stockCost = paysForStock ? multiplyMoney(form.purchasePrice, openingUnits) : 0;

  const setPhone = (index: number, key: 'imei1' | 'imei2' | 'color', value: string) =>
    setPhones((rows) => rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

  // Enter (or a scanner's trailing Enter) moves to the next IMEI box, adding a phone at the end.
  const nextImei = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const inputs = [...document.querySelectorAll<HTMLInputElement>('[data-imei] input')];
    const next = inputs[inputs.indexOf(event.target as HTMLInputElement) + 1];
    if (next) next.focus();
    else setPhones((rows) => (rows.length < untagged ? [...rows, { imei1: '', imei2: '', color: '' }] : rows));
  };

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: async () => {
      let barcode = form.barcode.trim();
      if (!isEdit && !barcode) {
        barcode = generateEan13Candidate();
      }

      const common = {
        sku: form.sku.trim(),
        barcode: barcode || undefined,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        categoryId: form.categoryId || undefined,
        brandId: form.brandId || undefined,
        purchasePrice: form.purchasePrice,
        sellingPrice: form.sellingPrice,
        taxRate: form.taxRate,
        taxRateOverride: form.taxRateOverride,
        // Phones are counted by IMEI, so they fall back to the shop's low-stock level.
        minimumStock: form.isSerialized ? 0 : form.minimumStock,
        unit: form.unit,
        isSerialized: form.isSerialized,
        warrantyMonths: form.warrantyMonths,
        colors: colors
          .filter((c) => c.name.trim())
          .map((c) => ({ name: c.name.trim(), quantity: form.isSerialized ? 0 : c.quantity })),
      };

      if (isEdit) {
        const updated = await api.products.update({ ...common, id: product.id, isActive: form.isActive });
        // After the update, so a product just switched to IMEI tracking accepts them.
        return form.isSerialized && serials.length > 0
          ? api.serials.add({ productId: product.id, serials })
          : updated;
      }
      return api.products.create({
        ...common,
        initialStock: form.isSerialized ? 0 : form.initialStock,
        serials: form.isSerialized && serials.length > 0 ? serials : undefined,
        purchaseShopAccountId:
          paysForStock && form.paidBy === 'BANK' ? form.purchaseShopAccountId : undefined,
      });
    },
    onSuccess: onSaved,
    onError: (err) => {
      if (err instanceof PosApiError) {
        setError(err.message);
        setFieldErrors(err.fields ?? {});
      } else {
        setError('Unable to save this product.');
      }
    },
  });

  const marginPercent =
    form.purchasePrice > 0
      ? Math.round(((form.sellingPrice - form.purchasePrice) / form.purchasePrice) * 1000) / 10
      : null;

  return (
    <Dialog open fullWidth maxWidth="md" onClose={onClose}>
      <DialogTitle>{isEdit ? `Edit ${product.name}` : 'Add product'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="Product name"
            required
            autoFocus
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            error={Boolean(fieldErrors.name)}
            helperText={fieldErrors.name}
          />

          <Stack direction="row" spacing={2}>
            <TextField
              label="SKU/Code"
              required={isEdit}
              value={form.sku}
              onChange={(e) => set('sku', e.target.value)}
              placeholder={isEdit ? undefined : 'Auto'}
              slotProps={{ inputLabel: { shrink: true } }}
              error={Boolean(fieldErrors.sku)}
              helperText={
                fieldErrors.sku ??
                (isEdit ? 'Your own product code — must be unique' : 'Leave empty to generate (P-00001, …)')
              }
            />
            <TextField
              label="Barcode"
              value={form.barcode}
              onChange={(e) => set('barcode', e.target.value)}
              error={Boolean(fieldErrors.barcode)}
              helperText={
                fieldErrors.barcode ??
                (isEdit
                  ? 'Scan into this field or enter barcode'
                  : 'Leave empty to auto-generate when clicking Save')
              }
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <Button
                        size="small"
                        onClick={() => set('barcode', generateEan13Candidate())}
                        sx={{ fontSize: "0.6875rem", minWidth: 'auto', px: 1 }}
                      >
                        Generate
                      </Button>
                    </InputAdornment>
                  ),
                },
              }}
            />
          </Stack>

          <Stack direction="row" spacing={2}>
            <Autocomplete
              // Products go in a sub category, or in a category that has none.
              options={categories.filter(
                (c) => c.depth > 0 || c.id === form.categoryId || !categories.some((s) => s.parentId === c.id),
              )}
              value={categories.find((c) => c.id === form.categoryId) ?? null}
              onChange={(_e, c) => set('categoryId', c?.id ?? '')}
              groupBy={(c) => c.path.split(' › ')[0]}
              getOptionLabel={(c) => c.path}
              renderOption={({ key, ...props }, c) => (
                <li key={key} {...props}>
                  {c.path.split(' › ').slice(1).join(' › ') || c.name}
                </li>
              )}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              noOptionsText="No matching category"
              fullWidth
              renderInput={(params) => <TextField {...params} label="Category" placeholder="Type to search" />}
            />
            <TextField
              select
              label="Brand"
              value={form.brandId}
              onChange={(e) => set('brandId', e.target.value)}
            >
              <MenuItem value="">None</MenuItem>
              {brands.map((b) => (
                <MenuItem key={b.id} value={b.id}>
                  {b.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <TextField
            label="Description"
            multiline
            minRows={2}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />

          <Divider textAlign="left">
            <Typography variant="caption" color="text.secondary">
              Pricing
            </Typography>
          </Divider>

          <Stack direction="row" spacing={2}>
            <MoneyField
              label="Purchase price"
              value={form.purchasePrice}
              onChange={(v) => set('purchasePrice', v)}
              helperText="What you pay your supplier"
            />
            <MoneyField
              label="Selling price"
              value={form.sellingPrice}
              onChange={(v) => set('sellingPrice', v)}
              helperText={
                marginPercent === null
                  ? 'What the customer pays'
                  : `Margin ${marginPercent}%`
              }
            />
          </Stack>

          <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
            <FormControlLabel
              sx={{ minWidth: 240, mt: 1 }}
              control={
                <Switch
                  checked={form.taxRateOverride}
                  onChange={(e) => set('taxRateOverride', e.target.checked)}
                />
              }
              label="Use its own tax rate"
            />
            {form.taxRateOverride ? (
              <TextField
                label="Tax rate"
                defaultValue={formatRate(form.taxRate).replace('%', '')}
                onChange={(e) => set('taxRate', parseRate(e.target.value) ?? 0)}
                helperText="Percent, e.g. 7"
              />
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                Uses the shop tax rate from Settings.
              </Typography>
            )}
          </Stack>

          <Divider textAlign="left">
            <Typography variant="caption" color="text.secondary">
              Stock
            </Typography>
          </Divider>

          <Stack direction="row" spacing={2}>
            {!isEdit && !form.isSerialized && (
              <TextField
                label="Initial stock"
                type="number"
                value={form.initialStock}
                onChange={(e) => set('initialStock', Math.max(0, Number(e.target.value) || 0))}
                helperText="Recorded as an opening stock movement"
              />
            )}
            {!form.isSerialized && (
              <TextField
                label="Minimum stock"
                type="number"
                value={form.minimumStock}
                onChange={(e) => set('minimumStock', Math.max(0, Number(e.target.value) || 0))}
                helperText="Warn at or below this level"
              />
            )}
            <TextField select label="Unit" value={form.unit} onChange={(e) => set('unit', e.target.value)}>
              {PRODUCT_UNITS.map((u) => (
                <MenuItem key={u} value={u}>
                  {u}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          {paysForStock && (
            <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
              <TextField
                select
                label="Paid by"
                value={form.paidBy}
                onChange={(e) => set('paidBy', e.target.value as 'CASH' | 'BANK')}
                helperText={`Opening stock costs ${money(stockCost)}`}
                sx={{ minWidth: 200 }}
              >
                <MenuItem value="CASH">Cash</MenuItem>
                <MenuItem value="BANK">Bank</MenuItem>
              </TextField>
              {form.paidBy === 'BANK' ? (
                <ShopAccountSelect
                  label="Paid from account"
                  value={form.purchaseShopAccountId}
                  onChange={(id) => set('purchaseShopAccountId', id)}
                  spend={stockCost}
                  sx={{ flex: 1 }}
                />
              ) : (
                <Box sx={{ flex: 1 }}>
                  <CashInHandBox spend={stockCost} />
                </Box>
              )}
            </Stack>
          )}

          {isEdit && (
            <Alert severity="info">
              Stock is changed through stock adjustments and IMEI records, not on this form, so
              every movement keeps its reason in the inventory history.
            </Alert>
          )}

          <Divider textAlign="left">
            <Typography variant="caption" color="text.secondary">
              Colours
            </Typography>
          </Divider>

          <Stack spacing={1}>
            {colors.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                No colours. Add the colours this product comes in, if it has any.
              </Typography>
            )}
            {colors.map((color, index) => (
              <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TextField
                  size="small"
                  label="Colour"
                  value={color.name}
                  autoFocus={index === colors.length - 1 && !color.name}
                  onChange={(e) => setColor(index, { name: e.target.value })}
                  sx={{ flex: 1 }}
                />
                {form.isSerialized ? (
                  <Typography variant="body2" color="text.secondary" sx={{ width: 140 }}>
                    {/* Counted from the IMEIs in stock of this colour. */}
                    {product?.colors.find((c) => c.name === color.name)?.quantity ?? 0} in stock
                  </Typography>
                ) : (
                  <TextField
                    size="small"
                    type="number"
                    label="Quantity"
                    value={color.quantity}
                    onChange={(e) => setColor(index, { quantity: Math.max(0, Math.floor(Number(e.target.value)) || 0) })}
                    sx={{ width: 140 }}
                  />
                )}
                <IconButton
                  size="small"
                  aria-label={`Remove colour ${color.name || index + 1}`}
                  onClick={() => setColors((rows) => rows.filter((_, i) => i !== index))}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Button size="small" startIcon={<AddIcon />} onClick={() => setColors((rows) => [...rows, { name: '', quantity: 0 }])}>
                Add colour
              </Button>
              {!form.isSerialized && colors.length > 0 && (
                <Typography
                  variant="body2"
                  color={colorTotal === (isEdit ? product.stockQuantity : form.initialStock) ? 'text.secondary' : 'warning.main'}
                >
                  Colours total <strong>{colorTotal}</strong> of {isEdit ? product.stockQuantity : form.initialStock} in stock
                </Typography>
              )}
            </Stack>
            {fieldErrors.colors && <Alert severity="error">{fieldErrors.colors}</Alert>}
          </Stack>

          <Divider textAlign="left">
            <Typography variant="caption" color="text.secondary">
              Serial numbers and warranty
            </Typography>
          </Divider>

          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <FormControlLabel
              sx={{ minWidth: 240 }}
              control={
                <Switch
                  checked={form.isSerialized}
                  onChange={(e) => set('isSerialized', e.target.checked)}
                />
              }
              label="Tracks IMEI / serial numbers"
            />
            <TextField
              label="Warranty (months)"
              type="number"
              value={form.warrantyMonths}
              onChange={(e) => set('warrantyMonths', Math.max(0, Number(e.target.value) || 0))}
              sx={{ maxWidth: 200 }}
            />
          </Stack>

          {form.isSerialized && isEdit && (
            <>
              <Paper variant="outlined" sx={{ overflow: 'auto', maxHeight: 280 }}>
                <SerialTable productId={product.id} colors={product.colors.map((c) => c.name)} />
              </Paper>
              <Alert severity="info">
                {untagged > 0
                  ? `${untagged} unit(s) in stock have no IMEI yet — enter them below. Stock does not change.`
                  : 'Every unit in stock has an IMEI. New phones come in through a purchase invoice.'}
              </Alert>
            </>
          )}

          {form.isSerialized && untagged > 0 && (
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                {isEdit
                  ? 'Enter the IMEI of each phone already in stock; add IMEI 2 for dual-SIM phones.'
                  : 'Enter the IMEI of each phone you have. Each phone is one unit of stock; add IMEI 2 for dual-SIM phones.'}{' '}
                Press Enter or scan to move to the next box.
              </Typography>
              {phones.map((phone, index) => (
                <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ width: 56, flexShrink: 0 }}>
                    Phone {index + 1}
                  </Typography>
                  <TextField
                    data-imei
                    size="small"
                    label="IMEI 1"
                    value={phone.imei1}
                    autoFocus={index > 0 && index === phones.length - 1}
                    onChange={(e) => setPhone(index, 'imei1', e.target.value)}
                    onKeyDown={nextImei}
                    slotProps={{ htmlInput: { style: { fontFamily: 'monospace' } } }}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    data-imei
                    size="small"
                    label="IMEI 2 (optional)"
                    value={phone.imei2}
                    onChange={(e) => setPhone(index, 'imei2', e.target.value)}
                    onKeyDown={nextImei}
                    slotProps={{ htmlInput: { style: { fontFamily: 'monospace' } } }}
                    sx={{ flex: 1 }}
                  />
                  {colorNames.length > 0 && (
                    <TextField
                      select
                      size="small"
                      label="Colour"
                      value={colorNames.includes(phone.color) ? phone.color : ''}
                      onChange={(e) => setPhone(index, 'color', e.target.value)}
                      error={Boolean((phone.imei1.trim() || phone.imei2.trim()) && !colorNames.includes(phone.color))}
                      sx={{ width: 140 }}
                    >
                      {colorNames.map((name) => (
                        <MenuItem key={name} value={name}>
                          {name}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                  <IconButton
                    size="small"
                    aria-label={`Remove phone ${index + 1}`}
                    disabled={phones.length === 1}
                    onClick={() => setPhones((rows) => rows.filter((_, i) => i !== index))}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  disabled={phones.length >= untagged}
                  onClick={() => setPhones((rows) => [...rows, { imei1: '', imei2: '', color: '' }])}
                >
                  Add another phone
                </Button>
                <Typography variant="body2" color="text.secondary">
                  {isEdit ? (
                    <>
                      IMEIs: <strong>{serials.length}</strong> of {untagged}
                    </>
                  ) : (
                    <>
                      Opening stock: <strong>{serials.length}</strong>
                    </>
                  )}
                </Typography>
              </Stack>
            </Stack>
          )}

          {isEdit && (
            <FormControlLabel
              control={
                <Switch checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
              }
              label="Active (available to sell)"
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => {
            setError(null);
            setFieldErrors({});
            save.mutate();
          }}
          disabled={
            save.isPending ||
            !form.name.trim() ||
            (isEdit && !form.sku.trim()) ||
            (form.isSerialized && missingColor) ||
            (paysForStock && form.paidBy === 'BANK' && !form.purchaseShopAccountId)
          }
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
