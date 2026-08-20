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
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMoneyFormatter } from '../hooks/useSettings';
import { PosApiError } from '@shared/errors';

/**
 * Expense categories (spec §18).
 *
 * A category in use is deactivated rather than removed, so existing expenses
 * keep a name to report under.
 */
export default function ExpenseCategoriesDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const money = useMoneyFormatter();
  const queryClient = useQueryClient();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const categories = useQuery({
    queryKey: ['expenseCategories', 'all'],
    queryFn: () => api.expenseCategories.list({ includeInactive: true }),
  });

  const reset = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setIsActive(true);
  };

  const save = useMutation({
    mutationFn: () =>
      api.expenseCategories.save({
        id: editingId ?? undefined,
        name: name.trim(),
        description: description.trim() || undefined,
        isActive,
      }),
    onSuccess: () => {
      reset();
      void queryClient.invalidateQueries({ queryKey: ['expenseCategories'] });
      onChanged();
    },
    onError: (err) =>
      setError(err instanceof PosApiError ? err.message : 'Unable to save that category.'),
  });

  const rows = categories.data ?? [];

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>Expense categories</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
            <TextField
              label={editingId ? 'Rename category' : 'New category'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <Button
              variant="contained"
              startIcon={editingId ? <EditIcon /> : <AddIcon />}
              onClick={() => {
                setError(null);
                save.mutate();
              }}
              disabled={save.isPending || !name.trim()}
              sx={{ mt: 0.25 }}
            >
              {editingId ? 'Save' : 'Add'}
            </Button>
            {editingId && (
              <Button onClick={reset} sx={{ mt: 0.25 }}>
                Cancel
              </Button>
            )}
          </Stack>

          {editingId && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <Typography variant="body2">
                {isActive ? 'Active — available when recording an expense' : 'Inactive — hidden from new expenses'}
              </Typography>
            </Stack>
          )}

          <Divider />

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Category</TableCell>
                <TableCell align="right">Expenses</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((category) => (
                <TableRow key={category.id} hover>
                  <TableCell>
                    {category.name}
                    {category.description && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {category.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">{category.expenseCount || '—'}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {category.totalAmount > 0 ? money(category.totalAmount) : '—'}
                  </TableCell>
                  <TableCell>
                    {category.isActive === 1 ? (
                      <Chip size="small" color="success" variant="outlined" label="Active" />
                    ) : (
                      <Chip size="small" label="Inactive" />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit">
                      <IconButton
                        size="small"
                        onClick={() => {
                          setEditingId(category.id);
                          setName(category.name);
                          setDescription(category.description ?? '');
                          setIsActive(category.isActive === 1);
                        }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
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
