import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import TableViewIcon from '@mui/icons-material/TableView';
import DescriptionIcon from '@mui/icons-material/Description';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMoneyFormatter } from '../hooks/useSettings';
import { PosApiError } from '@shared/errors';
import {
  REPORT_KINDS,
  REPORT_LABELS,
  type CellValue,
  type ColumnType,
  type ExportFormat,
  type ReportKind,
  type ReportTable,
} from '@shared/report';
import {
  DATE_PRESETS,
  DATE_PRESET_LABELS,
  resolvePreset,
  formatBusinessDay,
  formatInstant,
  type DatePreset,
} from '@shared/datetime';

/**
 * Reports (spec §46–§50, §90).
 *
 * Every report arrives from the main process as a described structure — headline
 * figures plus typed tables — and this one renderer draws all eight. Export goes
 * back to the main process, which rebuilds the same report from the database, so
 * the file can never disagree with what is on screen.
 */
export default function ReportsPage() {
  const money = useMoneyFormatter();

  const [kind, setKind] = useState<ReportKind>('SALES');
  const [preset, setPreset] = useState<DatePreset>('THIS_MONTH');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(
    () => resolvePreset(preset, { from: customFrom || undefined, to: customTo || undefined }),
    [preset, customFrom, customTo],
  );

  const report = useQuery({
    queryKey: ['report', kind, range],
    queryFn: () => api.reports.build({ kind, from: range.from, to: range.to }),
    placeholderData: (previous) => previous,
  });

  const exportReport = useMutation({
    mutationFn: (format: ExportFormat) =>
      api.reports.export({
        kind,
        from: range.from,
        to: range.to,
        format,
        // A file the shop will keep is worth choosing a location for; printing
        // has nowhere to save to.
        chooseLocation: format !== 'PRINT',
      }),
    onSuccess: (result, format) => {
      setError(null);
      if (format === 'PRINT') setToast('Sent to the printer.');
      else if (result.saved) setToast(`Saved to ${result.path}`);
    },
    onError: (err) =>
      setError(err instanceof PosApiError ? err.message : 'Unable to export this report.'),
  });

  const openFolder = useMutation({
    mutationFn: () => api.reports.openExportsFolder(),
    onError: () => setError('Unable to open the exports folder.'),
  });

  const data = report.data;

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Reports</Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {report.isError && (
        <Alert severity="error">
          {report.error instanceof PosApiError ? report.error.message : 'Unable to build this report.'}
        </Alert>
      )}

      <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Tabs
          value={kind}
          onChange={(_e, next) => setKind(next as ReportKind)}
          variant="scrollable"
          scrollButtons="auto"
        >
          {REPORT_KINDS.map((option) => (
            <Tab key={option} value={option} label={REPORT_LABELS[option]} />
          ))}
        </Tabs>

        <Divider />

        {/* One filter row scoping the whole report, plus the export actions. */}
        <Stack
          direction={{ xs: 'column', lg: 'row' }}
          spacing={2}
          sx={{ p: 2, alignItems: 'center' }}
        >
          <TextField
            select
            label="Period"
            value={preset}
            onChange={(e) => setPreset(e.target.value as DatePreset)}
            sx={{ maxWidth: 190 }}
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

          <Box sx={{ flexGrow: 1 }} />

          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Button
              size="small"
              startIcon={<PrintIcon />}
              onClick={() => exportReport.mutate('PRINT')}
              disabled={exportReport.isPending}
            >
              Print
            </Button>
            <Button
              size="small"
              startIcon={<PictureAsPdfIcon />}
              onClick={() => exportReport.mutate('PDF')}
              disabled={exportReport.isPending}
            >
              PDF
            </Button>
            <Button
              size="small"
              startIcon={<TableViewIcon />}
              onClick={() => exportReport.mutate('XLSX')}
              disabled={exportReport.isPending}
            >
              Excel
            </Button>
            <Button
              size="small"
              startIcon={<DescriptionIcon />}
              onClick={() => exportReport.mutate('CSV')}
              disabled={exportReport.isPending}
            >
              CSV
            </Button>
            <Button
              size="small"
              color="inherit"
              startIcon={<FolderOpenIcon />}
              onClick={() => openFolder.mutate()}
            >
              Exports folder
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {data && (
        <Stack
          spacing={2}
          sx={{ opacity: report.isFetching ? 0.7 : 1, transition: 'opacity .15s' }}
        >
          <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline' }}>
            <Typography variant="h6">{data.title}</Typography>
            <Typography variant="body2" color="text.secondary">
              {data.periodLabel} · amounts in {data.currency}
            </Typography>
          </Stack>

          {/* Headline figures (spec §47). */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
              gap: 2,
            }}
          >
            {data.figures.map((figure) => (
              <Paper
                key={figure.label}
                sx={{
                  p: 2,
                  border: figure.emphasis ? '2px solid' : '1px solid',
                  borderColor: figure.emphasis ? 'primary.main' : 'divider',
                }}
              >
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {figure.label}
                </Typography>
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 700,
                    mt: 0.25,
                    color:
                      figure.emphasis && typeof figure.value === 'number' && figure.value < 0
                        ? 'error.main'
                        : 'text.primary',
                  }}
                >
                  {formatCell(figure.value, figure.type, money)}
                </Typography>
                {figure.hint && (
                  <Typography variant="caption" color="text.secondary">
                    {figure.hint}
                  </Typography>
                )}
              </Paper>
            ))}
          </Box>

          {data.tables.map((table) => (
            <ReportTableView key={table.title} table={table} money={money} />
          ))}
        </Stack>
      )}

      {report.isLoading && !data && (
        <Typography color="text.secondary">Building the report…</Typography>
      )}

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={6000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setToast(null)} sx={{ width: '100%' }}>
          {toast}
        </Alert>
      </Snackbar>
    </Stack>
  );
}

const NUMERIC_TYPES: ColumnType[] = ['money', 'number', 'percent'];

/** Formats a described cell. Money always arrives as minor units. */
function formatCell(
  value: CellValue,
  type: ColumnType,
  money: (minor: number) => string,
): string {
  if (value === null || value === undefined || value === '') {
    return type === 'text' ? '' : '—';
  }
  switch (type) {
    case 'money':
      return typeof value === 'number' ? money(value) : String(value);
    case 'number':
      return typeof value === 'number' ? value.toLocaleString('en-US') : String(value);
    case 'percent':
      return typeof value === 'number' ? `${value}%` : String(value);
    case 'day':
      return formatBusinessDay(String(value));
    case 'instant':
      return formatInstant(String(value));
    default:
      return String(value);
  }
}

function ReportTableView({
  table,
  money,
}: {
  table: ReportTable;
  money: (minor: number) => string;
}) {
  return (
    <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ px: 2, pt: 2, pb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {table.title}
        </Typography>
        {table.subtitle && (
          <Typography variant="caption" color="text.secondary">
            {table.subtitle}
          </Typography>
        )}
      </Box>

      {table.rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 2 }}>
          {table.emptyMessage ?? 'Nothing to report.'}
        </Typography>
      ) : (
        <TableContainer sx={{ maxHeight: 480 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {table.columns.map((column) => (
                  <TableCell
                    key={column.key}
                    align={NUMERIC_TYPES.includes(column.type) ? 'right' : 'left'}
                  >
                    {column.label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {table.rows.map((row, index) => {
                // A row with nothing in it is a deliberate spacer in the P&L.
                const isSpacer = table.columns.every((column) => {
                  const value = row[column.key];
                  return value === null || value === undefined || value === '';
                });
                return (
                  <TableRow key={index} hover={!isSpacer}>
                    {table.columns.map((column) => {
                      const numeric = NUMERIC_TYPES.includes(column.type);
                      const value = row[column.key] ?? null;
                      const negative = typeof value === 'number' && value < 0;
                      return (
                        <TableCell
                          key={column.key}
                          align={numeric ? 'right' : 'left'}
                          sx={{
                            fontVariantNumeric: numeric ? 'tabular-nums' : undefined,
                            color: negative ? 'error.main' : undefined,
                            borderBottom: isSpacer ? 'none' : undefined,
                            py: isSpacer ? 0.5 : undefined,
                          }}
                        >
                          {isSpacer ? '' : formatCell(value, column.type, money)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}

              {table.totals && (
                <TableRow>
                  {table.columns.map((column, index) => {
                    const total = table.totals?.[column.key];
                    const numeric = NUMERIC_TYPES.includes(column.type);
                    return (
                      <TableCell
                        key={column.key}
                        align={numeric ? 'right' : 'left'}
                        sx={{
                          fontWeight: 700,
                          borderTop: '2px solid',
                          borderTopColor: 'divider',
                          fontVariantNumeric: numeric ? 'tabular-nums' : undefined,
                        }}
                      >
                        {total !== undefined
                          ? formatCell(total, column.type, money)
                          : index === 0
                            ? 'Total'
                            : ''}
                      </TableCell>
                    );
                  })}
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
}
