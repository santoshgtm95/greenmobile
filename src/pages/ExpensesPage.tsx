import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
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
import ReceiptOutlinedIcon from '@mui/icons-material/ReceiptOutlined';
import ListAltOutlinedIcon from '@mui/icons-material/ListAltOutlined';
import { alpha } from '@mui/material/styles';
import SummaryCard from '../components/SummaryCard';
import { historyTableSx } from '../components/historyTableSx';
import { compactFiltersSx } from '../components/compactSx';
import { PageHeader, SummaryPanel, TableCardHeader, cardGrid } from '../components/PageLayout';
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
  const total = summary.data?.total ?? 0;
  const count = summary.data?.count ?? 0;
  const dates = `${formatBusinessDay(range.from)} — ${formatBusinessDay(range.to)}`;
  const categoryName = categories.data?.find((c) => c.id === categoryId)?.name;

  return (
    <Stack spacing={2}>
      <PageHeader
        title="Expenses"
        subtitle="What the shop spends to run: rent, bills, wages and supplies"
        actions={
          can('expenses.manage') && (
            <>
              <Button variant="outlined" startIcon={<CategoryIcon />} onClick={() => setCategoriesOpen(true)}>
                Categories
              </Button>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing(null)}>
                Add Expense
              </Button>
            </>
          )
        }
      />

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {expenses.isError && (
        <Alert severity="error">
          {expenses.error instanceof PosApiError ? expenses.error.message : 'Unable to load expenses.'}
        </Alert>
      )}

      {/* Period totals — the same figures the P&L report will use. */}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 2fr' } }}>
        <SummaryPanel tint title="Spent" caption={`${dates} · all categories`}>
          <Box sx={{ ...cardGrid, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: '1fr' } }}>
            <SummaryCard
              label="Total for this period"
              value={money(total)}
              caption="Counts towards net profit"
              icon={<ReceiptOutlinedIcon fontSize="small" />}
              tone="error"
            />
            <SummaryCard
              label="Expenses recorded"
              value={String(count)}
              caption={count ? `About ${money(Math.round(total / count))} each` : 'Nothing recorded yet'}
              icon={<ListAltOutlinedIcon fontSize="small" />}
            />
          </Box>
        </SummaryPanel>

        {/* One period control above everything it scopes: these figures and the list below. */}
        <SummaryPanel
          title="Where the money went"
          caption="Biggest categories · pick one to list only its expenses"
          action={
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center', ...compactFiltersSx }}>
              <TextField
                select
                size="small"
                label="Period"
                value={preset}
                onChange={(e) => {
                  setPreset(e.target.value as DatePreset);
                  setPage(0);
                }}
                sx={{ width: 150 }}
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
                    size="small"
                    label="From"
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    slotProps={{ inputLabel: { shrink: true } }}
                    sx={{ width: 145 }}
                  />
                  <TextField
                    size="small"
                    label="To"
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    slotProps={{ inputLabel: { shrink: true } }}
                    sx={{ width: 145 }}
                  />
                </>
              )}
            </Stack>
          }
        >
          {topCategories.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              Nothing recorded in this period.
            </Typography>
          )}
          <Stack spacing={0.5}>
            {topCategories.map((category, rank) => {
              const share = total ? Math.round((category.total / total) * 100) : 0;
              const active = categoryId === category.categoryId;
              return (
                <ButtonBase
                  key={category.categoryId}
                  aria-pressed={active}
                  onClick={() => {
                    setCategoryId(active ? '' : category.categoryId);
                    setPage(0);
                  }}
                  sx={(theme) => ({
                    display: 'flex',
                    gap: 1.5,
                    alignItems: 'center',
                    px: 1.25,
                    py: 0.75,
                    borderRadius: 2,
                    textAlign: 'left',
                    border: '1px solid',
                    borderColor: active ? 'primary.main' : 'transparent',
                    bgcolor: active ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
                    transition: 'background-color .15s, border-color .15s',
                    '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.06) },
                    '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 1 },
                  })}
                >
                  <Typography variant="caption" color="text.secondary" sx={{ width: 14, fontWeight: 700 }}>
                    {rank + 1}
                  </Typography>
                  <Typography variant="body2" noWrap sx={{ width: 150, fontWeight: 600 }}>
                    {category.categoryName}
                  </Typography>
                  <Box
                    sx={(theme) => ({
                      flexGrow: 1,
                      height: 8,
                      borderRadius: 4,
                      bgcolor: alpha(theme.palette.primary.main, 0.1),
                      overflow: 'hidden',
                    })}
                  >
                    <Box
                      sx={(theme) => ({
                        width: `${share}%`,
                        height: '100%',
                        borderRadius: 4,
                        background: `linear-gradient(90deg, ${theme.palette.primary.light}, ${theme.palette.primary.main})`,
                      })}
                    />
                  </Box>
                  <Typography
                    variant="body2"
                    sx={{ minWidth: 100, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {money(category.total)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 34, textAlign: 'right' }}>
                    {share}%
                  </Typography>
                </ButtonBase>
              );
            })}
          </Stack>
        </SummaryPanel>
      </Box>

      <Paper sx={historyTableSx}>
        <TableCardHeader
          title="Expenses"
          caption={`${expenses.data?.total ?? 0} listed · ${dates}${categoryName ? ` · ${categoryName}` : ''}`}
          action={<ExportMenu target={{ dataset: 'EXPENSE_LIST', query }} />}
        >
          <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
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
              sx={{ flex: '1 1 260px' }}
            />
            <TextField
              select
              label="Category"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setPage(0);
              }}
              sx={{ width: 170 }}
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
              sx={{ width: 170 }}
            >
              <MenuItem value="">Any method</MenuItem>
              {PAYMENT_METHODS.map((method) => (
                <MenuItem key={method} value={method}>
                  {PAYMENT_METHOD_LABELS[method]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </TableCardHeader>
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
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {search || categoryId || paymentMethod ? 'No expenses match these filters.' : 'No expenses in this period.'}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}

              {rows.map((expense) => (
                <TableRow key={expense.id} hover>
                  <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{expense.expenseNumber}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {formatBusinessDay(expense.expenseDay)}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color="primary" variant="outlined" label={expense.categoryName} sx={{ fontWeight: 600 }} />
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
                      {can('expenses.edit') && (
                        <Tooltip title="Edit">
                          <IconButton size="small" aria-label={`Edit ${expense.expenseNumber}`} onClick={() => setEditing(expense)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {can('expenses.delete') && (
                        <Tooltip title="Delete">
                          <IconButton
                            size="small"
                            aria-label={`Delete ${expense.expenseNumber}`}
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
