import { useState } from 'react';
import {
  Alert,
  Button,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Snackbar,
} from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import TableViewIcon from '@mui/icons-material/TableView';
import DescriptionIcon from '@mui/icons-material/Description';
import PrintIcon from '@mui/icons-material/Print';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { PosApiError } from '@shared/errors';
import type { ExportFormat } from '@shared/report';
import type {
  BankTransactionListQuery,
  CustomerListQuery,
  ExpenseListQuery,
  ProductListQuery,
  SaleListQuery,
} from '@shared/validation';

/**
 * "Export this list" (spec §56).
 *
 * Takes the screen's own filter object and hands it to the main process, which
 * re-runs the query and builds the file from the database. The renderer never
 * sends the rows it happens to be holding — so the file contains the whole
 * filtered set, not just the page that was on screen.
 */
export type ExportTarget =
  | { dataset: 'PRODUCT_LIST'; query: ProductListQuery }
  | { dataset: 'CUSTOMER_LIST'; query: CustomerListQuery }
  | { dataset: 'SALE_LIST'; query: SaleListQuery }
  | { dataset: 'EXPENSE_LIST'; query: ExpenseListQuery }
  | { dataset: 'BANK_TRANSACTION_LIST'; query: BankTransactionListQuery }
  | { dataset: 'INVENTORY_LIST'; query?: Record<string, never> };

const FORMATS: Array<{ format: ExportFormat; label: string; icon: React.ReactNode }> = [
  { format: 'XLSX', label: 'Excel spreadsheet', icon: <TableViewIcon fontSize="small" /> },
  { format: 'CSV', label: 'CSV file', icon: <DescriptionIcon fontSize="small" /> },
  { format: 'PDF', label: 'PDF document', icon: <PictureAsPdfIcon fontSize="small" /> },
  { format: 'PRINT', label: 'Print', icon: <PrintIcon fontSize="small" /> },
];

export default function ExportMenu({
  target,
  size = 'small',
  label = 'Export',
  disabled,
}: {
  target: ExportTarget;
  size?: 'small' | 'medium';
  label?: string;
  disabled?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportList = useMutation({
    mutationFn: (format: ExportFormat) =>
      api.data.exportList({
        ...target,
        format,
        // A file worth keeping deserves a chosen location; printing has nowhere
        // to save to.
        chooseLocation: format !== 'PRINT',
      } as Parameters<typeof api.data.exportList>[0]),
    onSuccess: (result, format) => {
      setError(null);
      if (format === 'PRINT') setToast('Sent to the printer.');
      else if (result.saved) setToast(`Saved to ${result.path}`);
    },
    onError: (err) =>
      setError(err instanceof PosApiError ? err.message : 'This list could not be exported.'),
  });

  return (
    <>
      <Button
        size={size}
        startIcon={<FileDownloadIcon />}
        onClick={(e) => setAnchor(e.currentTarget)}
        disabled={disabled || exportList.isPending}
      >
        {exportList.isPending ? 'Exporting…' : label}
      </Button>

      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {FORMATS.map((entry) => (
          <MenuItem
            key={entry.format}
            onClick={() => {
              setAnchor(null);
              exportList.mutate(entry.format);
            }}
          >
            <ListItemIcon>{entry.icon}</ListItemIcon>
            <ListItemText>{entry.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>

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

      <Snackbar
        open={Boolean(error)}
        autoHideDuration={9000}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setError(null)} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </>
  );
}
