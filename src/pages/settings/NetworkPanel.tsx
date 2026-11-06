import { Alert, Box, FormControlLabel, Stack, Switch, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { useSettingsDraft } from '../../hooks/useSettingsDraft';
import SettingsPanel from '../../components/SettingsPanel';
import type { SettingKey } from '@shared/settings';

const KEYS: SettingKey[] = ['networkAccess'];

/** Drawn here, offline: a camera that scans it opens the address. */
function QrCode({ text }: { text: string }) {
  const image = useQuery({ queryKey: ['qr', text], queryFn: () => QRCode.toDataURL(text, { margin: 1, width: 180 }) });
  return image.data ? (
    <Box component="img" src={image.data} alt={`QR code for ${text}`} sx={{ width: 180, height: 180, bgcolor: '#fff' }} />
  ) : null;
}

/** Other laptops and tablets on the same Wi-Fi use the POS in their web browser. */
export default function NetworkPanel() {
  const { can } = useAuth();
  const canEdit = can('settings.manage');
  const draft = useSettingsDraft(KEYS);
  const on = draft.flag('networkAccess');
  // Polled so the addresses appear once a save has started the server.
  const status = useQuery({ queryKey: ['networkStatus'], queryFn: () => api.settings.networkStatus(), refetchInterval: 3000 });

  return (
    <SettingsPanel
      title="Other devices"
      description="Use the POS from other laptops and tablets on the same Wi-Fi or router. No internet is needed. This computer keeps all the data, so it must stay on with the app open."
      draft={draft}
      canEdit={canEdit}
    >
      <FormControlLabel
        control={
          <Switch checked={on} onChange={(e) => draft.setFlag('networkAccess', e.target.checked)} disabled={!canEdit} />
        }
        label={<Typography variant="body2">{on ? 'Allow other devices' : 'This computer only'}</Typography>}
      />

      {status.data?.running ? (
        <Alert severity="success">
          <Stack spacing={0.5}>
            <Typography variant="body2">
              On the tablet or phone, scan this with the camera. On a laptop, type the address into the browser.
            </Typography>
            {status.data.urls.map((url) => (
              <Stack key={url} direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <QrCode text={url} />
                <Typography variant="h6" sx={{ fontFamily: 'monospace' }}>
                  {url}
                </Typography>
              </Stack>
            ))}
            <Typography variant="body2">
              Once it opens, choose <strong>Add to Home screen</strong> in the browser menu (Safari: the Share button).
              After that, staff just tap the Green Mobile icon.
            </Typography>
            <Typography variant="caption">
              Each device signs in with its own user. If Windows asks about the firewall, allow Private networks.
              Backups, restore, product import and saving files can only be done on this computer. So the icon keeps
              working, reserve this computer&apos;s address in the router (DHCP reservation).
            </Typography>
          </Stack>
        </Alert>
      ) : (
        on &&
        status.data && (
          <Alert severity="warning">
            Saved, but other devices cannot connect yet. Save again, or restart the app. If it still fails, another
            program may be using port 8765.
          </Alert>
        )
      )}
    </SettingsPanel>
  );
}
