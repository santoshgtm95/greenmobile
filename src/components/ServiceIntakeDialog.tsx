import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import MoneyField from './MoneyField';
import CustomerPickerDialog, { type PickedCustomer } from './CustomerPickerDialog';
import { PosApiError } from '@shared/errors';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@shared/domain';

/**
 * Taking a device in (spec §52 step 1).
 *
 * The condition-on-arrival field matters more than it looks: it is the shop's
 * record of what the device was like before anyone opened it, and it prints on
 * the job sheet the customer signs.
 */
export default function ServiceIntakeDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (serviceOrderId: string) => void;
}) {
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [form, setForm] = useState({
    customerName: '',
    customerPhone: '',
    deviceBrand: '',
    deviceModel: '',
    imei: '',
    serialNumber: '',
    problemDescription: '',
    initialCondition: '',
    estimatedCost: 0,
    expectedDate: '',
    depositAmount: 0,
    depositMethod: 'CASH' as PaymentMethod,
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const create = useMutation({
    mutationFn: () =>
      api.services.create({
        customerId: customer?.id,
        customerName: customer ? undefined : form.customerName.trim() || undefined,
        customerPhone: customer ? undefined : form.customerPhone.trim() || undefined,
        deviceBrand: form.deviceBrand.trim(),
        deviceModel: form.deviceModel.trim(),
        imei: form.imei.trim() || undefined,
        serialNumber: form.serialNumber.trim() || undefined,
        problemDescription: form.problemDescription.trim(),
        initialCondition: form.initialCondition.trim() || undefined,
        estimatedCost: form.estimatedCost,
        // A date input gives YYYY-MM-DD; anchor it at midday so the instant and
        // the day never disagree about which day it is.
        expectedDate: form.expectedDate
          ? new Date(`${form.expectedDate}T12:00:00`).toISOString()
          : undefined,
        notes: form.notes.trim() || undefined,
        depositAmount: form.depositAmount,
        depositMethod: form.depositMethod,
      }),
    onSuccess: (detail) => onCreated(detail.order.id),
    onError: (err) => {
      if (err instanceof PosApiError) {
        setError(err.message);
        setFieldErrors(err.fields ?? {});
      } else {
        setError('Unable to create this service job.');
      }
    },
  });

  const canSubmit =
    form.deviceBrand.trim() &&
    form.deviceModel.trim() &&
    form.problemDescription.trim() &&
    (customer || form.customerName.trim());

  return (
    <Dialog open fullWidth maxWidth="md" onClose={onClose}>
      <DialogTitle>Receive a device for repair</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Divider textAlign="left">
            <Typography variant="caption" color="text.secondary">
              Customer
            </Typography>
          </Divider>

          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Button
              variant="outlined"
              startIcon={<PersonIcon />}
              onClick={() => setPickerOpen(true)}
              sx={{ minWidth: 220, justifyContent: 'flex-start' }}
            >
              {customer ? customer.name : 'Choose an existing customer'}
            </Button>
            {customer && (
              <>
                <Typography variant="body2" color="text.secondary">
                  {customer.phone ?? 'No phone on record'}
                </Typography>
                <Button size="small" color="inherit" onClick={() => setCustomer(null)}>
                  Clear
                </Button>
              </>
            )}
          </Stack>

          {!customer && (
            <Stack direction="row" spacing={2}>
              <TextField
                label="Customer name"
                required
                value={form.customerName}
                onChange={(e) => set('customerName', e.target.value)}
                helperText="Or pick an existing customer above"
              />
              <TextField
                label="Phone"
                value={form.customerPhone}
                onChange={(e) => set('customerPhone', e.target.value)}
                error={Boolean(fieldErrors.customerPhone)}
                helperText={fieldErrors.customerPhone ?? 'How you will reach them when it is ready'}
              />
            </Stack>
          )}

          <Divider textAlign="left">
            <Typography variant="caption" color="text.secondary">
              Device
            </Typography>
          </Divider>

          <Stack direction="row" spacing={2}>
            <TextField
              label="Brand"
              required
              autoFocus
              value={form.deviceBrand}
              onChange={(e) => set('deviceBrand', e.target.value)}
              error={Boolean(fieldErrors.deviceBrand)}
              helperText={fieldErrors.deviceBrand}
            />
            <TextField
              label="Model"
              required
              value={form.deviceModel}
              onChange={(e) => set('deviceModel', e.target.value)}
              error={Boolean(fieldErrors.deviceModel)}
              helperText={fieldErrors.deviceModel}
            />
          </Stack>

          <Stack direction="row" spacing={2}>
            <TextField
              label="IMEI"
              value={form.imei}
              onChange={(e) => set('imei', e.target.value)}
              error={Boolean(fieldErrors.imei)}
              helperText={fieldErrors.imei ?? 'Scan or type — makes the device findable later'}
            />
            <TextField
              label="Serial number"
              value={form.serialNumber}
              onChange={(e) => set('serialNumber', e.target.value)}
              error={Boolean(fieldErrors.serialNumber)}
              helperText={fieldErrors.serialNumber}
            />
          </Stack>

          <TextField
            label="Reported fault"
            required
            multiline
            minRows={2}
            value={form.problemDescription}
            onChange={(e) => set('problemDescription', e.target.value)}
            error={Boolean(fieldErrors.problemDescription)}
            helperText={fieldErrors.problemDescription ?? 'In the customer’s own words where possible'}
          />

          <TextField
            label="Condition on arrival"
            multiline
            minRows={2}
            value={form.initialCondition}
            onChange={(e) => set('initialCondition', e.target.value)}
            helperText="Existing scratches, cracks, missing parts. This prints on the job sheet the customer signs."
          />

          <Divider textAlign="left">
            <Typography variant="caption" color="text.secondary">
              Estimate and deposit
            </Typography>
          </Divider>

          <Stack direction="row" spacing={2}>
            <MoneyField
              label="Estimated cost"
              value={form.estimatedCost}
              onChange={(v) => set('estimatedCost', v)}
              helperText="Quoted to the customer; the final charge comes from the parts and labour added later"
            />
            <TextField
              label="Expected ready"
              type="date"
              value={form.expectedDate}
              onChange={(e) => set('expectedDate', e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>

          <Stack direction="row" spacing={2}>
            <MoneyField
              label="Deposit taken"
              value={form.depositAmount}
              onChange={(v) => set('depositAmount', v)}
              helperText="Leave at zero if nothing was paid up front"
            />
            {form.depositAmount > 0 && (
              <TextField
                select
                label="Deposit paid by"
                value={form.depositMethod}
                onChange={(e) => set('depositMethod', e.target.value as PaymentMethod)}
              >
                {PAYMENT_METHODS.map((method) => (
                  <MenuItem key={method} value={method}>
                    {PAYMENT_METHOD_LABELS[method]}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Stack>

          <TextField
            label="Internal notes"
            multiline
            minRows={2}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            helperText="For the workshop — also prints on the documents"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => {
            setError(null);
            setFieldErrors({});
            create.mutate();
          }}
          disabled={create.isPending || !canSubmit}
        >
          {create.isPending ? 'Creating…' : 'Create job & print sheet'}
        </Button>
      </DialogActions>

      {pickerOpen && (
        <CustomerPickerDialog
          onClose={() => setPickerOpen(false)}
          onPick={(picked) => {
            setCustomer(picked);
            setPickerOpen(false);
          }}
        />
      )}
    </Dialog>
  );
}
