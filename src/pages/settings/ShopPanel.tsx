import { useState } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import ImageIcon from '@mui/icons-material/Image';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { useSettingsDraft } from '../../hooks/useSettingsDraft';
import SettingsPanel from '../../components/SettingsPanel';
import Logo from '../../components/Logo';
import { PosApiError } from '@shared/errors';
import type { SettingKey } from '@shared/settings';
import type { ChosenLogo } from '@shared/api';

const KEYS: SettingKey[] = ['shopName', 'shopAddress', 'shopPhone', 'shopEmail', 'shopLogo'];

/**
 * Who this shop is (spec §58).
 *
 * These five values are what appears on every invoice, receipt, job sheet and
 * report header, so this is the screen that changes what a customer is handed.
 */
export default function ShopPanel() {
  const { can } = useAuth();
  const canEdit = can('settings.manage');
  const draft = useSettingsDraft(KEYS);

  const [logoError, setLogoError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ChosenLogo | null>(null);

  const chooseLogo = useMutation({
    mutationFn: () => api.settings.chooseLogo(),
    onSuccess: (result) => {
      // Null means the file dialog was cancelled, which is not a failure.
      if (!result) return;
      setLogoError(null);
      setChosen(result);
      draft.set('shopLogo', result.dataUri);
    },
    onError: (err) =>
      setLogoError(err instanceof PosApiError ? err.message : 'That image could not be read.'),
  });

  const logo = draft.value('shopLogo');

  return (
    <SettingsPanel
      title="Shop details"
      description="Printed at the top of every invoice, receipt and job sheet, and shown on the sign-in screen."
      draft={draft}
      canEdit={canEdit}
    >
      <TextField
        label="Shop name"
        required
        value={draft.value('shopName')}
        onChange={(e) => draft.set('shopName', e.target.value)}
        disabled={!canEdit}
        error={Boolean(draft.fieldErrors.shopName)}
        helperText={draft.fieldErrors.shopName ?? 'The name customers know you by'}
      />

      <TextField
        label="Address"
        multiline
        minRows={2}
        value={draft.value('shopAddress')}
        onChange={(e) => draft.set('shopAddress', e.target.value)}
        disabled={!canEdit}
        error={Boolean(draft.fieldErrors.shopAddress)}
        helperText={draft.fieldErrors.shopAddress ?? 'Line breaks are kept as you type them'}
      />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label="Phone"
          value={draft.value('shopPhone')}
          onChange={(e) => draft.set('shopPhone', e.target.value)}
          disabled={!canEdit}
          error={Boolean(draft.fieldErrors.shopPhone)}
          helperText={draft.fieldErrors.shopPhone}
          sx={{ flex: 1 }}
        />
        <TextField
          label="Email"
          value={draft.value('shopEmail')}
          onChange={(e) => draft.set('shopEmail', e.target.value)}
          disabled={!canEdit}
          error={Boolean(draft.fieldErrors.shopEmail)}
          helperText={draft.fieldErrors.shopEmail}
          sx={{ flex: 1 }}
        />
      </Stack>

      {/* Logo */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Logo
        </Typography>

        {logoError && (
          <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setLogoError(null)}>
            {logoError}
          </Alert>
        )}
        {draft.fieldErrors.shopLogo && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {draft.fieldErrors.shopLogo}
          </Alert>
        )}

        <Paper
          variant="outlined"
          sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Box
            sx={{
              width: 84,
              height: 84,
              display: 'grid',
              placeItems: 'center',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              // White, because a logo is designed for paper and this preview
              // stands in for the invoice.
              bgcolor: '#fff',
              p: 1,
            }}
          >
            {logo ? (
              <Box
                component="img"
                src={logo}
                alt=""
                sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              />
            ) : (
              <Logo size={64} />
            )}
          </Box>

          <Stack spacing={0.5} sx={{ flexGrow: 1, minWidth: 200 }}>
            <Typography variant="body2">
              {logo ? 'Your own logo' : 'Using the built-in Green Mobile logo'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {chosen
                ? `${chosen.fileName} — resized to ${chosen.width}×${chosen.height}, ${Math.round(chosen.bytes / 1024)} KB. Not saved yet.`
                : 'PNG, JPEG or WebP. Large images are resized automatically.'}
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1}>
            <Button
              startIcon={<ImageIcon />}
              onClick={() => chooseLogo.mutate()}
              disabled={!canEdit || chooseLogo.isPending}
            >
              {chooseLogo.isPending ? 'Reading…' : 'Choose Image'}
            </Button>
            {logo && (
              <Button
                color="error"
                startIcon={<DeleteOutlinedIcon />}
                onClick={() => {
                  setChosen(null);
                  setLogoError(null);
                  // Empty means "fall back to the built-in mark", which is what
                  // logoTag in document.service.ts does with a blank value.
                  draft.set('shopLogo', '');
                }}
                disabled={!canEdit}
              >
                Remove
              </Button>
            )}
          </Stack>
        </Paper>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          The image is stored inside the database, so it travels with your backups and needs no
          separate file. It is not printed on thermal receipts — a logo costs roll and prints poorly
          at that resolution.
        </Typography>
      </Box>
    </SettingsPanel>
  );
}
