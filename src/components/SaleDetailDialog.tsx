import { useState } from 'react';
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
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import DescriptionIcon from '@mui/icons-material/Description';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useMoneyFormatter } from '../hooks/useSettings';
import RefundDialog from './RefundDialog';
import { PosApiError } from '@shared/errors';
import { SALE_STATUS_LABELS, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@shared/domain';
import { formatInstant } from '@shared/datetime';

/** Full sale view with print, PDF, cancel and refund (spec §44). */
export default function SaleDetailDialog({
  saleId,
  onClose,
  onChanged,
}: {
  saleId: string;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { can } = useAuth();
  const money = useMoneyFormatter();

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [refunding, setRefunding] = useState(false);

  const sale = useQuery({
    queryKey: ['sale', saleId],
    queryFn: () => api.sales.get({ saleId }),
  });

  const printers = useQuery({
    queryKey: ['printers'],
    queryFn: () => api.print.listPrinters(),
    staleTime: 5 * 60_000,
  });

  const [printer, setPrinter] = useState('');

  const print = useMutation({
    mutationFn: (format: 'A4' | 'RECEIPT') =>
      api.print.sale({
        saleId,
        format,
        deviceName: printer || undefined,
        // Show the Windows dialog when no printer has been chosen, so the user
        // is never left guessing where a document went.
        silent: Boolean(printer),
        reprint: true,
      }),
    onSuccess: () => setInfo('Sent to the printer.'),
    onError: (err) =>
      setError(err instanceof PosApiError ? err.message : 'Unable to print.'),
  });

  const savePdf = useMutation({
    mutationFn: () => api.print.savePdf({ saleId, format: 'A4', chooseLocation: true }),
    onSuccess: (result) => {
      if (result.saved) setInfo(`Saved to ${result.path}`);
    },
    onError: (err) =>
      setError(err instanceof PosApiError ? err.message : 'Unable to save the PDF.'),
  });

  const cancel = useMutation({
    mutationFn: () => api.sales.cancel({ saleId, reason: cancelReason.trim() }),
    onSuccess: () => {
      setCancelling(false);
      setCancelReason('');
      void sale.refetch();
      onChanged('Sale cancelled. Stock and IMEI numbers have been restored.');
    },
    onError: (err) =>
      setError(err instanceof PosApiError ? err.message : 'Unable to cancel this sale.'),
  });

  const data = sale.data;
  const header = data?.sale;
  const canRefund =
    header && can('sales.refund') && header.status !== 'CANCELLED' && header.status !== 'REFUNDED';
  const canCancel = header && can('sales.cancel') && header.status === 'COMPLETED';

  return (
    <Dialog open fullWidth maxWidth="md" onClose={onClose}>
      <DialogTitle>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <span>Invoice {header?.invoiceNumber ?? '…'}</span>
          {header && (
            <Chip
              size="small"
              label={SALE_STATUS_LABELS[header.status]}
              color={
                header.status === 'COMPLETED'
                  ? 'success'
                  : header.status === 'CANCELLED'
                    ? 'default'
                    : header.status === 'REFUNDED'
                      ? 'error'
                      : 'warning'
              }
            />
          )}
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {sale.isLoading && <Typography color="text.secondary">Loading…</Typography>}

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

        {data && header && (
          <Stack spacing={2.5}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 2,
              }}
            >
              <Field label="Date" value={formatInstant(header.saleDate)} />
              <Field label="Cashier" value={header.cashierName ?? '—'} />
              <Field label="Customer" value={header.customerName} />
              <Field label="Phone" value={header.customerPhone ?? '—'} />
            </Box>

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Product</TableCell>
                  <TableCell align="right">Qty</TableCell>
                  <TableCell align="right">Unit price</TableCell>
                  <TableCell align="right">Discount</TableCell>
                  <TableCell align="right">Tax</TableCell>
                  <TableCell align="right">Total</TableCell>
                  <TableCell align="right">Returned</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      {item.productName}
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {item.sku}
                        {item.serials ? ` · IMEI ${item.serials}` : ''}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{item.quantity}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {money(item.unitPrice)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {item.discountAmount > 0 ? `-${money(item.discountAmount)}` : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {item.taxAmount > 0 ? money(item.taxAmount) : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {money(item.totalAmount)}
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'text.secondary' }}>
                      {item.returnedQuantity > 0 ? item.returnedQuantity : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Payments
                </Typography>
                {data.payments.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    No payment recorded.
                  </Typography>
                )}
                {data.payments.map((payment) => (
                  <Stack key={payment.id} direction="row" spacing={1}>
                    <Typography variant="body2" sx={{ flexGrow: 1 }}>
                      {PAYMENT_METHOD_LABELS[payment.paymentMethod as PaymentMethod] ??
                        payment.paymentMethod}
                      {payment.referenceNumber ? ` (${payment.referenceNumber})` : ''}
                    </Typography>
                    <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {money(payment.amount)}
                    </Typography>
                  </Stack>
                ))}
              </Box>

              <Box sx={{ flex: 1 }}>
                <Stack spacing={0.5}>
                  <Row label="Subtotal" value={money(header.subtotal)} />
                  {header.discountAmount > 0 && (
                    <Row label="Discount" value={`-${money(header.discountAmount)}`} />
                  )}
                  <Row label="Tax" value={money(header.taxAmount)} />
                  <Divider sx={{ my: 0.5 }} />
                  <Row label="Grand total" value={money(header.grandTotal)} bold />
                  <Row label="Received" value={money(header.amountPaid)} />
                  {header.changeAmount > 0 && (
                    <Row label="Change" value={money(header.changeAmount)} />
                  )}
                  {header.refundedAmount > 0 && (
                    <Row label="Refunded" value={`-${money(header.refundedAmount)}`} />
                  )}
                </Stack>
              </Box>
            </Stack>

            {header.notes && (
              <Alert severity="info" icon={<DescriptionIcon />}>
                {header.notes}
              </Alert>
            )}

            <Divider />

            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <TextField
                select
                label="Printer"
                value={printer}
                onChange={(e) => setPrinter(e.target.value)}
                sx={{ maxWidth: 260 }}
                helperText={printer ? 'Prints straight away' : 'Shows the Windows print dialog'}
              >
                <MenuItem value="">Ask me (print dialog)</MenuItem>
                {(printers.data ?? []).map((p) => (
                  <MenuItem key={p.name} value={p.name}>
                    {p.displayName}
                    {p.isDefault ? ' (default)' : ''}
                  </MenuItem>
                ))}
              </TextField>

              <Button
                startIcon={<PrintIcon />}
                onClick={() => print.mutate('RECEIPT')}
                disabled={print.isPending}
              >
                Receipt
              </Button>
              <Button
                startIcon={<PrintIcon />}
                onClick={() => print.mutate('A4')}
                disabled={print.isPending}
              >
                A4 Invoice
              </Button>
              <Button
                startIcon={<PictureAsPdfIcon />}
                onClick={() => savePdf.mutate()}
                disabled={savePdf.isPending}
              >
                Save PDF
              </Button>
            </Stack>

            {cancelling && (
              <Stack spacing={1.5}>
                <Alert severity="warning">
                  Cancelling returns every item to stock and releases any IMEI numbers. The invoice
                  is kept and marked cancelled — financial records are never deleted.
                </Alert>
                <TextField
                  label="Reason for cancelling"
                  required
                  autoFocus
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    color="error"
                    onClick={() => {
                      setError(null);
                      cancel.mutate();
                    }}
                    disabled={cancel.isPending || !cancelReason.trim()}
                  >
                    {cancel.isPending ? 'Cancelling…' : 'Confirm cancellation'}
                  </Button>
                  <Button onClick={() => setCancelling(false)}>Keep the sale</Button>
                </Stack>
              </Stack>
            )}
          </Stack>
        )}
      </DialogContent>

      <DialogActions>
        {canCancel && !cancelling && (
          <Button color="error" onClick={() => setCancelling(true)}>
            Cancel sale
          </Button>
        )}
        {canRefund && (
          <Button color="warning" onClick={() => setRefunding(true)}>
            Refund
          </Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onClose}>Close</Button>
      </DialogActions>

      {refunding && data && (
        <RefundDialog
          sale={data}
          onClose={() => setRefunding(false)}
          onRefunded={(message) => {
            setRefunding(false);
            void sale.refetch();
            onChanged(message);
          }}
        />
      )}
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {value}
      </Typography>
    </Box>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <Stack direction="row">
      <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
        {label}
      </Typography>
      <Typography
        variant={bold ? 'subtitle1' : 'body2'}
        sx={{ fontWeight: bold ? 700 : 400, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Typography>
    </Stack>
  );
}
