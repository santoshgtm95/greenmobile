import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useMoneyFormatter } from '../hooks/useSettings';
import { useDebounced } from '../hooks/useDebounced';
import PurchaseInvoiceDialog from '../components/PurchaseInvoiceDialog';
import PurchaseInvoiceDetailDialog from '../components/PurchaseInvoiceDetailDialog';
import SupplierDialog from '../components/SupplierDialog';
import { PosApiError } from '@shared/errors';
import { formatInstant } from '@shared/datetime';
import { PURCHASE_PAYMENT_LABELS } from '@shared/domain';
import type { PurchaseInvoice, Supplier } from '@shared/api';

const num = { fontVariantNumeric: 'tabular-nums' } as const;

function invoiceStatus(row: PurchaseInvoice) {
  if (row.pendingQty === 0) return <Chip size="small" color="success" label="Delivered" />;
  if (row.receivedQty === 0 && row.refundedQty === 0) return <Chip size="small" label="Ordered" />;
  return <Chip size="small" color="warning" label={`${row.pendingQty} waiting`} />;
}

/** Products ordered from suppliers: arrivals, returns and what is still owed. */
export default function PurchasesPage() {
  const { can } = useAuth();
  const money = useMoneyFormatter();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<'invoices' | 'suppliers'>('invoices');
  const [search, setSearch] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [status, setStatus] = useState<'' | 'WAITING' | 'UNPAID'>('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null | undefined>(undefined);

  const debounced = useDebounced(search, 250);
  const query = useMemo(
    () => ({
      search: debounced || undefined,
      supplierId: supplierId || undefined,
      status: status || undefined,
      page,
      pageSize,
    }),
    [debounced, supplierId, status, page, pageSize],
  );

  const invoices = useQuery({ queryKey: ['purchases', query], queryFn: () => api.purchases.list(query) });
  const suppliers = useQuery({ queryKey: ['suppliers', true], queryFn: () => api.suppliers.list({ includeInactive: true }) });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['purchases'] });
    void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    // Deliveries change stock; payments change cash and accounts.
    void queryClient.invalidateQueries({ queryKey: ['products'] });
    // A typed brand on a new product is registered on save.
    void queryClient.invalidateQueries({ queryKey: ['brands'] });
    void queryClient.invalidateQueries({ queryKey: ['bankingOverview'] });
    void queryClient.invalidateQueries({ queryKey: ['shopBankAccounts'] });
  };

  const totals = invoices.data?.totals;
  const rows = invoices.data?.rows ?? [];

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          Purchase Invoice
        </Typography>
        {can('products.manage') && (
          <>
            <Button startIcon={<AddIcon />} onClick={() => setEditingSupplier(null)}>
              Register supplier
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
              New invoice
            </Button>
          </>
        )}
      </Stack>

      <Tabs value={tab} onChange={(_e, next) => setTab(next)}>
        <Tab value="invoices" label="Invoices" />
        <Tab value="suppliers" label="Suppliers" />
      </Tabs>

      {tab === 'invoices' && (
        <>
          {invoices.isError && (
            <Alert severity="error">
              {invoices.error instanceof PosApiError ? invoices.error.message : 'Unable to load purchase invoices.'}
            </Alert>
          )}

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            {[
              { label: 'Total ordered', value: totals?.total ?? 0 },
              { label: 'Paid', value: totals?.paid ?? 0 },
              { label: 'Remaining to pay', value: totals?.remaining ?? 0 },
            ].map((card) => (
              <Paper key={card.label} sx={{ p: 2, flex: 1, border: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary">
                  {card.label}
                </Typography>
                <Typography variant="h5" sx={{ fontWeight: 700, ...num }}>
                  {money(card.value)}
                </Typography>
              </Paper>
            ))}
          </Stack>

          <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField
                placeholder="Search invoice no, supplier or remark"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  },
                }}
                sx={{ maxWidth: 340 }}
              />
              <TextField
                select
                label="Supplier"
                value={supplierId}
                onChange={(e) => {
                  setSupplierId(e.target.value);
                  setPage(0);
                }}
                sx={{ minWidth: 200 }}
              >
                <MenuItem value="">All suppliers</MenuItem>
                {(suppliers.data ?? []).map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Show"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as typeof status);
                  setPage(0);
                }}
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="">All invoices</MenuItem>
                <MenuItem value="WAITING">Waiting for products</MenuItem>
                <MenuItem value="UNPAID">Not fully paid</MenuItem>
              </TextField>
            </Stack>
          </Paper>

          <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
            <TableContainer>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Date and time</TableCell>
                    <TableCell>Invoice No</TableCell>
                    <TableCell>Supplier</TableCell>
                    <TableCell>Payment</TableCell>
                    <TableCell align="right">Products</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell align="right">Paid</TableCell>
                    <TableCell align="right">Remaining</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {!invoices.isLoading && rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                        No purchase invoices.
                      </TableCell>
                    </TableRow>
                  )}
                  {rows.map((row) => (
                    <TableRow key={row.id} hover onClick={() => setOpenId(row.id)} sx={{ cursor: 'pointer' }}>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatInstant(row.invoiceDate)}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{row.invoiceNo}</TableCell>
                      <TableCell>{row.supplierName}</TableCell>
                      <TableCell>{PURCHASE_PAYMENT_LABELS[row.paymentMethod]}</TableCell>
                      <TableCell align="right">
                        {row.receivedQty} / {row.quantity - row.refundedQty}
                      </TableCell>
                      <TableCell>{invoiceStatus(row)}</TableCell>
                      <TableCell align="right" sx={num}>
                        {money(row.total)}
                      </TableCell>
                      <TableCell align="right" sx={num}>
                        {money(row.paid)}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{ ...num, fontWeight: 700, color: row.remaining > 0 ? 'warning.main' : 'success.main' }}
                      >
                        {money(row.remaining)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={invoices.data?.total ?? 0}
              page={page}
              onPageChange={(_e, next) => setPage(next)}
              rowsPerPage={pageSize}
              onRowsPerPageChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
              rowsPerPageOptions={[25, 50, 100]}
            />
          </Paper>
        </>
      )}

      {tab === 'suppliers' && (
        <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Supplier</TableCell>
                  <TableCell>Phone</TableCell>
                  <TableCell>Address</TableCell>
                  <TableCell align="right">Invoices</TableCell>
                  <TableCell align="right">Total</TableCell>
                  <TableCell align="right">Paid</TableCell>
                  <TableCell align="right">Remaining to pay</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {suppliers.data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                      No supplier registered yet.
                    </TableCell>
                  </TableRow>
                )}
                {(suppliers.data ?? []).map((s) => (
                  <TableRow key={s.id} hover sx={{ opacity: s.isActive ? 1 : 0.5 }}>
                    <TableCell>
                      {s.name}
                      {!s.isActive && <Chip size="small" label="Inactive" sx={{ ml: 1 }} />}
                    </TableCell>
                    <TableCell>{s.phone}</TableCell>
                    <TableCell>{s.address}</TableCell>
                    <TableCell align="right">{s.invoiceCount}</TableCell>
                    <TableCell align="right" sx={num}>
                      {money(s.total)}
                    </TableCell>
                    <TableCell align="right" sx={num}>
                      {money(s.paid)}
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{ ...num, fontWeight: 700, color: s.remaining > 0 ? 'warning.main' : 'success.main' }}
                    >
                      {money(s.remaining)}
                    </TableCell>
                    <TableCell align="right">
                      {can('products.manage') && (
                        <IconButton size="small" onClick={() => setEditingSupplier(s)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {creating && (
        <PurchaseInvoiceDialog
          invoice={null}
          onClose={() => setCreating(false)}
          onSaved={(invoice) => {
            setCreating(false);
            refresh();
            setOpenId(invoice.id);
          }}
        />
      )}
      {openId && <PurchaseInvoiceDetailDialog invoiceId={openId} onClose={() => setOpenId(null)} onChanged={refresh} />}
      {editingSupplier !== undefined && (
        <SupplierDialog
          supplier={editingSupplier}
          onClose={() => setEditingSupplier(undefined)}
          onSaved={() => {
            setEditingSupplier(undefined);
            refresh();
          }}
        />
      )}
    </Stack>
  );
}
