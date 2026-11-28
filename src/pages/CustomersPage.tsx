import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  Switch,
  FormControlLabel,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import EditIcon from '@mui/icons-material/Edit';
import HistoryIcon from '@mui/icons-material/History';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useMoneyFormatter } from '../hooks/useSettings';
import { useDebounced } from '../hooks/useDebounced';
import CustomerDialog from '../components/CustomerDialog';
import CustomerDetailDialog from '../components/CustomerDetailDialog';
import { PosApiError } from '@shared/errors';
import ExportMenu from '../components/ExportMenu';
import { formatInstant } from '@shared/datetime';
import type { Customer } from '@shared/api';
import { historyTableSx } from '../components/historyTableSx';
import { PageHeader, TableCardHeader } from '../components/PageLayout';

/** "today", "3 days ago", "2 months ago": how long since the customer last bought. */
function ago(instant: string): string {
  const days = Math.floor((Date.now() - Date.parse(instant)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months} month${months === 1 ? '' : 's'} ago` : `${Math.floor(months / 12)}+ years ago`;
}

/** Customer management (spec §41). */
export default function CustomersPage() {
  const { can } = useAuth();
  const money = useMoneyFormatter();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [editing, setEditing] = useState<Customer | null | undefined>(undefined);
  const [detailId, setDetailId] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search, 250);

  const query = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      includeInactive,
      page,
      pageSize,
    }),
    [debouncedSearch, includeInactive, page, pageSize],
  );

  const customers = useQuery({
    queryKey: ['customers', query],
    queryFn: () => api.customers.list(query),
  });

  const rows = customers.data?.rows ?? [];

  return (
    <Stack spacing={2}>
      <PageHeader
        title="Customers"
        subtitle="The people who buy from the shop: what they spent and when they last came in"
        actions={
          can('customers.manage') && (
            <Button variant="contained" startIcon={<PersonAddIcon />} onClick={() => setEditing(null)}>
              Add Customer
            </Button>
          )
        }
      />

      {customers.isError && (
        <Alert severity="error">
          {customers.error instanceof PosApiError
            ? customers.error.message
            : 'Unable to load customers.'}
        </Alert>
      )}

      <Paper sx={historyTableSx}>
        <TableCardHeader
          title="Customers"
          caption={`${customers.data?.total ?? 0} ${includeInactive ? 'customers, inactive included' : 'active customers'}${debouncedSearch ? ` · matching “${debouncedSearch}”` : ''}`}
          action={<ExportMenu target={{ dataset: 'CUSTOMER_LIST', query }} />}
        >
          <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
            <TextField
              placeholder="Search name, phone or customer code"
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
              sx={{ flex: '1 1 260px', maxWidth: 480 }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={includeInactive}
                  onChange={(e) => {
                    setIncludeInactive(e.target.checked);
                    setPage(0);
                  }}
                />
              }
              label="Show inactive"
            />
          </Stack>
        </TableCardHeader>
        <TableContainer>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Phone</TableCell>
                {/* Hidden below lg so the table fits a tablet; email is in the customer's detail. */}
                <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>Email</TableCell>
                <TableCell align="right">Orders</TableCell>
                <TableCell align="right">Total spent</TableCell>
                <TableCell>Last purchase</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {customers.isLoading && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    Loading…
                  </TableCell>
                </TableRow>
              )}

              {!customers.isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {search ? 'No customers match that search.' : 'No customers yet.'}
                    </Typography>
                    <Typography variant="caption">
                      {search ? 'Try part of the name or the last digits of the phone.' : 'Add one here, or straight from the till while selling.'}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}

              {rows.map((customer) => (
                <TableRow
                  key={customer.id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => setDetailId(customer.id)}
                >
                  <TableCell sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                    {customer.customerCode}
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>
                    {customer.name}
                    {customer.isActive === 0 && <Chip size="small" label="Inactive" sx={{ ml: 1 }} />}
                  </TableCell>
                  <TableCell>{customer.phone ?? '—'}</TableCell>
                  <TableCell sx={{ color: 'text.secondary', display: { xs: 'none', lg: 'table-cell' } }}>{customer.email ?? '—'}</TableCell>
                  <TableCell align="right">{customer.totalOrders || '—'}</TableCell>
                  <TableCell
                    align="right"
                    sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
                  >
                    {customer.totalSpent > 0 ? money(customer.totalSpent) : '—'}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                    {customer.lastPurchaseAt ? formatInstant(customer.lastPurchaseAt) : '—'}
                    {customer.lastPurchaseAt && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {ago(customer.lastPurchaseAt)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                      <Tooltip title="History">
                        <IconButton size="small" aria-label={`History of ${customer.name}`} onClick={() => setDetailId(customer.id)}>
                          <HistoryIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {can('customers.edit') && (
                        <Tooltip title="Edit">
                          <IconButton size="small" aria-label={`Edit ${customer.name}`} onClick={() => setEditing(customer)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          component="div"
          count={customers.data?.total ?? 0}
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

      {editing !== undefined && (
        <CustomerDialog
          customer={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void queryClient.invalidateQueries({ queryKey: ['customers'] });
          }}
        />
      )}

      {detailId && (
        <CustomerDetailDialog customerId={detailId} onClose={() => setDetailId(null)} />
      )}
    </Stack>
  );
}
