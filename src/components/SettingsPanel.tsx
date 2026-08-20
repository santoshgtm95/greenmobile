import type { ReactNode } from 'react';
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import type { SettingsDraft } from '../hooks/useSettingsDraft';

/**
 * The frame around each settings panel: title, explanation, fields, save bar.
 *
 * The save bar is the reason this is a component rather than five copies. Two
 * things about it are deliberate:
 *
 *   NOTHING SAVES UNTIL ASKED. A settings screen that writes on blur means a
 *   half-typed tax rate can reach a live till. The button says how many fields
 *   will change, so the user knows what they are committing.
 *
 *   IT IS ALWAYS VISIBLE, and disabled when there is nothing to save. A bar that
 *   appears only when the form is dirty moves the content under the cursor at the
 *   moment of the first keystroke.
 */
export default function SettingsPanel({
  title,
  description,
  draft,
  canEdit,
  children,
}: {
  title: string;
  description: ReactNode;
  draft: SettingsDraft;
  /** False for a role that may look but not change (Manager holds settings.view). */
  canEdit: boolean;
  children: ReactNode;
}) {
  return (
    <Paper sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
      <Stack spacing={2.5}>
        <Box>
          <Typography variant="h6">{title}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {description}
          </Typography>
        </Box>

        {!canEdit && (
          <Alert severity="info">
            You can see these settings but not change them. Ask an administrator.
          </Alert>
        )}

        {draft.error && (
          <Alert severity="error" onClose={draft.dismissError}>
            {draft.error}
          </Alert>
        )}

        {draft.loading ? (
          <Box sx={{ p: 4, display: 'grid', placeItems: 'center' }}>
            <CircularProgress size={26} />
          </Box>
        ) : (
          <Stack spacing={2.5} sx={{ maxWidth: 720 }}>
            {children}
          </Stack>
        )}

        <Stack
          direction="row"
          spacing={2}
          sx={{
            alignItems: 'center',
            pt: 1,
            borderTop: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={draft.save}
            disabled={!canEdit || !draft.dirty || draft.saving}
          >
            {draft.saving
              ? 'Saving…'
              : draft.dirty
                ? `Save ${draft.changed.length} change${draft.changed.length === 1 ? '' : 's'}`
                : 'Save'}
          </Button>

          {draft.dirty && !draft.saving && (
            <Button onClick={draft.reset} disabled={!canEdit}>
              Discard
            </Button>
          )}

          {draft.saved && (
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', color: 'success.main' }}>
              <CheckCircleOutlineIcon fontSize="small" />
              <Typography variant="body2">Saved.</Typography>
            </Stack>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}
