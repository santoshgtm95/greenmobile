import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import MoneyField from './MoneyField';
import { PosApiError } from '@shared/errors';
import { formatRate, parseRate } from '@shared/money';
import { PRODUCT_UNITS } from '@shared/domain';
import type { Lookup, Product } from '@shared/api';

/** Product form (spec §40). `product === null` means "create". */
export default function ProductDialog({
  product,
  categories,
  brands,
  onClose,
  onSaved,
}: {
  product: Product | null;
  categories: Lookup[];
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
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: async () => {
      const common = {
        sku: form.sku.trim(),
        barcode: form.barcode.trim() || undefined,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        categoryId: form.categoryId || undefined,
        brandId: form.brandId || undefined,
        purchasePrice: form.purchasePrice,
        sellingPrice: form.sellingPrice,
        taxRate: form.taxRate,
        taxRateOverride: form.taxRateOverride,
        minimumStock: form.minimumStock,
        unit: form.unit,
        isSerialized: form.isSerialized,
        warrantyMonths: form.warrantyMonths,
      };

      if (isEdit) {
        return api.products.update({ ...common, id: product.id, isActive: form.isActive });
      }
      return api.products.create({
        ...common,
        initialStock: form.isSerialized ? 0 : form.initialStock,
        serials: undefined,
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
              label="SKU"
              required
              value={form.sku}
              onChange={(e) => set('sku', e.target.value)}
              error={Boolean(fieldErrors.sku)}
              helperText={fieldErrors.sku ?? 'Your own product code — must be unique'}
            />
            <TextField
              label="Barcode"
              value={form.barcode}
              onChange={(e) => set('barcode', e.target.value)}
              error={Boolean(fieldErrors.barcode)}
              helperText={fieldErrors.barcode ?? 'Scan into this field if you have a scanner'}
            />
          </Stack>

          <Stack direction="row" spacing={2}>
            <TextField
              select
              label="Category"
              value={form.categoryId}
              onChange={(e) => set('categoryId', e.target.value)}
            >
              <MenuItem value="">None</MenuItem>
              {categories.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
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
            <TextField
              label="Minimum stock"
              type="number"
              value={form.minimumStock}
              onChange={(e) => set('minimumStock', Math.max(0, Number(e.target.value) || 0))}
              helperText="Warn at or below this level"
            />
            <TextField select label="Unit" value={form.unit} onChange={(e) => set('unit', e.target.value)}>
              {PRODUCT_UNITS.map((u) => (
                <MenuItem key={u} value={u}>
                  {u}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          {isEdit && (
            <Alert severity="info">
              Stock is changed through stock adjustments and IMEI records, not on this form, so
              every movement keeps its reason in the inventory history.
            </Alert>
          )}

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

          {form.isSerialized && (
            <Alert severity="info">
              {isEdit
                ? 'Add IMEI or serial numbers from the product list — each one is a unit of stock.'
                : 'Save the product first, then add its IMEI or serial numbers. Each one counts as a unit of stock.'}
            </Alert>
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
          disabled={save.isPending || !form.name.trim() || !form.sku.trim()}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
