import { Chip, Tooltip } from '@mui/material';

/** "Deleted" badge for a record kept for checking; the reason is on hover. */
export function DeletedChip({ reason }: { reason: string | null }) {
  return (
    <Tooltip title={reason ? `Reason: ${reason}` : 'No reason recorded'}>
      <Chip size="small" color="error" variant="outlined" label="Deleted" sx={{ height: 20, fontSize: 11, ml: 0.5 }} />
    </Tooltip>
  );
}

/** A deleted row reads as history: faded and struck through, never counted. */
export const deletedRowSx = {
  opacity: 0.6,
  // The badge (inline-flex) is not struck through, so it stays readable.
  '& td': { textDecoration: 'line-through' },
} as const;
