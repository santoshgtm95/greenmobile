import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
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
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import BuildIcon from '@mui/icons-material/Build';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useMoneyFormatter } from '../hooks/useSettings';
import { useDebounced } from '../hooks/useDebounced';
import ServiceIntakeDialog from '../components/ServiceIntakeDialog';
import ServiceDetailDialog from '../components/ServiceDetailDialog';
import { PosApiError } from '@shared/errors';
import {
  SERVICE_BOARD_STATUSES,
  SERVICE_STATUS_LABELS,
  SERVICE_STATUSES,
  type ServiceStatus,
} from '@shared/domain';
import { formatInstant, formatBusinessDay } from '@shared/datetime';

/** Colour per column on the board, so the shop can read it at a glance. */
const STATUS_TONE: Record<ServiceStatus, string> = {
  RECEIVED: '#1565c0',
  DIAGNOSING: '#6a1b9a',
  WAITING_APPROVAL: '#ef6c00',
  WAITING_PARTS: '#ad1457',
  REPAIRING: '#00695c',
  COMPLETED: '#2e7d32',
  DELIVERED: '#455a64',
  CANCELLED: '#757575',
};

/** Service dashboard and job list (spec §51). */
export default function ServicesPage() {
  const { can } = useAuth();
  const money = useMoneyFormatter();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | ServiceStatus>('');
  const [openOnly, setOpenOnly] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search, 250);

  const query = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      status: status || undefined,
      // A specific status is an explicit choice, so it wins over "open only".
      openOnly: status ? false : openOnly,
      customerId: undefined,
      from: undefined,
      to: undefined,
      page,
      pageSize,
    }),
    [debouncedSearch, status, openOnly, page, pageSize],
  );

  const jobs = useQuery({
    queryKey: ['services', query],
    queryFn: () => api.services.list(query),
  });

  const board = useQuery({
    queryKey: ['serviceBoard'],
    queryFn: () => api.services.board(),
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['services'] });
    void queryClient.invalidateQueries({ queryKey: ['serviceBoard'] });
    void queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  const rows = jobs.data?.rows ?? [];

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          Service &amp; Repair
        </Typography>
        {can('services.manage') && (
          <Button variant="contained" startIcon={<BuildIcon />} onClick={() => setIntakeOpen(true)}>
            Receive Device
          </Button>
        )}
      </Stack>

      {jobs.isError && (
        <Alert severity="error">
          {jobs.error instanceof PosApiError ? jobs.error.message : 'Unable to load service jobs.'}
        </Alert>
      )}

      {/* Status board (spec §51) — clicking a column filters the list below. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))',
          gap: 1.5,
        }}
      >
        {SERVICE_BOARD_STATUSES.map((boardStatus) => {
          const count = board.data?.[boardStatus] ?? 0;
          const active = status === boardStatus;
          return (
            <Paper
              key={boardStatus}
              onClick={() => {
                setStatus(active ? '' : boardStatus);
                setPage(0);
              }}
              sx={{
                p: 1.5,
                cursor: 'pointer',
                border: '1px solid',
                borderColor: active ? STATUS_TONE[boardStatus] : 'divider',
                borderLeft: `4px solid ${STATUS_TONE[boardStatus]}`,
                bgcolor: active ? 'action.selected' : 'background.paper',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {SERVICE_STATUS_LABELS[boardStatus]}
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                {count}
              </Typography>
            </Paper>
          );
        })}
      </Box>

      <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
          <TextField
            placeholder="Job number, customer, phone, IMEI or model"
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
            sx={{ maxWidth: 400 }}
          />
          <TextField
            select
            label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ServiceStatus | '');
              setPage(0);
            }}
            sx={{ maxWidth: 210 }}
          >
            <MenuItem value="">{openOnly ? 'Open jobs' : 'All statuses'}</MenuItem>
            {SERVICE_STATUSES.map((option) => (
              <MenuItem key={option} value={option}>
                {SERVICE_STATUS_LABELS[option]}
              </MenuItem>
            ))}
          </TextField>
          <Button
            size="small"
            variant={openOnly && !status ? 'contained' : 'outlined'}
            onClick={() => {
              setOpenOnly((v) => !v);
              setStatus('');
              setPage(0);
            }}
          >
            {openOnly ? 'Showing open jobs' : 'Showing all jobs'}
          </Button>
        </Stack>
      </Paper>

      <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
        <TableContainer>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Job</TableCell>
                <TableCell>Received</TableCell>
                <TableCell>Customer</TableCell>
                <TableCell>Device</TableCell>
                <TableCell>IMEI</TableCell>
                <TableCell align="right">Charge</TableCell>
                <TableCell align="right">Owing</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {jobs.isLoading && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    Loading…
                  </TableCell>
                </TableRow>
              )}

              {!jobs.isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                    {search || status
                      ? 'No jobs match these filters.'
                      : openOnly
                        ? 'No devices are in the shop right now.'
                        : 'No service jobs yet.'}
                  </TableCell>
                </TableRow>
              )}

              {rows.map((job) => (
                <TableRow
                  key={job.id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => setDetailId(job.id)}
                >
                  <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                    {job.serviceNumber}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {formatBusinessDay(job.receivedDay)}
                    {job.expectedDate && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        due {formatInstant(job.expectedDate)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {job.customerName}
                    {job.customerPhone && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {job.customerPhone}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {job.deviceBrand} {job.deviceModel}
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {job.imei ?? '—'}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {job.finalCost > 0 ? money(job.finalCost) : '—'}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      fontVariantNumeric: 'tabular-nums',
                      color: job.balance > 0 ? 'error.main' : 'text.secondary',
                      fontWeight: job.balance > 0 ? 700 : 400,
                    }}
                  >
                    {job.balance > 0 ? money(job.balance) : '—'}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={SERVICE_STATUS_LABELS[job.status]}
                      sx={{
                        bgcolor: STATUS_TONE[job.status],
                        color: '#fff',
                        fontWeight: 600,
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          component="div"
          count={jobs.data?.total ?? 0}
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

      {intakeOpen && (
        <ServiceIntakeDialog
          onClose={() => setIntakeOpen(false)}
          onCreated={(id) => {
            setIntakeOpen(false);
            refreshAll();
            setDetailId(id);
          }}
        />
      )}

      {detailId && (
        <ServiceDetailDialog
          serviceOrderId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={refreshAll}
        />
      )}
    </Stack>
  );
}
