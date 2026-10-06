import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { PosApiError } from '@shared/errors';

/** The longest reason the delete channels accept. */
const MAX_REASON = 300;

/**
 * Asks why a record is being deleted, then deletes it.
 *
 * This replaced window.prompt(), which Electron does not implement: it returns
 * null at once without showing anything, so the delete buttons on Banking and
 * Expenses did nothing at all when clicked. The tests went straight to the
 * delete channel and never through the button, so nothing failed.
 *
 * A refusal is shown here, inside the dialog, rather than on the page behind
 * it — "delete its withdrawals first" is only useful where the user is looking.
 */
export default function DeleteReasonDialog({
  title,
  message,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  /** Performs the delete. A rejection keeps the dialog open with its message. */
  onConfirm: (reason: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = reason.trim();

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof PosApiError ? err.message : 'That could not be deleted.');
      setPending(false);
    }
  };

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={pending ? undefined : onClose}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <Typography variant="body2" color="text.secondary">
            {message}
          </Typography>
          <TextField
            autoFocus
            required
            label="Reason"
            placeholder="For example: entered twice"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && trimmed && !pending) void confirm();
            }}
            slotProps={{ htmlInput: { maxLength: MAX_REASON } }}
            helperText="Kept with the record, so a changed balance can be explained later"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={() => void confirm()}
          disabled={!trimmed || pending}
        >
          {pending ? 'Deleting…' : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
