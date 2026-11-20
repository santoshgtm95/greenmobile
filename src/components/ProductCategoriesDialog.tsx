import { useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Collapse,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { PosApiError } from '@shared/errors';
import type { ProductCategory } from '@shared/api';

/** Category → Sub Category → Sub Category: only the first two levels can take children. */
const MAX_PARENT_DEPTH = 1;

/**
 * Registers product categories and their sub categories. Products, the Excel
 * import and purchases can only use what is registered here. A category in
 * use is deactivated rather than removed.
 */
export default function ProductCategoriesDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [parentId, setParentId] = useState('');
  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const categories = useQuery({
    queryKey: ['categories', 'all'],
    queryFn: () => api.categories.list({ includeInactive: true }),
  });
  const rows = categories.data ?? [];

  const reset = () => {
    setEditingId(null);
    setParentId('');
    setName('');
    setIsActive(true);
  };

  const save = useMutation({
    mutationFn: () =>
      api.categories.save({
        id: editingId ?? undefined,
        name: name.trim(),
        isActive,
        parentId: parentId || undefined,
      }),
    onSuccess: () => {
      reset();
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err) => setError(err instanceof PosApiError ? err.message : 'Unable to save that category.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.categories.delete({ id }),
    onSuccess: () => {
      reset();
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err) => setError(err instanceof PosApiError ? err.message : 'Unable to delete that category.'),
  });

  return (
    <Dialog open fullWidth maxWidth="md" onClose={onClose}>
      <DialogTitle>Product categories</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
            <TextField
              select
              label="Under"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              // A category keeps the parent it was created under.
              disabled={!!editingId}
              sx={{ minWidth: 260 }}
            >
              <MenuItem value="">— Top level (Category) —</MenuItem>
              {rows
                .filter((c) => c.depth <= MAX_PARENT_DEPTH && (c.isActive === 1 || c.id === parentId))
                .map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.path}
                  </MenuItem>
                ))}
            </TextField>
            <TextField
              label={editingId ? 'Rename' : parentId ? 'New sub category' : 'New category'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              sx={{ flexGrow: 1 }}
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
                {isActive
                  ? 'Active — available for products and imports'
                  : 'Inactive — hidden, together with its sub categories'}
              </Typography>
            </Stack>
          )}

          <Divider />

          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
            {rows.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                No categories yet.
              </Typography>
            )}
            {rows
              .filter((category) => category.depth === 0)
              .map((category) => (
                <CategoryNode
                  key={category.id}
                  category={category}
                  rows={rows}
                  actions={(category) => (
                    <>
            {category.depth <= MAX_PARENT_DEPTH && category.isActive === 1 && (
              <Tooltip title="Add a sub category">
                <IconButton
                  size="small"
                  aria-label={`Add a sub category under ${category.path}`}
                  onClick={() => {
                    reset();
                    setParentId(category.id);
                  }}
                >
                  <AddIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Edit">
              <IconButton
                size="small"
                aria-label={`Edit ${category.path}`}
                onClick={() => {
                  setEditingId(category.id);
                  setParentId(category.parentId ?? '');
                  setName(category.name);
                  setIsActive(category.isActive === 1);
                }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {can('products.delete') && (
              <Tooltip title="Delete">
                <IconButton
                  size="small"
                  aria-label={`Delete ${category.path}`}
                  disabled={remove.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete "${category.path}" and all its sub categories?\n\n` +
                          `${category.productCount} product(s) in it will be kept, but left without a category.`,
                      )
                    ) {
                      setError(null);
                      remove.mutate(category.id);
                    }
                  }}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
                    </>
                  )}
                />
              ))}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

/** One accordion row; opens to show its sub categories. */
function CategoryNode({
  category,
  rows,
  actions,
}: {
  category: ProductCategory;
  rows: ProductCategory[];
  actions: (category: ProductCategory) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const children = rows.filter((c) => c.parentId === category.id);
  const toggle = () => children.length > 0 && setOpen(!open);

  return (
    <>
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          pl: 0.5 + category.depth * 3,
          pr: 1,
          py: 0.25,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: category.depth === 0 ? 'background.default' : undefined,
        }}
      >
        {children.length > 0 ? (
          <IconButton
            size="small"
            onClick={toggle}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${category.name}`}
            aria-expanded={open}
            sx={{ transition: 'transform 200ms ease', transform: open ? 'rotate(90deg)' : 'none' }}
          >
            <ChevronRightIcon fontSize="small" />
          </IconButton>
        ) : (
          <Box sx={{ width: 34, flexShrink: 0 }} />
        )}
        <Typography
          noWrap
          onClick={toggle}
          sx={{ flexGrow: 1, minWidth: 0, fontWeight: category.depth === 0 ? 600 : 400, cursor: children.length ? 'pointer' : 'default' }}
        >
          {category.name}
          {children.length > 0 && (
            <Typography component="span" variant="caption" color="text.secondary">
              {`  ·  ${children.length} sub`}
            </Typography>
          )}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mx: 1, whiteSpace: 'nowrap' }}>
          {category.productCount} products
        </Typography>
        {category.isActive !== 1 && <Chip size="small" label="Inactive" sx={{ mr: 1 }} />}
        <Box sx={{ whiteSpace: 'nowrap' }}>{actions(category)}</Box>
      </Stack>
      <Collapse in={open} unmountOnExit>
        {children.map((child) => (
          <CategoryNode key={child.id} category={child} rows={rows} actions={actions} />
        ))}
      </Collapse>
    </>
  );
}
