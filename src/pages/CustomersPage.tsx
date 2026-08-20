import { useMemo, useState } from 'react';
import {
  Alert,
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
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          Customers
        </Typography>
        <ExportMenu target={{ dataset: 'CUSTOMER_LIST', query }} />
        {can('customers.manage') && (
          <Button variant="contained" startIcon={<PersonAddIcon />} onClick={() => setEditing(null)}>
            Add Customer
          </Button>
        )}
      </Stack>

      {customers.isError && (
        <Alert severity="error">
          {customers.error instanceof PosApiError
            ? customers.error.message
            : 'Unable to load customers.'}
        </Alert>
      )}

      <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
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
            sx={{ maxWidth: 380 }}
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
      </Paper>

      <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
        <TableContainer>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Phone</TableCell>
                <TableCell>Email</TableCell>
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
                    {search
                      ? 'No customers match that search.'
                      : 'No customers yet. They can also be added straight from the till.'}
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
                    {customer.isActive === 0 && (
                      <Chip size="small" label="Inactive" sx={{ ml: 1 }} />
                    )}
                  </TableCell>
                  <TableCell>{customer.phone ?? '—'}</TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>{customer.email ?? '—'}</TableCell>
                  <TableCell align="right">{customer.totalOrders || '—'}</TableCell>
                  <TableCell
                    align="right"
                    sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
                  >
                    {customer.totalSpent > 0 ? money(customer.totalSpent) : '—'}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                    {customer.lastPurchaseAt ? formatInstant(customer.lastPurchaseAt) : '—'}
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                      <Tooltip title="History">
                        <IconButton size="small" onClick={() => setDetailId(customer.id)}>
                          <HistoryIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {can('customers.manage') && (
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => setEditing(customer)}>
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
