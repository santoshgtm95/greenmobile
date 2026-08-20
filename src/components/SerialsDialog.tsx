import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMoneyFormatter } from '../hooks/useSettings';
import { PosApiError } from '@shared/errors';
import { SERIAL_STATUS_LABELS } from '@shared/domain';
import { formatInstant } from '@shared/datetime';
import type { Product } from '@shared/api';

const STATUS_COLOR = {
  AVAILABLE: 'success',
  SOLD: 'default',
  RETURNED: 'warning',
  DEFECTIVE: 'error',
  RESERVED: 'info',
} as const;

/**
 * IMEI / serial management (spec §13).
 *
 * Each unit is one item of stock, so adding numbers here is what puts
 * serialized products on the shelf.
 */
export default function SerialsDialog({
  product,
  onClose,
  onChanged,
}: {
  product: Product;
  onClose: () => void;
  onChanged: () => void;
}) {
  const money = useMoneyFormatter();
  const queryClient = useQueryClient();
  const [bulk, setBulk] = useState('');
  const [error, setError] = useState<string | null>(null);

  const serials = useQuery({
    queryKey: ['serials', product.id],
    queryFn: () => api.serials.list({ productId: product.id }),
  });

  // One IMEI per line, so a scanner can simply be fired at the box.
  const parsed = bulk
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const add = useMutation({
    mutationFn: () =>
      api.serials.add({
        productId: product.id,
        serials: parsed.map((code) => ({ imei1: code })),
      }),
    onSuccess: () => {
      setBulk('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['serials', product.id] });
      onChanged();
    },
    onError: (err) =>
      setError(err instanceof PosApiError ? err.message : 'Unable to add those serial numbers.'),
  });

  const markDefective = useMutation({
    mutationFn: (serialId: string) =>
      api.serials.markDefective({ serialId, reason: 'Marked faulty in stock' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['serials', product.id] });
      onChanged();
    },
    onError: (err) =>
      setError(err instanceof PosApiError ? err.message : 'Unable to update that unit.'),
  });

  const rows = serials.data ?? [];

  return (
    <Dialog open fullWidth maxWidth="md" onClose={onClose}>
      <DialogTitle>IMEI / serial numbers — {product.name}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

          <TextField
            label="Add IMEI or serial numbers"
            multiline
            minRows={3}
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            placeholder={'354121080000001\n354121080000002'}
            helperText={
              parsed.length > 0
                ? `${parsed.length} number(s) ready — each becomes one unit of stock`
                : 'One per line. Scan straight into this box if you have a scanner.'
            }
          />

          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              onClick={() => {
                setError(null);
                add.mutate();
              }}
              disabled={add.isPending || parsed.length === 0}
            >
              {add.isPending ? 'Adding…' : `Add ${parsed.length || ''} to stock`}
            </Button>
          </Stack>

          <Divider />

          <Stack direction="row" spacing={2}>
            <Typography variant="body2" color="text.secondary">
              In stock: <strong>{product.stockQuantity}</strong>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Available: <strong>{rows.filter((s) => s.status === 'AVAILABLE').length}</strong>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Sold: <strong>{rows.filter((s) => s.status === 'SOLD').length}</strong>
            </Typography>
          </Stack>

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>IMEI / Serial</TableCell>
                <TableCell align="right">Cost</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Warranty ends</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                    No serial numbers yet.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((serial) => (
                <TableRow key={serial.id} hover>
                  <TableCell sx={{ fontFamily: 'monospace' }}>
                    {serial.imei1 ?? serial.serialNumber ?? '—'}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {money(serial.purchasePrice)}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={STATUS_COLOR[serial.status]}
                      variant={serial.status === 'AVAILABLE' ? 'filled' : 'outlined'}
                      label={SERIAL_STATUS_LABELS[serial.status]}
                    />
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>
                    {serial.warrantyEndDate ? formatInstant(serial.warrantyEndDate) : '—'}
                  </TableCell>
                  <TableCell align="right">
                    {serial.status === 'AVAILABLE' && (
                      <Tooltip title="Mark faulty — removes it from sellable stock">
                        <IconButton
                          size="small"
                          onClick={() => markDefective.mutate(serial.id)}
                          disabled={markDefective.isPending}
                        >
                          <ReportProblemIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
