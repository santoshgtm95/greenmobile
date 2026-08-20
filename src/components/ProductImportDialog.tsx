import { useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  Switch,
  FormControlLabel,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { PosApiError } from '@shared/errors';
import { useMoneyFormatter } from '../hooks/useSettings';
import {
  IMPORT_ACTION_LABELS,
  IMPORT_FIELD_LABELS,
  type ImportPreview,
  type ImportResult,
  type ImportRow,
} from '@shared/import';

/**
 * Import products from a spreadsheet (spec §57).
 *
 * The dialog is mostly the preview, because that is the feature: a shop pastes
 * in a supplier's price list and needs to see, before anything is written, which
 * rows will be created, which will change a product they already have, and which
 * are wrong and why.
 */
export default function ProductImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (result: ImportResult) => void;
}) {
  const money = useMoneyFormatter();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problemsOnly, setProblemsOnly] = useState(false);

  const reset = () => {
    setPreview(null);
    setError(null);
    setProblemsOnly(false);
  };

  const choose = useMutation({
    mutationFn: () => api.data.importPreview(),
    onSuccess: (result) => {
      setError(null);
      // Null means the file dialog was cancelled — not a failure.
      if (result) setPreview(result);
    },
    onError: (err) =>
      setError(err instanceof PosApiError ? err.message : 'That file could not be read.'),
  });

  const commit = useMutation({
    mutationFn: (importId: string) => api.data.importCommit({ importId }),
    onSuccess: (result) => {
      reset();
      onImported(result);
    },
    onError: (err) =>
      setError(err instanceof PosApiError ? err.message : 'The import could not be completed.'),
  });

  const template = useMutation({
    mutationFn: () => api.data.importTemplate(),
    onError: () => setError('The template could not be saved.'),
  });

  const cancel = () => {
    if (preview) void api.data.importCancel({ importId: preview.importId }).catch(() => {});
    reset();
    onClose();
  };

  const importable = preview ? preview.summary.create + preview.summary.update : 0;
  const rows = preview
    ? problemsOnly
      ? preview.rows.filter((row) => row.errors.length > 0 || row.warnings.length > 0)
      : preview.rows
    : [];

  return (
    <Dialog open={open} onClose={commit.isPending ? undefined : cancel} maxWidth="xl" fullWidth>
      <DialogTitle>Import products from Excel</DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {!preview && (
            <>
              <Alert severity="info">
                <AlertTitle>Nothing is saved until you press Import</AlertTitle>
                Choose an .xlsx or .csv file. The first row must name the columns —{' '}
                {Object.values(IMPORT_FIELD_LABELS).join(', ')} — though common alternatives such as
                &ldquo;Cost&rdquo; or &ldquo;Qty&rdquo; are recognised too.
              </Alert>

              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  startIcon={<UploadFileIcon />}
                  onClick={() => choose.mutate()}
                  disabled={choose.isPending}
                >
                  {choose.isPending ? 'Reading…' : 'Choose file'}
                </Button>
                <Button
                  startIcon={<DownloadIcon />}
                  onClick={() => template.mutate()}
                  disabled={template.isPending}
                >
                  Download template
                </Button>
              </Stack>

              {template.data?.saved && (
                <Typography variant="caption" color="text.secondary">
                  Template saved to {template.data.path}
                </Typography>
              )}

              {choose.isPending && (
                <Box sx={{ display: 'grid', placeItems: 'center', py: 3 }}>
                  <CircularProgress size={26} />
                </Box>
              )}
            </>
          )}

          {preview && (
            <>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={2}
                sx={{ alignItems: { md: 'center' } }}
              >
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {preview.fileName}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                  <Chip
                    size="small"
                    color="success"
                    label={`${preview.summary.create} new`}
                    variant={preview.summary.create ? 'filled' : 'outlined'}
                  />
                  <Chip
                    size="small"
                    color="info"
                    label={`${preview.summary.update} to update`}
                    variant={preview.summary.update ? 'filled' : 'outlined'}
                  />
                  <Chip
                    size="small"
                    color={preview.summary.skip ? 'error' : 'default'}
                    label={`${preview.summary.skip} with problems`}
                    variant={preview.summary.skip ? 'filled' : 'outlined'}
                  />
                  <Chip size="small" variant="outlined" label={`${preview.summary.total} rows`} />
                </Stack>
                <Box sx={{ flexGrow: 1 }} />
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={problemsOnly}
                      onChange={(e) => setProblemsOnly(e.target.checked)}
                    />
                  }
                  label="Only rows needing attention"
                />
              </Stack>

              {preview.missingColumns.length > 0 && (
                <Alert severity="info">
                  No column found for{' '}
                  {preview.missingColumns.map((field) => IMPORT_FIELD_LABELS[field]).join(', ')}.
                  Those values are left as they are on existing products, and default to zero on new
                  ones.
                </Alert>
              )}

              {(preview.summary.newCategories.length > 0 ||
                preview.summary.newBrands.length > 0) && (
                <Alert severity="info">
                  This import will also create{' '}
                  {preview.summary.newCategories.length > 0 && (
                    <>
                      the categories <strong>{preview.summary.newCategories.join(', ')}</strong>
                    </>
                  )}
                  {preview.summary.newCategories.length > 0 &&
                    preview.summary.newBrands.length > 0 &&
                    ' and '}
                  {preview.summary.newBrands.length > 0 && (
                    <>
                      the brands <strong>{preview.summary.newBrands.join(', ')}</strong>
                    </>
                  )}
                  .
                </Alert>
              )}

              {preview.summary.skip > 0 && (
                <Alert severity="warning">
                  {preview.summary.skip} row{preview.summary.skip === 1 ? '' : 's'} will not be
                  imported. Fix them in the spreadsheet and choose the file again, or import the
                  rest now and add them later.
                </Alert>
              )}

              {importable === 0 && (
                <Alert severity="error">
                  There is nothing to import — every row in this file has a problem.
                </Alert>
              )}

              <Paper variant="outlined">
                <TableContainer sx={{ maxHeight: 420 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell align="right">Row</TableCell>
                        <TableCell>Action</TableCell>
                        <TableCell>SKU</TableCell>
                        <TableCell>Product</TableCell>
                        <TableCell>Category</TableCell>
                        <TableCell>Brand</TableCell>
                        <TableCell align="right">Purchase</TableCell>
                        <TableCell align="right">Selling</TableCell>
                        <TableCell align="right">Stock</TableCell>
                        <TableCell align="right">Min</TableCell>
                        <TableCell>Notes</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.map((row) => (
                        <PreviewRow key={row.line} row={row} money={money} />
                      ))}
                      {rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={11}>
                            <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                              Every row is fine.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>

              <Divider />

              <Typography variant="caption" color="text.secondary">
                Stock arrives through the stock ledger, so every unit this import brings in is
                traceable. On a product you already have, the Stock column is treated as a stock
                count and recorded as a correction.
              </Typography>
            </>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        {preview && (
          <Button onClick={reset} disabled={commit.isPending}>
            Choose a different file
          </Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={cancel} disabled={commit.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={!preview || importable === 0 || commit.isPending}
          onClick={() => preview && commit.mutate(preview.importId)}
        >
          {commit.isPending
            ? 'Importing…'
            : `Import ${importable} product${importable === 1 ? '' : 's'}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const ACTION_COLOUR = {
  CREATE: 'success',
  UPDATE: 'info',
  SKIP: 'error',
} as const;

function PreviewRow({ row, money }: { row: ImportRow; money: (minor: number) => string }) {
  const skipped = row.action === 'SKIP';

  return (
    <TableRow
      hover
      sx={{
        // A skipped row is greyed rather than hidden: the user needs to see it
        // to know which line of their spreadsheet to fix.
        bgcolor: skipped ? 'action.hover' : undefined,
        '& td': { color: skipped ? 'text.secondary' : undefined },
      }}
    >
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {row.line}
      </TableCell>
      <TableCell>
        <Chip
          size="small"
          label={IMPORT_ACTION_LABELS[row.action]}
          color={ACTION_COLOUR[row.action]}
          variant={skipped ? 'outlined' : 'filled'}
        />
      </TableCell>
      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12.5 }}>{row.sku || '—'}</TableCell>
      <TableCell>{row.name || '—'}</TableCell>
      <TableCell>{row.category ?? '—'}</TableCell>
      <TableCell>{row.brand ?? '—'}</TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {row.purchasePrice === null ? '—' : money(row.purchasePrice)}
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {row.sellingPrice === null ? '—' : money(row.sellingPrice)}
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {row.stock ?? '—'}
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {row.minimumStock ?? '—'}
      </TableCell>
      <TableCell sx={{ maxWidth: 340 }}>
        <Stack spacing={0.5}>
          {row.errors.map((message) => (
            <Stack key={message} direction="row" spacing={0.5} sx={{ alignItems: 'flex-start' }}>
              <ErrorOutlineIcon color="error" sx={{ fontSize: 16, mt: '2px' }} />
              <Typography variant="caption" color="error.main">
                {message}
              </Typography>
            </Stack>
          ))}
          {row.warnings.map((message) => (
            <Stack key={message} direction="row" spacing={0.5} sx={{ alignItems: 'flex-start' }}>
              <Tooltip title="This row will still be imported">
                <WarningAmberIcon color="warning" sx={{ fontSize: 16, mt: '2px' }} />
              </Tooltip>
              <Typography variant="caption" color="text.secondary">
                {message}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </TableCell>
    </TableRow>
  );
}
