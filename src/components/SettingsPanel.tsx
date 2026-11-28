import type { ReactNode } from 'react';
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
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
    <Paper sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', overflow: 'clip' }}>
      <Box
        sx={(theme) => ({
          px: 3,
          py: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          background: `linear-gradient(180deg, ${alpha(theme.palette.primary.main, 0.07)}, transparent)`,
        })}
      >
        <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', letterSpacing: '-0.02em' }}>{title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, maxWidth: 720 }}>
          {description}
        </Typography>
      </Box>

      <Stack spacing={2.5} sx={{ p: 3 }}>
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
      </Stack>

      {/* Sticks to the bottom of the screen, so Save is in reach on a long section. */}
      <Stack
        direction="row"
        spacing={1.5}
        sx={(theme) => ({
          alignItems: 'center',
          px: 3,
          py: 1.5,
          position: 'sticky',
          bottom: 0,
          zIndex: 1,
          borderTop: '1px solid',
          borderColor: draft.dirty ? alpha(theme.palette.warning.main, 0.4) : 'divider',
          bgcolor: draft.dirty
            ? alpha(theme.palette.warning.main, 0.06)
            : alpha(theme.palette.text.primary, 0.025),
          backdropFilter: 'blur(6px)',
          transition: 'background-color .2s, border-color .2s',
        })}
      >
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          {draft.dirty && !draft.saving ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'warning.main', flexShrink: 0 }} />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Unsaved changes
              </Typography>
            </Stack>
          ) : draft.saved ? (
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', color: 'success.main' }}>
              <CheckCircleOutlineIcon fontSize="small" />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Saved.
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Nothing changes until you save.
            </Typography>
          )}
        </Box>

        {draft.dirty && !draft.saving && (
          <Button onClick={draft.reset} disabled={!canEdit} color="inherit">
            Discard
          </Button>
        )}

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
      </Stack>
    </Paper>
  );
}
