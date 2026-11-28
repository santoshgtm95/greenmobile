import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
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
import { alpha } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import BuildIcon from '@mui/icons-material/Build';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useMoneyFormatter } from '../hooks/useSettings';
import { useDebounced } from '../hooks/useDebounced';
import ServiceIntakeDialog from '../components/ServiceIntakeDialog';
import ServiceDetailDialog from '../components/ServiceDetailDialog';
import { historyTableSx } from '../components/historyTableSx';
import { PageHeader, SummaryPanel, TableCardHeader } from '../components/PageLayout';
import { PosApiError } from '@shared/errors';
import {
  SERVICE_BOARD_STATUSES,
  SERVICE_STATUS_LABELS,
  SERVICE_STATUSES,
  type ServiceStatus,
} from '@shared/domain';
import { formatInstant, formatBusinessDay } from '@shared/datetime';

/** Colour per stage, so the shop can read the board and the list at a glance. */
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

/** Stages where the device has left the shop or the job is over. */
const CLOSED: ReadonlySet<ServiceStatus> = new Set(['COMPLETED', 'DELIVERED', 'CANCELLED']);

/** A soft status pill: tinted background, coloured dot and text. */
function StatusChip({ status }: { status: ServiceStatus }) {
  const tone = STATUS_TONE[status];
  return (
    <Chip
      size="small"
      label={SERVICE_STATUS_LABELS[status]}
      icon={<Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: tone }} />}
      sx={{
        bgcolor: alpha(tone, 0.1),
        color: tone,
        fontWeight: 700,
        border: `1px solid ${alpha(tone, 0.25)}`,
        '& .MuiChip-icon': { ml: 1, mr: -0.25 },
      }}
    />
  );
}

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
  const inShop = SERVICE_BOARD_STATUSES.filter((s) => s !== 'DELIVERED').reduce(
    (sum, s) => sum + (board.data?.[s] ?? 0),
    0,
  );
  const biggest = Math.max(1, ...SERVICE_BOARD_STATUSES.map((s) => board.data?.[s] ?? 0));
  const scope = status ? SERVICE_STATUS_LABELS[status] : openOnly ? 'Open jobs' : 'All jobs';
  const now = Date.now();

  return (
    <Stack spacing={2}>
      <PageHeader
        title="Services"
        subtitle="Repairs in the shop, from the counter back to the customer's hand"
        actions={
          can('services.manage') && (
            <Button variant="contained" startIcon={<BuildIcon />} onClick={() => setIntakeOpen(true)}>
              Receive Device
            </Button>
          )
        }
      />

      {jobs.isError && (
        <Alert severity="error">
          {jobs.error instanceof PosApiError ? jobs.error.message : 'Unable to load service jobs.'}
        </Alert>
      )}

      {/* Status board (spec §51): each stage filters the list below. */}
      <SummaryPanel
        tint
        title="Repair pipeline"
        caption="Pick a stage to see its jobs; pick it again to clear"
        action={<Chip size="small" color="primary" label={`${inShop} in the shop`} sx={{ fontWeight: 700 }} />}
      >
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 1.25 }}>
          {SERVICE_BOARD_STATUSES.map((boardStatus) => {
            const count = board.data?.[boardStatus] ?? 0;
            const active = status === boardStatus;
            const tone = STATUS_TONE[boardStatus];
            return (
              <ButtonBase
                key={boardStatus}
                aria-pressed={active}
                onClick={() => {
                  setStatus(active ? '' : boardStatus);
                  setPage(0);
                }}
                sx={(theme) => ({
                  p: 1.5,
                  borderRadius: 2.5,
                  display: 'block',
                  textAlign: 'left',
                  bgcolor: active ? alpha(tone, 0.1) : 'background.paper',
                  border: '1px solid',
                  borderColor: active ? tone : 'divider',
                  boxShadow: active ? `0 4px 14px ${alpha(tone, 0.25)}` : 'none',
                  opacity: count === 0 && !active ? 0.6 : 1,
                  transition: 'transform .15s, box-shadow .15s, border-color .15s',
                  '&:hover': { transform: 'translateY(-2px)', borderColor: tone, opacity: 1 },
                  '&.Mui-focusVisible': { outline: `2px solid ${tone}`, outlineOffset: 2 },
                  [`@media (prefers-reduced-motion: reduce)`]: { transition: 'none', '&:hover': { transform: 'none' } },
                  color: theme.palette.text.primary,
                })}
              >
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: tone, flexShrink: 0 }} />
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ fontWeight: 600 }}>
                    {SERVICE_STATUS_LABELS[boardStatus]}
                  </Typography>
                </Stack>
                <Typography sx={{ fontWeight: 800, fontSize: '1.5rem', lineHeight: 1.3, fontVariantNumeric: 'tabular-nums' }}>
                  {count}
                </Typography>
                {/* Share of the busiest stage, so a bottleneck stands out. */}
                <Box sx={{ height: 4, borderRadius: 2, bgcolor: alpha(tone, 0.12), overflow: 'hidden' }}>
                  <Box sx={{ height: 1, width: `${(count / biggest) * 100}%`, bgcolor: tone, borderRadius: 2 }} />
                </Box>
              </ButtonBase>
            );
          })}
        </Box>
      </SummaryPanel>

      <Paper sx={historyTableSx}>
        <TableCardHeader title="Jobs" caption={`${jobs.data?.total ?? 0} listed · ${scope}`}>
          <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
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
              sx={{ flex: '1 1 260px' }}
            />
            <TextField
              select
              label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as ServiceStatus | '');
                setPage(0);
              }}
              sx={{ width: 190 }}
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
        </TableCardHeader>
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
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {search || status
                        ? 'No jobs match these filters.'
                        : openOnly
                          ? 'No devices are in the shop right now.'
                          : 'No service jobs yet.'}
                    </Typography>
                    {!search && !status && (
                      <Typography variant="caption">Book a repair in with Receive Device.</Typography>
                    )}
                  </TableCell>
                </TableRow>
              )}

              {rows.map((job) => {
                const overdue = Boolean(job.expectedDate) && !CLOSED.has(job.status) && Date.parse(job.expectedDate!) < now;
                return (
                  <TableRow key={job.id} hover sx={{ cursor: 'pointer' }} onClick={() => setDetailId(job.id)}>
                    <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{job.serviceNumber}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {formatBusinessDay(job.receivedDay)}
                      {job.expectedDate && (
                        <Typography
                          variant="caption"
                          color={overdue ? 'error.main' : 'text.secondary'}
                          sx={{ display: 'block', fontWeight: overdue ? 700 : 400 }}
                        >
                          {overdue ? 'overdue · ' : 'due '}
                          {formatInstant(job.expectedDate)}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ fontWeight: 600 }}>{job.customerName}</Box>
                      {job.customerPhone && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {job.customerPhone}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {job.deviceBrand} {job.deviceModel}
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{job.imei ?? '—'}</TableCell>
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
                      <StatusChip status={job.status} />
                    </TableCell>
                  </TableRow>
                );
              })}
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
        <ServiceDetailDialog serviceOrderId={detailId} onClose={() => setDetailId(null)} onChanged={refreshAll} />
      )}
    </Stack>
  );
}
