import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
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
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import TagIcon from '@mui/icons-material/Tag';
import PercentIcon from '@mui/icons-material/Percent';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import SummaryCard from '../components/SummaryCard';
import { historyTableSx } from '../components/historyTableSx';
import { compactFiltersSx } from '../components/compactSx';
import {
  PageHeader,
  SummaryPanel,
  TableCardHeader,
  cardGrid,
  pillTabsPaperSx,
  pillTabsSx,
} from '../components/PageLayout';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { compactPageSx } from '../components/compactSx';
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
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);

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

  const exportAs = (format: ExportFormat) => {
    setExportAnchor(null);
    exportReport.mutate(format);
  };

  return (
    <Stack spacing={2} sx={compactPageSx}>
      <PageHeader
        title="Reports"
        subtitle="Sales, stock, money and profit for any period: the same figures you print or export"
        actions={
          <>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', ...compactFiltersSx }}>
              <TextField
                select
                size="small"
                label="Period"
                value={preset}
                onChange={(e) => setPreset(e.target.value as DatePreset)}
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
            <Button
              variant="outlined"
              startIcon={<FileDownloadOutlinedIcon />}
              onClick={(e) => setExportAnchor(e.currentTarget)}
              disabled={exportReport.isPending}
              aria-haspopup="menu"
            >
              Export
            </Button>
            <Button
              variant="contained"
              startIcon={<PrintIcon />}
              onClick={() => exportReport.mutate('PRINT')}
              disabled={exportReport.isPending}
            >
              Print
            </Button>
            <Menu anchorEl={exportAnchor} open={Boolean(exportAnchor)} onClose={() => setExportAnchor(null)}>
              <MenuItem onClick={() => exportAs('PDF')}>
                <ListItemIcon>
                  <PictureAsPdfIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="PDF" secondary="To print or send" />
              </MenuItem>
              <MenuItem onClick={() => exportAs('XLSX')}>
                <ListItemIcon>
                  <TableViewIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="Excel" secondary="To work on the figures" />
              </MenuItem>
              <MenuItem onClick={() => exportAs('CSV')}>
                <ListItemIcon>
                  <DescriptionIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="CSV" secondary="For other software" />
              </MenuItem>
              <MenuItem
                divider={false}
                onClick={() => {
                  setExportAnchor(null);
                  openFolder.mutate();
                }}
                sx={{ borderTop: 1, borderColor: 'divider' }}
              >
                <ListItemIcon>
                  <FolderOpenIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="Open exports folder" />
              </MenuItem>
            </Menu>
          </>
        }
      />

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

      <Paper sx={pillTabsPaperSx}>
        <Tabs
          sx={pillTabsSx}
          value={kind}
          onChange={(_e, next) => setKind(next as ReportKind)}
          variant="scrollable"
          scrollButtons="auto"
        >
          {REPORT_KINDS.map((option) => (
            <Tab key={option} value={option} label={REPORT_LABELS[option]} />
          ))}
        </Tabs>
      </Paper>

      {/* A thin bar while a new period or report is being built; the old one stays visible meanwhile. */}
      <Box sx={{ height: 3, mt: '6px !important' }}>
        {report.isFetching && <LinearProgress sx={{ height: 3, borderRadius: 2 }} />}
      </Box>

      {data && (
        <Stack spacing={2} sx={{ mt: '6px !important', opacity: report.isFetching ? 0.6 : 1, transition: 'opacity .15s' }}>
          {/* Headline figures (spec §47). */}
          <SummaryPanel tint title={data.title} caption={`${data.periodLabel} · amounts in ${data.currency}`}>
            <Box sx={{ ...cardGrid, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
              {data.figures.map((figure) => {
                const negative = typeof figure.value === 'number' && figure.value < 0;
                return (
                  <SummaryCard
                    key={figure.label}
                    label={figure.label}
                    value={formatCell(figure.value, figure.type, money)}
                    caption={figure.hint ?? (figure.emphasis ? 'The bottom line' : '')}
                    icon={figureIcon(figure.type, Boolean(figure.emphasis))}
                    tone={negative ? 'error' : figure.emphasis ? 'success' : undefined}
                  />
                );
              })}
            </Box>
          </SummaryPanel>

          {data.tables.map((table) => (
            <ReportTableView key={table.title} table={table} money={money} />
          ))}
        </Stack>
      )}

      {report.isLoading && !data && (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          Building the report…
        </Typography>
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

function figureIcon(type: ColumnType, emphasis: boolean) {
  if (emphasis) return <InsightsOutlinedIcon fontSize="small" />;
  if (type === 'money') return <PaymentsOutlinedIcon fontSize="small" />;
  if (type === 'percent') return <PercentIcon fontSize="small" />;
  return <TagIcon fontSize="small" />;
}

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
    <Paper sx={historyTableSx}>
      <TableCardHeader
        title={table.title}
        caption={[table.subtitle, `${table.rows.length} row${table.rows.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
      />

      {table.rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 4, textAlign: 'center', borderTop: 1, borderColor: 'divider' }}>
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

            </TableBody>
            {table.totals && (
              <TableFooter>
                <TableRow>
                  {table.columns.map((column, index) => {
                    const total = table.totals?.[column.key];
                    const numeric = NUMERIC_TYPES.includes(column.type);
                    return (
                      <TableCell
                        key={column.key}
                        align={numeric ? 'right' : 'left'}
                        sx={{
                          fontWeight: 800,
                          fontSize: 'inherit',
                          color: 'text.primary',
                          borderTop: '2px solid',
                          borderTopColor: 'divider',
                          fontVariantNumeric: numeric ? 'tabular-nums' : undefined,
                          // Stays in sight while a long table scrolls.
                          position: 'sticky',
                          bottom: 0,
                          bgcolor: 'background.paper',
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
              </TableFooter>
            )}
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
}
