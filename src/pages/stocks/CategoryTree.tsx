import { useState, type ReactNode } from 'react';
import {
  Box,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Lookup, Product } from '@shared/api';

/** What the left panel shows: everything, a category, a brand within it, or one product. */
export interface StockSelection {
  categoryId?: string;
  categoryName?: string;
  brandId?: string;
  brandName?: string;
  productId?: string;
}

/** Every product in a category; the list channel caps a page at 200. */
async function listCategory(categoryId: string, includeInactive: boolean): Promise<Product[]> {
  const rows: Product[] = [];
  for (let page = 0; ; page++) {
    const result = await api.products.list({ categoryId, includeInactive, lowStockOnly: false, page, pageSize: 200 });
    rows.push(...result.rows);
    if (rows.length >= result.total || result.rows.length === 0) return rows;
  }
}

/**
 * Category → Brand → Product. A name selects (the left panel follows); the
 * `+` beside it expands. A category's products load only once it is opened.
 */
export default function CategoryTree({
  categories,
  includeInactive,
  selection,
  onSelect,
}: {
  categories: Lookup[];
  includeInactive: boolean;
  selection: StockSelection;
  onSelect: (selection: StockSelection) => void;
}) {
  return (
    <Paper sx={{ border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Categories
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Click a name to show its products, + to open it
        </Typography>
      </Box>
      <List dense disablePadding sx={{ maxHeight: { lg: 'calc(100vh - 260px)' }, overflowY: 'auto', py: 0.5 }}>
        {categories.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            No categories yet.
          </Typography>
        )}
        {categories.map((category) => (
          <CategoryNode
            key={category.id}
            category={category}
            includeInactive={includeInactive}
            selection={selection}
            onSelect={onSelect}
          />
        ))}
      </List>
    </Paper>
  );
}

function CategoryNode({
  category,
  includeInactive,
  selection,
  onSelect,
}: {
  category: Lookup;
  includeInactive: boolean;
  selection: StockSelection;
  onSelect: (selection: StockSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const products = useQuery({
    queryKey: ['products', 'tree', category.id, includeInactive],
    queryFn: () => listCategory(category.id, includeInactive),
    enabled: open,
  });

  // Group by brand; products without one share a "No brand" group.
  const groups = new Map<string, { id: string | null; name: string; products: Product[] }>();
  for (const product of products.data ?? []) {
    const key = product.brandId ?? '';
    const group = groups.get(key) ?? { id: product.brandId, name: product.brandName ?? 'No brand', products: [] };
    group.products.push(product);
    groups.set(key, group);
  }
  const brands = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  const base = { categoryId: category.id, categoryName: category.name };

  return (
    <>
      <TreeRow
        depth={0}
        label={category.name}
        count={category.productCount}
        open={open}
        onToggle={() => setOpen(!open)}
        selected={selection.categoryId === category.id && !selection.brandId && !selection.productId}
        onSelect={() => onSelect(base)}
      />
      <Collapse in={open} unmountOnExit>
        {products.isLoading && (
          <Box sx={{ pl: 6, py: 1 }}>
            <CircularProgress size={16} />
          </Box>
        )}
        {products.data?.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 6, py: 0.5 }}>
            No products
          </Typography>
        )}
        {brands.map((brand) => (
          <BrandNode
            key={brand.id ?? ''}
            brand={brand}
            base={base}
            selection={selection}
            onSelect={onSelect}
          />
        ))}
      </Collapse>
    </>
  );
}

function BrandNode({
  brand,
  base,
  selection,
  onSelect,
}: {
  brand: { id: string | null; name: string; products: Product[] };
  base: StockSelection;
  selection: StockSelection;
  onSelect: (selection: StockSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const brandSelection = { ...base, brandId: brand.id ?? undefined, brandName: brand.id ? brand.name : undefined };

  return (
    <>
      <TreeRow
        depth={1}
        label={brand.name}
        count={brand.products.length}
        open={open}
        onToggle={() => setOpen(!open)}
        selected={
          !!brand.id &&
          selection.categoryId === base.categoryId &&
          selection.brandId === brand.id &&
          !selection.productId
        }
        // shortcut: the list channel cannot filter "no brand", so that group only expands.
        onSelect={brand.id ? () => onSelect(brandSelection) : () => setOpen(!open)}
      />
      <Collapse in={open} unmountOnExit>
        {brand.products.map((product) => (
          <TreeRow
            key={product.id}
            depth={2}
            label={product.name}
            hint={
              <Chip
                size="small"
                label={product.stockQuantity}
                color={product.stockQuantity <= 0 ? 'error' : 'default'}
                variant="outlined"
                sx={{ height: 20, fontSize: 11 }}
              />
            }
            selected={selection.productId === product.id}
            onSelect={() => onSelect({ ...brandSelection, productId: product.id })}
          />
        ))}
      </Collapse>
    </>
  );
}

function TreeRow({
  depth,
  label,
  count,
  hint,
  open,
  onToggle,
  selected,
  onSelect,
}: {
  depth: number;
  label: string;
  count?: number;
  hint?: ReactNode;
  open?: boolean;
  /** Absent on a product, which has nothing to expand. */
  onToggle?: () => void;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', pl: 0.5 + depth * 2, pr: 1 }}>
      {onToggle ? (
        <IconButton
          size="small"
          onClick={onToggle}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
          aria-expanded={open}
          sx={{ transition: 'transform 200ms ease', transform: open ? 'rotate(180deg)' : 'none' }}
        >
          {open ? <RemoveIcon fontSize="small" /> : <AddIcon fontSize="small" />}
        </IconButton>
      ) : (
        <Box sx={{ width: 34, flexShrink: 0 }} />
      )}
      <ListItemButton
        selected={selected}
        onClick={onSelect}
        sx={(theme) => ({
          borderRadius: 2,
          py: 0.5,
          transition: 'background-color 150ms, box-shadow 150ms',
          '&.Mui-selected': {
            backgroundColor: alpha(theme.palette.primary.main, 0.1),
            boxShadow: `inset 3px 0 0 ${theme.palette.primary.main}`,
            '& .MuiListItemText-primary': { fontWeight: 700, color: theme.palette.primary.dark },
          },
        })}
      >
        <ListItemText
          primary={label}
          slotProps={{ primary: { noWrap: true, sx: { fontWeight: depth === 0 ? 600 : 400, fontSize: depth === 2 ? 13 : 14 } } }}
        />
        {count !== undefined && (
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1, fontVariantNumeric: 'tabular-nums' }}>
            {count}
          </Typography>
        )}
        {hint && <Box sx={{ ml: 1 }}>{hint}</Box>}
      </ListItemButton>
    </Stack>
  );
}
