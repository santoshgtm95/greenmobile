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
  MenuItem,
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
 * Names units already in stock — one IMEI per unit that has none — without
 * moving stock. New phones arrive (with their IMEIs) on a purchase invoice.
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
  // One colour for the phones being added now; add each colour in its own batch.
  const [color, setColor] = useState('');
  const needsColor = product.colors.length > 0 && !color;
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
  // IMEIs name units already in stock: one per unit that has none yet.
  const tagged = (serials.data ?? []).filter((s) => s.status === 'AVAILABLE' || s.status === 'RESERVED').length;
  const untagged = serials.isLoading ? 0 : Math.max(product.stockQuantity - tagged, 0);
  const overLimit = parsed.length > untagged;

  const add = useMutation({
    mutationFn: () =>
      api.serials.add({
        productId: product.id,
        serials: parsed.map(([imei1, imei2]) => ({ imei1, imei2, color: color || undefined })),
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

          <Alert severity={untagged ? 'info' : 'success'} variant="outlined">
            {untagged
              ? `${untagged} unit(s) in stock have no IMEI yet — you can add up to ${untagged}. Stock does not change.`
              : 'Every unit in stock has an IMEI. New phones come in through a purchase invoice.'}
          </Alert>

          <TextField
            label="Add IMEI or serial numbers"
            multiline
            minRows={3}
            disabled={untagged === 0}
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            placeholder={'354121080000001 354121080000019\n354121080000027'}
            error={tooMany || overLimit}
            helperText={
              tooMany
                ? 'A phone has at most two IMEIs — put each phone on its own line.'
                : overLimit
                ? `Only ${untagged} unit(s) need an IMEI — remove ${parsed.length - untagged} line(s).`
                : parsed.length > 0
                ? `${parsed.length} of ${untagged} phone(s) ready`
                : 'One phone per line; put a second IMEI on the same line after a space. Scanning works too.'
            }
          />

          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
            {product.colors.length > 0 && (
              <TextField
                select
                size="small"
                label="Colour of these phones"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                disabled={untagged === 0}
                sx={{ minWidth: 220 }}
              >
                {product.colors.map((c) => (
                  <MenuItem key={c.name} value={c.name}>
                    {c.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <Button
              variant="contained"
              onClick={() => {
                setError(null);
                add.mutate();
              }}
              disabled={add.isPending || parsed.length === 0 || tooMany || overLimit || needsColor}
            >
              {add.isPending ? 'Adding…' : `Add ${parsed.length || ''} IMEI`}
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
            colors={product.colors.map((c) => c.name)}
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
  colors = [],
}: {
  productId: string;
  /** The product's saved colours; when given, in-stock units can change colour here. */
  colors?: string[];
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
  const queryClient = useQueryClient();
  const setColor = useMutation({
    mutationFn: (input: { serialId: string; color?: string }) => api.serials.setColor(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['serials', productId] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>IMEI 1</TableCell>
          <TableCell>IMEI 2</TableCell>
          <TableCell>Colour</TableCell>
          <TableCell align="right">Cost</TableCell>
          <TableCell>Status</TableCell>
          <TableCell>Warranty ends</TableCell>
          {onMarkDefective && <TableCell align="right" />}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={7} align="center" sx={{ py: 3, color: 'text.secondary' }}>
              {serials.isLoading ? 'Loading…' : 'No IMEI numbers yet.'}
            </TableCell>
          </TableRow>
        )}
        {rows.map((serial) => (
          <TableRow key={serial.id} hover>
            <TableCell sx={{ fontFamily: 'monospace' }}>{serial.imei1 ?? serial.serialNumber ?? '—'}</TableCell>
            <TableCell sx={{ fontFamily: 'monospace' }}>{serial.imei2 ?? '—'}</TableCell>
            <TableCell>
              {colors.length > 0 && (serial.status === 'AVAILABLE' || serial.status === 'RESERVED') ? (
                <TextField
                  select
                  size="small"
                  variant="standard"
                  value={serial.color ?? ''}
                  onChange={(e) => setColor.mutate({ serialId: serial.id, color: e.target.value || undefined })}
                  disabled={setColor.isPending}
                  slotProps={{ htmlInput: { 'aria-label': `Colour of ${serial.imei1 ?? serial.serialNumber ?? 'unit'}` } }}
                  sx={{ minWidth: 110 }}
                >
                  <MenuItem value="">
                    <em>None</em>
                  </MenuItem>
                  {colors.map((name) => (
                    <MenuItem key={name} value={name}>
                      {name}
                    </MenuItem>
                  ))}
                </TextField>
              ) : (
                (serial.color ?? '—')
              )}
              {setColor.isError && setColor.variables?.serialId === serial.id && (
                <Typography variant="caption" color="error" sx={{ display: 'block' }}>
                  {setColor.error.message}
                </Typography>
              )}
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
