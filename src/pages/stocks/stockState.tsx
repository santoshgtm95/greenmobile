import { Chip } from '@mui/material';
import type { Product } from '@shared/api';

/** A product's own minimum where it has one, otherwise the shop default. */
export const reorderPointOf = (product: Product, shopDefault: number) =>
  product.minimumStock > 0 ? product.minimumStock : shopDefault;

export function StockStateChip({ product, reorderPoint }: { product: Product; reorderPoint: number }) {
  if (product.isActive === 0) return <Chip size="small" label="Inactive" />;
  if (product.stockQuantity <= 0) return <Chip size="small" color="error" label="Out of stock" />;
  if (product.stockQuantity <= reorderPoint) return <Chip size="small" color="warning" label="Low" />;
  return <Chip size="small" color="success" variant="outlined" label="OK" />;
}
