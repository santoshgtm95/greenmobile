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
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMoneyFormatter } from '../hooks/useSettings';
import SaleDetailDialog from './SaleDetailDialog';
import { PosApiError } from '@shared/errors';
import { formatInstant, formatBusinessDay } from '@shared/datetime';
import { SALE_STATUS_LABELS, SERVICE_STATUS_LABELS, type SaleStatus, type ServiceStatus } from '@shared/domain';

/**
 * Customer detail (spec §41, §42, §91).
 *
 * Statistics first, then the full trading history. Clicking an invoice opens the
 * complete sale, so the reprint and refund actions are reachable from here too.
 */
export default function CustomerDetailDialog({
  customerId,
  onClose,
}: {
  customerId: string;
  onClose: () => void;
}) {
  const money = useMoneyFormatter();
  const [tab, setTab] = useState(0);
  const [openSaleId, setOpenSaleId] = useState<string | null>(null);

  const history = useQuery({
    queryKey: ['customerHistory', customerId],
    queryFn: () => api.customers.history({ id: customerId }),
  });

  const data = history.data;
  const customer = data?.customer;

  return (
    <Dialog open fullWidth maxWidth="lg" onClose={onClose}>
      <DialogTitle>{customer ? customer.name : 'Customer'}</DialogTitle>
      <DialogContent dividers>
        {history.isLoading && <Typography color="text.secondary">Loading…</Typography>}

        {history.isError && (
          <Alert severity="error">
            {history.error instanceof PosApiError
              ? history.error.message
              : 'Unable to load this customer.'}
          </Alert>
        )}

        {data && customer && (
          <Stack spacing={2.5}>
            {/* Statistics (spec §42) */}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Stat label="Customer code" value={customer.customerCode} mono />
              <Stat label="Phone" value={customer.phone ?? '—'} />
              <Stat label="Total orders" value={String(customer.totalOrders)} />
              <Stat label="Total spent" value={money(customer.totalSpent)} emphasis />
              <Stat
                label="Last purchase"
                value={customer.lastPurchaseAt ? formatInstant(customer.lastPurchaseAt) : 'Never'}
              />
            </Stack>

            {(customer.address || customer.notes || customer.email) && (
              <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
                <Stack spacing={0.5}>
                  {customer.email && (
                    <Typography variant="body2">
                      <strong>Email:</strong> {customer.email}
                    </Typography>
                  )}
                  {customer.address && (
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                      <strong>Address:</strong> {customer.address}
                    </Typography>
                  )}
                  {customer.notes && (
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                      <strong>Notes:</strong> {customer.notes}
                    </Typography>
                  )}
                </Stack>
              </Paper>
            )}

            <Tabs value={tab} onChange={(_e, next) => setTab(next)}>
              <Tab label={`Purchases (${data.purchases.length})`} />
              <Tab label={`Service jobs (${data.services.length})`} />
            </Tabs>

            {tab === 0 && (
              <>
                {data.purchases.length === 0 && (
                  <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    This customer has not bought anything yet.
                  </Typography>
                )}
                {data.purchases.length > 0 && (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Invoice</TableCell>
                        <TableCell>Date</TableCell>
                        <TableCell>Products</TableCell>
                        <TableCell>IMEI</TableCell>
                        <TableCell align="right">Total</TableCell>
                        <TableCell>Payment</TableCell>
                        <TableCell>Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.purchases.map((purchase) => (
                        <TableRow
                          key={purchase.saleId}
                          hover
                          sx={{ cursor: 'pointer' }}
                          onClick={() => setOpenSaleId(purchase.saleId)}
                        >
                          <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                            {purchase.invoiceNumber}
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            {formatBusinessDay(purchase.saleDay)}
                          </TableCell>
                          <TableCell sx={{ maxWidth: 280 }}>
                            <Typography variant="body2" noWrap title={purchase.productSummary}>
                              {purchase.productSummary}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                            {purchase.serials ?? '—'}
                          </TableCell>
                          <TableCell
                            align="right"
                            sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
                          >
                            {money(purchase.grandTotal)}
                            {purchase.refundedAmount > 0 && (
                              <Typography variant="caption" color="error" sx={{ display: 'block' }}>
                                -{money(purchase.refundedAmount)} refunded
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell sx={{ color: 'text.secondary', fontSize: 12 }}>
                            {purchase.paymentMethods?.replace(/_/g, ' ') ?? '—'}
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={
                                SALE_STATUS_LABELS[purchase.status as SaleStatus] ?? purchase.status
                              }
                              color={purchase.status === 'COMPLETED' ? 'success' : 'warning'}
                              variant="outlined"
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </>
            )}

            {tab === 1 && (
              <>
                {data.services.length === 0 && (
                  <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    No repair jobs for this customer.
                  </Typography>
                )}
                {data.services.length > 0 && (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Job</TableCell>
                        <TableCell>Device</TableCell>
                        <TableCell>IMEI</TableCell>
                        <TableCell>Received</TableCell>
                        <TableCell align="right">Cost</TableCell>
                        <TableCell>Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.services.map((job) => (
                        <TableRow key={job.id} hover>
                          <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                            {job.serviceNumber}
                          </TableCell>
                          <TableCell>
                            {job.deviceBrand} {job.deviceModel}
                          </TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                            {job.imei ?? '—'}
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            {formatInstant(job.receivedDate)}
                          </TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            {money(job.finalCost)}
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              variant="outlined"
                              label={
                                SERVICE_STATUS_LABELS[job.status as ServiceStatus] ?? job.status
                              }
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>

      {openSaleId && (
        <SaleDetailDialog
          saleId={openSaleId}
          onClose={() => setOpenSaleId(null)}
          onChanged={() => void history.refetch()}
        />
      )}
    </Dialog>
  );
}

function Stat({
  label,
  value,
  emphasis,
  mono,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  mono?: boolean;
}) {
  return (
    <Paper sx={{ p: 1.5, flex: 1, border: '1px solid', borderColor: 'divider', minWidth: 130 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography
        variant={emphasis ? 'h6' : 'body1'}
        sx={{
          fontWeight: emphasis ? 700 : 600,
          fontFamily: mono ? 'monospace' : undefined,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </Typography>
    </Paper>
  );
}
