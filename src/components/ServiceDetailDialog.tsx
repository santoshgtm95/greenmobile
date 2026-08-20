import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useMoneyFormatter } from '../hooks/useSettings';
import MoneyField from './MoneyField';
import ServicePartPicker from './ServicePartPicker';
import { PosApiError } from '@shared/errors';
import {
  SERVICE_STATUS_LABELS,
  SERVICE_STATUS_TRANSITIONS,
  SERVICE_ITEM_TYPE_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  type ServiceItemType,
  type ServiceStatus,
} from '@shared/domain';
import { formatInstant } from '@shared/datetime';

/** Full job sheet: diagnosis, parts, labour, payments, status and printing. */
export default function ServiceDetailDialog({
  serviceOrderId,
  onClose,
  onChanged,
}: {
  serviceOrderId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { can } = useAuth();
  const money = useMoneyFormatter();

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState('');
  const [partPickerOpen, setPartPickerOpen] = useState(false);

  const [newItem, setNewItem] = useState({
    description: '',
    quantity: 1,
    sellingPrice: 0,
    type: 'LABOR' as ServiceItemType,
  });
  const [payment, setPayment] = useState({
    amount: 0,
    paymentMethod: 'CASH' as PaymentMethod,
    referenceNumber: '',
  });

  const job = useQuery({
    queryKey: ['service', serviceOrderId],
    queryFn: () => api.services.get({ serviceOrderId }),
  });

  const detail = job.data;
  const order = detail?.order;
  const editable = order ? order.status !== 'DELIVERED' && order.status !== 'CANCELLED' : false;
  const manage = can('services.manage');

  // Follow the server's diagnosis unless the user is mid-edit.
  useEffect(() => {
    if (order && diagnosis === '') setDiagnosis(order.diagnosis ?? '');
  }, [order?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const succeed = (message: string) => {
    setError(null);
    setInfo(message);
    void job.refetch();
    onChanged();
  };
  const fail = (fallback: string) => (err: unknown) => {
    setInfo(null);
    setError(err instanceof PosApiError ? err.message : fallback);
  };

  const saveDiagnosis = useMutation({
    mutationFn: () => {
      if (!order) throw new Error('not loaded');
      return api.services.update({
        id: order.id,
        deviceBrand: order.deviceBrand,
        deviceModel: order.deviceModel,
        imei: order.imei ?? undefined,
        serialNumber: order.serialNumber ?? undefined,
        problemDescription: order.problemDescription,
        initialCondition: order.initialCondition ?? undefined,
        diagnosis: diagnosis.trim() || undefined,
        estimatedCost: order.estimatedCost,
        expectedDate: order.expectedDate ?? undefined,
        notes: order.notes ?? undefined,
      });
    },
    onSuccess: () => succeed('Diagnosis saved.'),
    onError: fail('Unable to save the diagnosis.'),
  });

  const addItem = useMutation({
    mutationFn: (input: { productId?: string; description: string; quantity: number; sellingPrice: number; type: ServiceItemType }) =>
      api.services.addItem({
        serviceOrderId,
        productId: input.productId,
        description: input.description,
        quantity: input.quantity,
        unitCost: 0,
        sellingPrice: input.sellingPrice,
        type: input.type,
      }),
    onSuccess: () => {
      setNewItem({ description: '', quantity: 1, sellingPrice: 0, type: 'LABOR' });
      succeed('Line added.');
    },
    onError: fail('Unable to add that line.'),
  });

  const removeItem = useMutation({
    mutationFn: (id: string) => api.services.removeItem({ id }),
    onSuccess: () => succeed('Line removed. Any parts have gone back into stock.'),
    onError: fail('Unable to remove that line.'),
  });

  const addPayment = useMutation({
    mutationFn: () =>
      api.services.addPayment({
        serviceOrderId,
        amount: payment.amount,
        paymentMethod: payment.paymentMethod,
        referenceNumber: payment.referenceNumber.trim() || undefined,
        notes: undefined,
      }),
    onSuccess: () => {
      setPayment({ amount: 0, paymentMethod: 'CASH', referenceNumber: '' });
      succeed('Payment recorded.');
    },
    onError: fail('Unable to record that payment.'),
  });

  const changeStatus = useMutation({
    mutationFn: (status: ServiceStatus) =>
      api.services.changeStatus({ serviceOrderId, status, note: undefined }),
    onSuccess: (result) =>
      succeed(`Job is now ${SERVICE_STATUS_LABELS[result.order.status].toLowerCase()}.`),
    onError: fail('Unable to change the status.'),
  });

  const printDoc = useMutation({
    mutationFn: (input: { kind: 'JOB_SHEET' | 'COMPLETION'; asPdf: boolean }) =>
      api.services.printDocument({
        serviceOrderId,
        kind: input.kind,
        asPdf: input.asPdf,
        silent: false,
        reprint: true,
      }),
    onSuccess: (result) =>
      setInfo(result.printed ? 'Sent to the printer.' : `Saved to ${result.path}`),
    onError: fail('Unable to produce that document.'),
  });

  const nextStatuses = order ? SERVICE_STATUS_TRANSITIONS[order.status] : [];

  return (
    <Dialog open fullWidth maxWidth="lg" onClose={onClose}>
      <DialogTitle>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <span>{order ? order.serviceNumber : 'Service job'}</span>
          {order && (
            <Chip size="small" color="primary" label={SERVICE_STATUS_LABELS[order.status]} />
          )}
          {order && order.balance > 0 && (
            <Chip size="small" color="error" label={`${money(order.balance)} owing`} />
          )}
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {job.isLoading && <Typography color="text.secondary">Loading…</Typography>}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {info && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setInfo(null)}>
            {info}
          </Alert>
        )}

        {detail && order && (
          <Stack spacing={2.5}>
            {/* Device and customer */}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: 2,
              }}
            >
              <Field label="Customer" value={order.customerName} />
              <Field label="Phone" value={order.customerPhone ?? '—'} />
              <Field label="Device" value={`${order.deviceBrand} ${order.deviceModel}`} />
              <Field label="IMEI" value={order.imei ?? '—'} mono />
              <Field label="Received" value={formatInstant(order.receivedDate)} />
              <Field
                label="Expected"
                value={order.expectedDate ? formatInstant(order.expectedDate) : 'To be advised'}
              />
            </Box>

            <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Reported fault
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                {order.problemDescription}
              </Typography>
              {order.initialCondition && (
                <>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mt: 1.5 }}
                  >
                    Condition on arrival
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                    {order.initialCondition}
                  </Typography>
                </>
              )}
            </Paper>

            {/* Diagnosis */}
            <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
              <TextField
                label="Diagnosis and work carried out"
                multiline
                minRows={2}
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                disabled={!editable || !manage}
                helperText="Prints on the completion receipt the customer takes away"
              />
              {editable && manage && (
                <Button
                  startIcon={<SaveIcon />}
                  onClick={() => saveDiagnosis.mutate()}
                  disabled={saveDiagnosis.isPending || diagnosis === (order.diagnosis ?? '')}
                  sx={{ mt: 0.25 }}
                >
                  Save
                </Button>
              )}
            </Stack>

            <Divider textAlign="left">
              <Typography variant="caption" color="text.secondary">
                Parts and labour
              </Typography>
            </Divider>

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Item</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell align="right">Qty</TableCell>
                  <TableCell align="right">Price</TableCell>
                  <TableCell align="right">Total</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {detail.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 2, color: 'text.secondary' }}>
                      Nothing charged yet.
                    </TableCell>
                  </TableRow>
                )}
                {detail.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      {item.description}
                      {item.productId && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          from stock
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" label={SERVICE_ITEM_TYPE_LABELS[item.type]} />
                    </TableCell>
                    <TableCell align="right">{item.quantity}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {money(item.sellingPrice)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {money(item.total)}
                    </TableCell>
                    <TableCell align="right">
                      {editable && manage && (
                        <Tooltip title="Remove (returns any part to stock)">
                          <IconButton
                            size="small"
                            onClick={() => removeItem.mutate(item.id)}
                            disabled={removeItem.isPending}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {editable && manage && (
              <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'flex-start' }}>
                  <Button variant="outlined" onClick={() => setPartPickerOpen(true)} sx={{ minWidth: 170 }}>
                    Add part from stock
                  </Button>

                  <Divider orientation="vertical" flexItem />

                  <TextField
                    label="Description"
                    value={newItem.description}
                    onChange={(e) => setNewItem((f) => ({ ...f, description: e.target.value }))}
                  />
                  <TextField
                    select
                    label="Type"
                    value={newItem.type}
                    onChange={(e) =>
                      setNewItem((f) => ({ ...f, type: e.target.value as ServiceItemType }))
                    }
                    sx={{ minWidth: 120 }}
                  >
                    <MenuItem value="LABOR">Labour</MenuItem>
                    <MenuItem value="OTHER">Other</MenuItem>
                  </TextField>
                  <TextField
                    label="Qty"
                    type="number"
                    value={newItem.quantity}
                    onChange={(e) =>
                      setNewItem((f) => ({ ...f, quantity: Math.max(1, Number(e.target.value) || 1) }))
                    }
                    sx={{ maxWidth: 90 }}
                  />
                  <MoneyField
                    label="Charge"
                    value={newItem.sellingPrice}
                    onChange={(v) => setNewItem((f) => ({ ...f, sellingPrice: v }))}
                  />
                  <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() =>
                      addItem.mutate({
                        description: newItem.description.trim(),
                        quantity: newItem.quantity,
                        sellingPrice: newItem.sellingPrice,
                        type: newItem.type,
                      })
                    }
                    disabled={
                      addItem.isPending || !newItem.description.trim() || newItem.sellingPrice <= 0
                    }
                    sx={{ mt: 0.25 }}
                  >
                    Add
                  </Button>
                </Stack>
              </Paper>
            )}

            {/* Money */}
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Payments
                </Typography>
                {detail.payments.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    Nothing taken yet.
                  </Typography>
                )}
                {detail.payments.map((p) => (
                  <Stack key={p.id} direction="row" spacing={1}>
                    <Typography variant="body2" sx={{ flexGrow: 1 }}>
                      {formatInstant(p.paymentDate)} ·{' '}
                      {PAYMENT_METHOD_LABELS[p.paymentMethod as PaymentMethod] ?? p.paymentMethod}
                      {p.isDeposit === 1 ? ' (deposit)' : ''}
                    </Typography>
                    <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {money(p.amount)}
                    </Typography>
                  </Stack>
                ))}

                {editable && manage && order.balance > 0 && (
                  <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'flex-start' }}>
                    <MoneyField
                      label="Take payment"
                      value={payment.amount}
                      onChange={(v) => setPayment((f) => ({ ...f, amount: v }))}
                    />
                    <TextField
                      select
                      label="Method"
                      value={payment.paymentMethod}
                      onChange={(e) =>
                        setPayment((f) => ({ ...f, paymentMethod: e.target.value as PaymentMethod }))
                      }
                      sx={{ minWidth: 150 }}
                    >
                      {PAYMENT_METHODS.map((method) => (
                        <MenuItem key={method} value={method}>
                          {PAYMENT_METHOD_LABELS[method]}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Button
                      variant="contained"
                      onClick={() => addPayment.mutate()}
                      disabled={addPayment.isPending || payment.amount <= 0}
                      sx={{ mt: 0.25 }}
                    >
                      Record
                    </Button>
                  </Stack>
                )}
              </Box>

              <Box sx={{ flex: 1 }}>
                <Stack spacing={0.5}>
                  <Row label="Estimate given" value={money(order.estimatedCost)} />
                  <Row label="Parts cost" value={money(order.partsCost)} />
                  <Divider sx={{ my: 0.5 }} />
                  <Row label="Total charge" value={money(order.finalCost)} bold />
                  <Row label="Paid" value={money(order.amountPaid)} />
                  {order.balance > 0 ? (
                    <Row label="Still owing" value={money(order.balance)} bold tone="error" />
                  ) : (
                    <Row label="Settled" value={money(order.finalCost)} tone="success" />
                  )}
                </Stack>
              </Box>
            </Stack>

            {order.notes && (
              <Alert severity="info" sx={{ whiteSpace: 'pre-line' }}>
                {order.notes}
              </Alert>
            )}

            <Divider textAlign="left">
              <Typography variant="caption" color="text.secondary">
                Documents and status
              </Typography>
            </Divider>

            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              <Button
                startIcon={<PrintIcon />}
                onClick={() => printDoc.mutate({ kind: 'JOB_SHEET', asPdf: false })}
                disabled={printDoc.isPending}
              >
                Job sheet
              </Button>
              <Button
                startIcon={<PrintIcon />}
                onClick={() => printDoc.mutate({ kind: 'COMPLETION', asPdf: false })}
                disabled={printDoc.isPending}
              >
                Completion receipt
              </Button>
              <Button
                startIcon={<PictureAsPdfIcon />}
                onClick={() => printDoc.mutate({ kind: 'COMPLETION', asPdf: true })}
                disabled={printDoc.isPending}
              >
                Save PDF
              </Button>
            </Stack>

            {manage && nextStatuses.length > 0 && (
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                {nextStatuses.map((next) => (
                  <Button
                    key={next}
                    variant={next === 'CANCELLED' ? 'outlined' : 'contained'}
                    color={next === 'CANCELLED' ? 'error' : next === 'DELIVERED' ? 'success' : 'primary'}
                    onClick={() => changeStatus.mutate(next)}
                    disabled={changeStatus.isPending}
                  >
                    {next === 'CANCELLED' ? 'Cancel job' : `Mark ${SERVICE_STATUS_LABELS[next]}`}
                  </Button>
                ))}
              </Stack>
            )}

            {nextStatuses.length === 0 && (
              <Alert severity="info">
                This job is {SERVICE_STATUS_LABELS[order.status].toLowerCase()} and is now a closed
                record. Its documents can still be reprinted.
              </Alert>
            )}
          </Stack>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>

      {partPickerOpen && (
        <ServicePartPicker
          onClose={() => setPartPickerOpen(false)}
          onPick={(product, quantity) => {
            setPartPickerOpen(false);
            addItem.mutate({
              productId: product.id,
              description: product.name,
              quantity,
              sellingPrice: product.sellingPrice,
              type: 'PART',
            });
          }}
        />
      )}
    </Dialog>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: mono ? 'monospace' : undefined }}>
        {value}
      </Typography>
    </Box>
  );
}

function Row({
  label,
  value,
  bold,
  tone,
}: {
  label: string;
  value: string;
  bold?: boolean;
  tone?: 'error' | 'success';
}) {
  return (
    <Stack direction="row">
      <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
        {label}
      </Typography>
      <Typography
        variant={bold ? 'subtitle1' : 'body2'}
        sx={{
          fontWeight: bold ? 700 : 400,
          fontVariantNumeric: 'tabular-nums',
          color: tone ? `${tone}.main` : 'inherit',
        }}
      >
        {value}
      </Typography>
    </Stack>
  );
}
