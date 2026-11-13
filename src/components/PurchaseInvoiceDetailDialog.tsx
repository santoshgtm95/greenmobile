import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  IconButton,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn';
import PaymentsIcon from '@mui/icons-material/Payments';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useMoneyFormatter } from '../hooks/useSettings';
import MoneyField from './MoneyField';
import ShopAccountSelect from './ShopAccountSelect';
import CashInHandBox from './CashInHandBox';
import DeleteReasonDialog from './DeleteReasonDialog';
import PurchaseInvoiceDialog from './PurchaseInvoiceDialog';
import { PosApiError } from '@shared/errors';
import { formatInstant, nowLocalDateTime } from '@shared/datetime';
import { PURCHASE_PAYMENT_LABELS } from '@shared/domain';
import type { PurchaseInvoiceDetail, PurchaseInvoiceItem, SupplierPayment } from '@shared/api';

function lineStatus(item: PurchaseInvoiceItem): { label: string; color: 'default' | 'success' | 'warning' | 'info' | 'error' } {
  if (item.pendingQty === 0 && item.receivedQty === 0) return { label: 'Refunded', color: 'error' };
  if (item.pendingQty === 0) return { label: 'Delivered', color: 'success' };
  if (item.receivedQty === 0 && item.refundedQty === 0 && item.replacedQty === 0) return { label: 'Ordered', color: 'default' };
  if (item.replacedQty > 0) return { label: 'Awaiting replacement', color: 'info' };
  return { label: 'Partly delivered', color: 'warning' };
}

const errorText = (err: unknown, fallback: string) => (err instanceof PosApiError ? err.message : fallback);
/** One IMEI / serial per line or comma; blanks ignored. */
const parseCodes = (text: string) => text.split(/[\s,]+/).map((c) => c.trim()).filter(Boolean);

/** One purchase invoice: deliver, return, pay, edit. */
export default function PurchaseInvoiceDetailDialog({
  invoiceId,
  onClose,
  onChanged,
}: {
  invoiceId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { can } = useAuth();
  const money = useMoneyFormatter();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['purchaseInvoice', invoiceId], queryFn: () => api.purchases.get({ id: invoiceId }) });

  const [selected, setSelected] = useState<string[]>([]);
  const [receiving, setReceiving] = useState<PurchaseInvoiceItem[] | null>(null);
  const [returning, setReturning] = useState<PurchaseInvoiceItem | null>(null);
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingLine, setDeletingLine] = useState<PurchaseInvoiceItem | null>(null);
  const [deletingPayment, setDeletingPayment] = useState<SupplierPayment | null>(null);

  const changed = (invoice: PurchaseInvoiceDetail) => {
    queryClient.setQueryData(['purchaseInvoice', invoiceId], invoice);
    setSelected([]);
    onChanged();
  };

  const invoice = detail.data;
  const manage = can('products.manage');
  const canDelete = can('products.delete');
  const pending = invoice?.items.filter((i) => i.pendingQty > 0) ?? [];
  const untouched =
    invoice?.items.every((i) => !i.receivedQty && !i.refundedQty && !i.replacedQty) && invoice.payments.length === 0;

  return (
    <Dialog open fullWidth maxWidth="lg" onClose={onClose}>
      <DialogTitle>
        Purchase invoice {invoice?.invoiceNo}
        {invoice && (
          <Typography variant="body2" color="text.secondary">
            {invoice.supplierName} · {formatInstant(invoice.invoiceDate)} · {PURCHASE_PAYMENT_LABELS[invoice.paymentMethod]}
            {invoice.createdByName && ` · by ${invoice.createdByName}`}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers>
        {detail.isError && <Alert severity="error">{errorText(detail.error, 'Unable to load this invoice.')}</Alert>}
        {invoice && (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <Chip label={`Total ${money(invoice.total)}`} />
              <Chip color="success" variant="outlined" label={`Paid ${money(invoice.paid)}`} />
              <Chip
                color={invoice.remaining > 0 ? 'warning' : invoice.remaining < 0 ? 'info' : 'success'}
                label={invoice.remaining < 0 ? `Supplier owes ${money(-invoice.remaining)}` : `Remaining ${money(invoice.remaining)}`}
              />
              {invoice.remark && (
                <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                  {invoice.remark}
                </Typography>
              )}
            </Stack>

            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                Products
              </Typography>
              {manage && pending.length > 0 && (
                <>
                  <Button
                    size="small"
                    startIcon={<LocalShippingIcon />}
                    disabled={selected.length === 0}
                    onClick={() => setReceiving(pending.filter((i) => selected.includes(i.id)))}
                  >
                    Deliver selected ({selected.length})
                  </Button>
                  <Button size="small" variant="contained" startIcon={<LocalShippingIcon />} onClick={() => setReceiving(pending)}>
                    Deliver all
                  </Button>
                </>
              )}
            </Stack>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell>Product</TableCell>
                  <TableCell align="right">Ordered</TableCell>
                  <TableCell align="right">Arrived</TableCell>
                  <TableCell align="right">Refunded</TableCell>
                  <TableCell align="right">Waiting</TableCell>
                  <TableCell align="right">Unit cost</TableCell>
                  <TableCell align="right">Selling price</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {invoice.items.map((item) => {
                  const status = lineStatus(item);
                  return (
                    <TableRow key={item.id} hover>
                      <TableCell padding="checkbox">
                        {manage && item.pendingQty > 0 && (
                          <Checkbox
                            size="small"
                            checked={selected.includes(item.id)}
                            onChange={(e) =>
                              setSelected((s) => (e.target.checked ? [...s, item.id] : s.filter((id) => id !== item.id)))
                            }
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {item.productName}
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {item.sku}
                          {item.isSerialized ? ' · IMEI tracked' : ''}
                          {item.newProduct && ' · new product, added to Stocks on delivery'}
                          {item.replacedQty > 0 && ` · ${item.replacedQty} sent back for replacement`}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">{item.quantity}</TableCell>
                      <TableCell align="right">{item.receivedQty}</TableCell>
                      <TableCell align="right">{item.refundedQty || ''}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: item.pendingQty ? 700 : undefined }}>
                        {item.pendingQty || ''}
                      </TableCell>
                      <TableCell align="right">{money(item.unitCost)}</TableCell>
                      <TableCell align="right">{money(item.sellingPrice)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {money((item.quantity - item.refundedQty) * item.unitCost)}
                      </TableCell>
                      <TableCell>
                        <Chip size="small" color={status.color} label={status.label} />
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        {manage && item.pendingQty > 0 && (
                          <Button size="small" onClick={() => setReceiving([item])}>
                            Delivered
                          </Button>
                        )}
                        {manage && (item.pendingQty > 0 || item.receivedQty > 0) && (
                          <Button size="small" color="error" startIcon={<AssignmentReturnIcon />} onClick={() => setReturning(item)}>
                            Return
                          </Button>
                        )}
                        {canDelete && invoice.items.length > 1 && !item.receivedQty && !item.refundedQty && !item.replacedQty && (
                          <IconButton size="small" color="error" aria-label="Remove product" onClick={() => setDeletingLine(item)}>
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', pt: 1 }}>
              <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                Payments
              </Typography>
              {manage && invoice.remaining > 0 && (
                <Button size="small" variant="contained" startIcon={<PaymentsIcon />} onClick={() => setPaying(true)}>
                  Pay supplier
                </Button>
              )}
            </Stack>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date and time</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell>Cash / account</TableCell>
                  <TableCell>Notes</TableCell>
                  <TableCell>By</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {invoice.payments.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ color: 'text.secondary' }}>
                      Nothing paid yet.
                    </TableCell>
                  </TableRow>
                )}
                {invoice.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{formatInstant(p.paidAt)}</TableCell>
                    <TableCell align="right" sx={{ color: p.amount < 0 ? 'success.main' : undefined, fontWeight: 600 }}>
                      {p.amount < 0 ? `Refund +${money(-p.amount)}` : `−${money(p.amount)}`}
                    </TableCell>
                    <TableCell>{p.accountLabel ?? 'Cash in hand'}</TableCell>
                    <TableCell>{p.notes}</TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{p.createdByName}</TableCell>
                    <TableCell align="right" padding="checkbox">
                      {canDelete && (
                        <IconButton size="small" color="error" aria-label="Delete payment" onClick={() => setDeletingPayment(p)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {invoice && can('products.delete') && untouched && (
          <Button color="error" startIcon={<DeleteOutlineIcon />} onClick={() => setDeleting(true)}>
            Delete
          </Button>
        )}
        {invoice && manage && (
          <Button startIcon={<EditIcon />} onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onClose}>Close</Button>
      </DialogActions>

      {invoice && receiving && (
        <ReceiveDialog
          invoice={invoice}
          items={receiving}
          onClose={() => setReceiving(null)}
          onDone={(next) => {
            setReceiving(null);
            changed(next);
          }}
        />
      )}
      {invoice && returning && (
        <ReturnDialog
          invoice={invoice}
          item={returning}
          onClose={() => setReturning(null)}
          onDone={(next) => {
            setReturning(null);
            changed(next);
          }}
        />
      )}
      {invoice && paying && (
        <PayDialog
          invoice={invoice}
          onClose={() => setPaying(false)}
          onDone={(next) => {
            setPaying(false);
            changed(next);
          }}
        />
      )}
      {invoice && editing && (
        <PurchaseInvoiceDialog
          invoice={invoice}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            setEditing(false);
            changed(next);
          }}
        />
      )}
      {invoice && deleting && (
        <DeleteReasonDialog
          title={`Delete purchase invoice ${invoice.invoiceNo}?`}
          message="It stays in the records, marked deleted, and leaves the invoice list."
          onConfirm={(reason) =>
            api.purchases.delete({ id: invoice.id, reason }).then(() => {
              onChanged();
              onClose();
            })
          }
          onClose={() => setDeleting(false)}
        />
      )}
      {deletingLine && (
        <DeleteReasonDialog
          title={`Remove ${deletingLine.productName} from this invoice?`}
          message="It is no longer ordered or owed on this invoice."
          onConfirm={(reason) => api.purchases.deleteItem({ id: deletingLine.id, reason }).then(changed)}
          onClose={() => setDeletingLine(null)}
        />
      )}
      {deletingPayment && (
        <DeleteReasonDialog
          title={deletingPayment.amount < 0 ? 'Delete this refund?' : 'Delete this payment?'}
          message={
            deletingPayment.amount < 0
              ? `${money(-deletingPayment.amount)} goes back out of ${deletingPayment.accountLabel ?? 'cash in hand'}.`
              : `${money(deletingPayment.amount)} comes back into ${deletingPayment.accountLabel ?? 'cash in hand'}.`
          }
          onConfirm={(reason) => api.purchases.deletePayment({ id: deletingPayment.id, reason }).then(changed)}
          onClose={() => setDeletingPayment(null)}
        />
      )}
    </Dialog>
  );
}

/** Arrived products go into stock; IMEI-tracked ones need one code per unit. */
function ReceiveDialog({
  invoice,
  items,
  onClose,
  onDone,
}: {
  invoice: PurchaseInvoiceDetail;
  items: PurchaseInvoiceItem[];
  onClose: () => void;
  onDone: (invoice: PurchaseInvoiceDetail) => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((i) => [i.id, i.pendingQty])),
  );
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const entries = items
    .map((i) => {
      const serials = i.isSerialized ? parseCodes(codes[i.id] ?? '') : undefined;
      return { itemId: i.id, quantity: serials ? serials.length : (quantities[i.id] ?? 0), serials };
    })
    .filter((e) => e.quantity > 0);
  const tooMany = items.some((i) => (entries.find((e) => e.itemId === i.id)?.quantity ?? 0) > i.pendingQty);

  const save = useMutation({
    mutationFn: () => api.purchases.receive({ invoiceId: invoice.id, items: entries }),
    onSuccess: onDone,
    onError: (err) => setError(errorText(err, 'Unable to record the delivery.')),
  });

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={save.isPending ? undefined : onClose}>
      <DialogTitle>Products arrived</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <Typography variant="body2" color="text.secondary">
            These go into stock now. Set a quantity to 0 to leave a product waiting.
          </Typography>
          {items.map((item) =>
            item.isSerialized ? (
              <TextField
                key={item.id}
                label={`${item.productName} — IMEI / serial, one per line`}
                multiline
                minRows={Math.min(item.pendingQty, 4)}
                value={codes[item.id] ?? ''}
                onChange={(e) => setCodes((c) => ({ ...c, [item.id]: e.target.value }))}
                helperText={`${parseCodes(codes[item.id] ?? '').length} of ${item.pendingQty} waiting`}
                error={parseCodes(codes[item.id] ?? '').length > item.pendingQty}
              />
            ) : (
              <TextField
                key={item.id}
                label={item.productName}
                type="number"
                value={quantities[item.id]}
                onChange={(e) =>
                  setQuantities((q) => ({ ...q, [item.id]: Math.max(0, Math.floor(Number(e.target.value)) || 0) }))
                }
                helperText={`${item.pendingQty} waiting`}
                error={(quantities[item.id] ?? 0) > item.pendingQty}
                slotProps={{ htmlInput: { min: 0, max: item.pendingQty } }}
              />
            ),
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          startIcon={<LocalShippingIcon />}
          disabled={entries.length === 0 || tooMany || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Mark delivered'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Damaged units go back to the supplier, for money or a replacement. */
function ReturnDialog({
  invoice,
  item,
  onClose,
  onDone,
}: {
  invoice: PurchaseInvoiceDetail;
  item: PurchaseInvoiceItem;
  onClose: () => void;
  onDone: (invoice: PurchaseInvoiceDetail) => void;
}) {
  const money = useMoneyFormatter();
  const [quantity, setQuantity] = useState(1);
  const [codes, setCodes] = useState('');
  const [outcome, setOutcome] = useState<'REFUND' | 'REPLACE'>('REPLACE');
  const [reason, setReason] = useState('Damaged');
  const [refundAmount, setRefundAmount] = useState(0);
  const [toAccount, setToAccount] = useState(false);
  const [shopAccountId, setShopAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Not delivered yet: damaged on arrival, sent straight back without entering stock.
  const [arrived, setArrived] = useState(item.receivedQty > 0);
  const max = arrived ? item.receivedQty : item.pendingQty;

  const serials = arrived && item.isSerialized ? parseCodes(codes) : undefined;
  const qty = serials ? serials.length : quantity;
  // What they owe back now: only what was paid beyond the reduced total.
  const owedBack = Math.max(0, Math.min(qty * item.unitCost, invoice.paid - (invoice.total - qty * item.unitCost)));

  const save = useMutation({
    mutationFn: () =>
      api.purchases.returnItem({
        itemId: item.id,
        quantity: qty,
        serials,
        outcome,
        arrived,
        reason: reason.trim(),
        refundAmount: outcome === 'REFUND' ? refundAmount : 0,
        shopAccountId: outcome === 'REFUND' && toAccount ? shopAccountId : undefined,
      }),
    onSuccess: onDone,
    onError: (err) => setError(errorText(err, 'Unable to record the return.')),
  });

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={save.isPending ? undefined : onClose}>
      <DialogTitle>Return {item.productName}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <ToggleButtonGroup
            exclusive
            fullWidth
            color="primary"
            value={outcome}
            onChange={(_e, next: 'REFUND' | 'REPLACE' | null) => {
              if (!next) return;
              setOutcome(next);
              if (next === 'REFUND') setRefundAmount(owedBack);
            }}
          >
            <ToggleButton value="REPLACE">Replace — wait for it again</ToggleButton>
            <ToggleButton value="REFUND">Refund — money back</ToggleButton>
          </ToggleButtonGroup>
          {item.pendingQty > 0 && item.receivedQty > 0 && (
            <ToggleButtonGroup exclusive fullWidth size="small" value={arrived} onChange={(_e, v: boolean | null) => v !== null && setArrived(v)}>
              <ToggleButton value={false}>Not delivered yet ({item.pendingQty})</ToggleButton>
              <ToggleButton value={true}>Already in stock ({item.receivedQty})</ToggleButton>
            </ToggleButtonGroup>
          )}

          {serials ? (
            <TextField
              label="IMEI / serial being returned, one per line"
              multiline
              minRows={2}
              value={codes}
              onChange={(e) => setCodes(e.target.value)}
              helperText={`${qty} of ${item.receivedQty} arrived`}
              error={qty > item.receivedQty}
            />
          ) : (
            <TextField
              label="Quantity"
              type="number"
              value={quantity}
              onChange={(e) => {
                const next = Math.max(1, Math.floor(Number(e.target.value)) || 1);
                setQuantity(next);
                if (outcome === 'REFUND') {
                  setRefundAmount(Math.max(0, Math.min(next * item.unitCost, invoice.paid - (invoice.total - next * item.unitCost))));
                }
              }}
              helperText={arrived ? `${item.receivedQty} arrived` : `${item.pendingQty} not delivered yet`}
              error={quantity > max}
              slotProps={{ htmlInput: { min: 1, max } }}
            />
          )}
          <TextField label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} />

          {outcome === 'REFUND' && (
            <>
              <Typography variant="body2" color="text.secondary">
                {money(qty * item.unitCost)} comes off what is owed. Enter the money the supplier gives back now
                (0 if nothing was paid yet).
              </Typography>
              <Stack direction="row" spacing={2}>
                <MoneyField label="Money back now" value={refundAmount} onChange={setRefundAmount} />
                <ToggleButtonGroup exclusive value={toAccount ? 'BANK' : 'CASH'} onChange={(_e, v) => v && setToAccount(v === 'BANK')} sx={{ height: 40 }}>
                  <ToggleButton value="CASH">Cash</ToggleButton>
                  <ToggleButton value="BANK">Bank</ToggleButton>
                </ToggleButtonGroup>
              </Stack>
              {toAccount && refundAmount > 0 && (
                <ShopAccountSelect label="Received into account" value={shopAccountId} onChange={setShopAccountId} />
              )}
            </>
          )}
          {outcome === 'REPLACE' && (
            <Alert severity="info">
              {arrived ? 'They leave stock now and show' : 'They stay'} as waiting until the replacement arrives.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="error"
          disabled={
            save.isPending ||
            qty < 1 ||
            qty > max ||
            !reason.trim() ||
            (outcome === 'REFUND' && toAccount && refundAmount > 0 && !shopAccountId)
          }
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Return'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Pays the supplier from cash in hand or a shop account. */
function PayDialog({
  invoice,
  onClose,
  onDone,
}: {
  invoice: PurchaseInvoiceDetail;
  onClose: () => void;
  onDone: (invoice: PurchaseInvoiceDetail) => void;
}) {
  const money = useMoneyFormatter();
  const [amount, setAmount] = useState(invoice.remaining);
  const [isBank, setIsBank] = useState(invoice.paymentMethod === 'BANK');
  const [shopAccountId, setShopAccountId] = useState('');
  const [paidAt, setPaidAt] = useState(nowLocalDateTime());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.purchases.pay({
        invoiceId: invoice.id,
        amount,
        shopAccountId: isBank ? shopAccountId : undefined,
        paidAt,
        notes: notes.trim() || undefined,
      }),
    onSuccess: onDone,
    onError: (err) => setError(errorText(err, 'Unable to record the payment.')),
  });

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={save.isPending ? undefined : onClose}>
      <DialogTitle>Pay {invoice.supplierName}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Date and time"
            type="datetime-local"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Stack direction="row" spacing={2}>
            <MoneyField
              label="Amount"
              value={amount}
              onChange={setAmount}
              error={amount > invoice.remaining}
              helperText={`Remaining ${money(invoice.remaining)}`}
            />
            <ToggleButtonGroup exclusive value={isBank ? 'BANK' : 'CASH'} onChange={(_e, v) => v && setIsBank(v === 'BANK')} sx={{ height: 40 }}>
              <ToggleButton value="CASH">Cash</ToggleButton>
              <ToggleButton value="BANK">Bank</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          {isBank ? (
            <ShopAccountSelect label="Paid from account" value={shopAccountId} onChange={setShopAccountId} spend={amount} />
          ) : (
            <CashInHandBox spend={amount} />
          )}
          <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={save.isPending || amount <= 0 || amount > invoice.remaining || (isBank && !shopAccountId)}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Pay'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
