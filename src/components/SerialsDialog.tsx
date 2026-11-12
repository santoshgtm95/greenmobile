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
  const queryClient = useQueryClient();
  const [bulk, setBulk] = useState('');
  const [error, setError] = useState<string | null>(null);

  const serials = useQuery({
    queryKey: ['serials', product.id],
    queryFn: () => api.serials.list({ productId: product.id }),
  });

  // One phone per line, so a scanner can simply be fired at the box; a dual-SIM
  // phone puts its second IMEI on the same line after a space or comma.
  const parsed = bulk
    .split('\n')
    .map((line) => line.split(/[\s,]+/).filter(Boolean))
    .filter((codes) => codes.length > 0);
  const tooMany = parsed.some((codes) => codes.length > 2);

  const add = useMutation({
    mutationFn: () =>
      api.serials.add({
        productId: product.id,
        serials: parsed.map(([imei1, imei2]) => ({ imei1, imei2 })),
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
            placeholder={'354121080000001 354121080000019\n354121080000027'}
            error={tooMany}
            helperText={
              tooMany
                ? 'A phone has at most two IMEIs — put each phone on its own line.'
                : parsed.length > 0
                ? `${parsed.length} phone(s) ready — each becomes one unit of stock`
                : 'One phone per line; put a second IMEI on the same line after a space. Scanning works too.'
            }
          />

          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              onClick={() => {
                setError(null);
                add.mutate();
              }}
              disabled={add.isPending || parsed.length === 0 || tooMany}
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

          <SerialTable
            productId={product.id}
            onMarkDefective={(id) => markDefective.mutate(id)}
            busy={markDefective.isPending}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Every IMEI / serial unit of one product, with both IMEIs of a dual-SIM phone. */
export function SerialTable({
  productId,
  onMarkDefective,
  busy,
}: {
  productId: string;
  /** Shows the "mark faulty" button on available units when given. */
  onMarkDefective?: (serialId: string) => void;
  busy?: boolean;
}) {
  const money = useMoneyFormatter();
  const serials = useQuery({
    queryKey: ['serials', productId],
    queryFn: () => api.serials.list({ productId }),
  });
  const rows = serials.data ?? [];

  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>IMEI 1</TableCell>
          <TableCell>IMEI 2</TableCell>
          <TableCell align="right">Cost</TableCell>
          <TableCell>Status</TableCell>
          <TableCell>Warranty ends</TableCell>
          {onMarkDefective && <TableCell align="right" />}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>
              {serials.isLoading ? 'Loading…' : 'No IMEI numbers yet.'}
            </TableCell>
          </TableRow>
        )}
        {rows.map((serial) => (
          <TableRow key={serial.id} hover>
            <TableCell sx={{ fontFamily: 'monospace' }}>{serial.imei1 ?? serial.serialNumber ?? '—'}</TableCell>
            <TableCell sx={{ fontFamily: 'monospace' }}>{serial.imei2 ?? '—'}</TableCell>
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
            {onMarkDefective && (
              <TableCell align="right">
                {serial.status === 'AVAILABLE' && (
                  <Tooltip title="Mark faulty — removes it from sellable stock">
                    <IconButton size="small" onClick={() => onMarkDefective(serial.id)} disabled={busy}>
                      <ReportProblemIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
