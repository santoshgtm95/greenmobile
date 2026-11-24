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
import type { Product, ProductCategory } from '@shared/api';

/** What the left panel shows: everything, a category (with its sub categories), or one product. */
export interface StockSelection {
  categoryId?: string;
  /** The category's path, "Phones › Cases". */
  categoryName?: string;
  /** A brand within the category. */
  brandId?: string;
  brandName?: string;
  productId?: string;
}

/** Every product in a category and its sub categories; the list channel caps a page at 200. */
async function listCategory(categoryId: string, includeInactive: boolean): Promise<Product[]> {
  const rows: Product[] = [];
  for (let page = 0; ; page++) {
    const result = await api.products.list({ categoryId, includeInactive, lowStockOnly: false, page, pageSize: 200 });
    rows.push(...result.rows);
    if (rows.length >= result.total || result.rows.length === 0) return rows;
  }
}

/**
 * Category → Sub Category → Sub Category → Brand → Product (products without
 * a brand sit straight under their category). A name selects (the left
 * panel follows); the `+` beside it expands. A top-level category's products
 * load only once it is opened, and are shared down its branch.
 */
export default function CategoryTree({
  categories,
  includeInactive,
  selection,
  onSelect,
}: {
  categories: ProductCategory[];
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
      <List dense disablePadding sx={{ maxHeight: { md: 'calc(100vh - 260px)' }, overflowY: 'auto', py: 0.5 }}>
        {categories.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            No categories yet.
          </Typography>
        )}
        {categories
          .filter((category) => category.depth === 0)
          .map((category) => (
            <CategoryNode
              key={category.id}
              category={category}
              categories={categories}
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
  categories,
  products,
  includeInactive,
  selection,
  onSelect,
}: {
  category: ProductCategory;
  categories: ProductCategory[];
  /** The branch's products, loaded by its top-level category. */
  products?: Product[];
  includeInactive: boolean;
  selection: StockSelection;
  onSelect: (selection: StockSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const isTop = category.depth === 0;
  const loaded = useQuery({
    queryKey: ['products', 'tree', category.id, includeInactive],
    queryFn: () => listCategory(category.id, includeInactive),
    enabled: open && isTop,
  });
  const branch = isTop ? loaded.data : products;
  const children = categories.filter((c) => c.parentId === category.id);
  const own = (branch ?? []).filter((p) => p.categoryId === category.id);
  const brands = new Map<string, { name: string; products: Product[] }>();
  for (const p of own) {
    if (!p.brandId) continue;
    const entry = brands.get(p.brandId) ?? { name: p.brandName ?? '', products: [] };
    entry.products.push(p);
    brands.set(p.brandId, entry);
  }
  const productRow = (product: Product, depth: number) => (
    <TreeRow
      key={product.id}
      depth={depth}
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
      onSelect={() =>
        onSelect({
          categoryId: category.id,
          categoryName: category.path,
          brandId: product.brandId ?? undefined,
          brandName: product.brandName ?? undefined,
          productId: product.id,
        })
      }
    />
  );

  return (
    <>
      <TreeRow
        depth={category.depth}
        label={category.name}
        count={includeInactive ? category.productCount : category.activeProductCount}
        open={open}
        onToggle={() => setOpen(!open)}
        selected={selection.categoryId === category.id && !selection.brandId && !selection.productId}
        onSelect={() => onSelect({ categoryId: category.id, categoryName: category.path })}
      />
      <Collapse in={open} unmountOnExit>
        {isTop && loaded.isLoading && (
          <Box sx={{ pl: 6, py: 1 }}>
            <CircularProgress size={16} />
          </Box>
        )}
        {children.map((child) => (
          <CategoryNode
            key={child.id}
            category={child}
            categories={categories}
            products={branch}
            includeInactive={includeInactive}
            selection={selection}
            onSelect={onSelect}
          />
        ))}
        {[...brands].map(([brandId, brand]) => (
          <BrandNode
            key={brandId}
            depth={category.depth + 1}
            name={brand.name}
            count={brand.products.length}
            selected={selection.categoryId === category.id && selection.brandId === brandId && !selection.productId}
            onSelect={() =>
              onSelect({ categoryId: category.id, categoryName: category.path, brandId, brandName: brand.name })
            }
          >
            {brand.products.map((product) => productRow(product, category.depth + 2))}
          </BrandNode>
        ))}
        {own.filter((p) => !p.brandId).map((product) => productRow(product, category.depth + 1))}
        {branch && children.length === 0 && own.length === 0 && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', pl: 6 + category.depth * 2, py: 0.5 }}
          >
            No products
          </Typography>
        )}
      </Collapse>
    </>
  );
}

function BrandNode({
  depth,
  name,
  count,
  selected,
  onSelect,
  children,
}: {
  depth: number;
  name: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TreeRow depth={depth} label={name} count={count} open={open} onToggle={() => setOpen(!open)} selected={selected} onSelect={onSelect} />
      <Collapse in={open} unmountOnExit>
        {children}
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
          slotProps={{ primary: { noWrap: true, sx: { fontWeight: depth === 0 ? 600 : 400, fontSize: onToggle ? 14 : 13 } } }}
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
