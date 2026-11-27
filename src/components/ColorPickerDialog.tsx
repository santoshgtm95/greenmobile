import { Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItemButton, Typography } from '@mui/material';
import type { Product } from '@shared/api';

/** Which colour of a product without IMEI tracking is being sold; that colour's count goes down. */
export default function ColorPickerDialog({
  product,
  onClose,
  onPick,
}: {
  product: Product;
  onClose: () => void;
  onPick: (color: string) => void;
}) {
  return (
    <Dialog open fullWidth maxWidth="xs" onClose={onClose}>
      <DialogTitle>Choose a colour — {product.name}</DialogTitle>
      <DialogContent dividers>
        <List dense disablePadding>
          {product.colors.map((color) => (
            <ListItemButton
              key={color.name}
              autoFocus={color === product.colors[0]}
              onClick={() => onPick(color.name)}
              sx={{ borderBottom: '1px solid', borderColor: 'divider', justifyContent: 'space-between' }}
            >
              <Typography sx={{ fontWeight: 600 }}>{color.name}</Typography>
              <Typography variant="body2" color={color.quantity > 0 ? 'text.secondary' : 'warning.main'}>
                {color.quantity} in stock
              </Typography>
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
