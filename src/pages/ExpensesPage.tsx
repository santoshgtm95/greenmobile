import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
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
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import CategoryIcon from '@mui/icons-material/Category';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useMoneyFormatter } from '../hooks/useSettings';
import { useDebounced } from '../hooks/useDebounced';
import ExpenseDialog from '../components/ExpenseDialog';
import ExpenseCategoriesDialog from '../components/ExpenseCategoriesDialog';
import { PosApiError } from '@shared/errors';
import ExportMenu from '../components/ExportMenu';
import DeleteReasonDialog from '../components/DeleteReasonDialog';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@shared/domain';
import {
  DATE_PRESETS,
  DATE_PRESET_LABELS,
  resolvePreset,
  formatBusinessDay,
  type DatePreset,
} from '@shared/datetime';
import type { Expense } from '@shared/api';

/** Expense management (spec §43). */
export default function ExpensesPage() {
  const { can } = useAuth();
  const money = useMoneyFormatter();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [preset, setPreset] = useState<DatePreset>('THIS_MONTH');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const [editing, setEditing] = useState<Expense | null | undefined>(undefined);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search, 250);

  const range = useMemo(
    () => resolvePreset(preset, { from: customFrom || undefined, to: customTo || undefined }),
    [preset, customFrom, customTo],
  );

  const query = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      from: range.from,
      to: range.to,
      categoryId: categoryId || undefined,
      paymentMethod: (paymentMethod || undefined) as PaymentMethod | undefined,
      includeDeleted: false,
      page,
      pageSize,
    }),
    [debouncedSearch, range, categoryId, paymentMethod, page, pageSize],
  );

  const expenses = useQuery({
    queryKey: ['expenses', query],
    queryFn: () => api.expenses.list(query),
  });

  const categories = useQuery({
    queryKey: ['expenseCategories'],
    queryFn: () => api.expenseCategories.list({ includeInactive: false }),
  });

  const summary = useQuery({
    queryKey: ['expenseSummary', range],
    queryFn: () => api.expenses.summary(range),
  });

  // A refusal is shown by DeleteReasonDialog, which is the only caller.
  const remove = useMutation({
    mutationFn: (input: { id: string; reason: string }) => api.expenses.delete(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['expenseSummary'] });
    },
  });
  const [deleting, setDeleting] = useState<{ id: string; expenseNumber: string } | null>(null);

  const rows = expenses.data?.rows ?? [];
  const topCategories = (summary.data?.byCategory ?? []).slice(0, 5);

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          Expenses
        </Typography>
        <ExportMenu target={{ dataset: 'EXPENSE_LIST', query }} />
        {can('expenses.manage') && (
          <>
            <Button startIcon={<CategoryIcon />} onClick={() => setCategoriesOpen(true)}>
              Categories
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing(null)}>
              Add Expense
            </Button>
          </>
        )}
      </Stack>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {expenses.isError && (
        <Alert severity="error">
          {expenses.error instanceof PosApiError
            ? expenses.error.message
            : 'Unable to load expenses.'}
        </Alert>
      )}

      {/* Period totals — the same figures the P&L report will use. */}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Paper sx={{ p: 2, flex: 1, border: '1px solid', borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary">
            Total for this period
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {money(summary.data?.total ?? 0)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {summary.data?.count ?? 0} expense(s) · {formatBusinessDay(range.from)} to{' '}
            {formatBusinessDay(range.to)}
          </Typography>
        </Paper>

        <Paper sx={{ p: 2, flex: 2, border: '1px solid', borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary">
            Biggest categories
          </Typography>
          {topCategories.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Nothing recorded in this period.
            </Typography>
          )}
          <Stack spacing={0.75} sx={{ mt: 1 }}>
            {topCategories.map((category) => {
              const share = summary.data?.total
                ? Math.round((category.total / summary.data.total) * 100)
                : 0;
              return (
                <Stack key={category.categoryId} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ minWidth: 150 }}>
                    {category.categoryName}
                  </Typography>
                  <Box
                    sx={{
                      flexGrow: 1,
                      height: 8,
                      borderRadius: 4,
                      bgcolor: 'action.hover',
                      overflow: 'hidden',
                    }}
                  >
                    <Box sx={{ width: `${share}%`, height: '100%', bgcolor: 'primary.main' }} />
                  </Box>
                  <Typography
                    variant="body2"
                    sx={{ minWidth: 110, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {money(category.total)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 36, textAlign: 'right' }}>
                    {share}%
                  </Typography>
                </Stack>
              );
            })}
          </Stack>
        </Paper>
      </Stack>

      <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
          <TextField
            placeholder="Search description, number or reference"
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
            label="Period"
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value as DatePreset);
              setPage(0);
            }}
            sx={{ maxWidth: 180 }}
          >
            {DATE_PRESETS.map((option) => (
              <MenuItem key={option} value={option}>
                {DATE_PRESET_LABELS[option]}
              </MenuItem>
            ))}
          </TextField>

          {preset === 'CUSTOM' && (
            <>
              <TextField
                label="From"
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ maxWidth: 170 }}
              />
              <TextField
                label="To"
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ maxWidth: 170 }}
              />
            </>
          )}

          <TextField
            select
            label="Category"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setPage(0);
            }}
            sx={{ maxWidth: 200 }}
          >
            <MenuItem value="">All categories</MenuItem>
            {(categories.data ?? []).map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="Paid by"
            value={paymentMethod}
            onChange={(e) => {
              setPaymentMethod(e.target.value);
              setPage(0);
            }}
            sx={{ maxWidth: 180 }}
          >
            <MenuItem value="">Any method</MenuItem>
            {PAYMENT_METHODS.map((method) => (
              <MenuItem key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </Paper>

      <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
        <TableContainer>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Expense No</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Description</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Paid by</TableCell>
                <TableCell>Recorded by</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {expenses.isLoading && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    Loading…
                  </TableCell>
                </TableRow>
              )}

              {!expenses.isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                    No expenses in this period.
                  </TableCell>
                </TableRow>
              )}

              {rows.map((expense) => (
                <TableRow key={expense.id} hover>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{expense.expenseNumber}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {formatBusinessDay(expense.expenseDay)}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={expense.categoryName} />
                  </TableCell>
                  <TableCell>
                    {expense.description}
                    {expense.referenceNumber && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        Ref {expense.referenceNumber}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
                  >
                    {money(expense.amount)}
                  </TableCell>
                  <TableCell>
                    {PAYMENT_METHOD_LABELS[expense.paymentMethod as PaymentMethod] ??
                      expense.paymentMethod}
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>
                    {expense.createdByName ?? '—'}
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                      {can('expenses.manage') && (
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => setEditing(expense)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {can('expenses.delete') && (
                        <Tooltip title="Delete">
                          <IconButton
                            size="small"
                            onClick={() => setDeleting(expense)}
                          >
                            <DeleteOutlineIcon fontSize="small" />
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
          count={expenses.data?.total ?? 0}
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
        <ExpenseDialog
          expense={editing}
          categories={categories.data ?? []}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void queryClient.invalidateQueries({ queryKey: ['expenses'] });
            void queryClient.invalidateQueries({ queryKey: ['expenseSummary'] });
          }}
        />
      )}

      {categoriesOpen && (
        <ExpenseCategoriesDialog
          onClose={() => setCategoriesOpen(false)}
          onChanged={() => {
            void queryClient.invalidateQueries({ queryKey: ['expenseCategories'] });
            void queryClient.invalidateQueries({ queryKey: ['expenses'] });
          }}
        />
      )}

      {deleting && (
        <DeleteReasonDialog
          title={`Delete expense ${deleting.expenseNumber}?`}
          message="It stays in the records, marked deleted, but stops counting towards reports."
          onConfirm={(reason) => remove.mutateAsync({ id: deleting.id, reason })}
          onClose={() => setDeleting(null)}
        />
      )}
    </Stack>
  );
}
