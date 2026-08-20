import { Alert, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useAuth } from '../../hooks/useAuth';
import { useSettingsDraft } from '../../hooks/useSettingsDraft';
import SettingsPanel from '../../components/SettingsPanel';
import type { SettingKey } from '@shared/settings';

const KEYS: SettingKey[] = ['lowStockThreshold', 'allowNegativeStock'];

/** Spec §67. */
export default function StockPanel() {
  const { can } = useAuth();
  const canEdit = can('settings.manage');
  const draft = useSettingsDraft(KEYS);

  const negative = draft.flag('allowNegativeStock');

  return (
    <SettingsPanel
      title="Stock policy"
      description="When a product counts as low, and whether the till may sell something the records say is not there."
      draft={draft}
      canEdit={canEdit}
    >
      <TextField
        label="Low stock at or below"
        type="number"
        value={draft.value('lowStockThreshold')}
        onChange={(e) => draft.set('lowStockThreshold', e.target.value)}
        disabled={!canEdit}
        error={Boolean(draft.fieldErrors.lowStockThreshold)}
        helperText={
          draft.fieldErrors.lowStockThreshold ?? 'Used when a product has no minimum of its own'
        }
        slotProps={{ htmlInput: { min: 0, max: 10_000 } }}
        sx={{ maxWidth: 260 }}
      />

      <FormControlLabel
        control={
          <Switch
            checked={negative}
            onChange={(e) => draft.setFlag('allowNegativeStock', e.target.checked)}
            disabled={!canEdit}
          />
        }
        label={
          <Typography variant="body2">
            {negative
              ? 'Allow selling below zero'
              : 'Refuse a sale when there is not enough stock'}
          </Typography>
        }
      />

      {negative && (
        <Alert severity="warning" icon={<WarningAmberIcon />}>
          <Stack spacing={0.5}>
            <Typography variant="body2">
              The till will now complete a sale even when the recorded stock is zero, leaving a
              negative figure on the product.
            </Typography>
            <Typography variant="caption">
              Shops turn this on when the shelf is ahead of the paperwork — stock arrived but has
              not been entered yet. The cost of goods on such a sale is taken from the product's
              last known purchase price, so the profit figure is an estimate until the stock is
              entered properly. Serialised handsets are never affected: an IMEI that is not in the
              system still cannot be sold.
            </Typography>
          </Stack>
        </Alert>
      )}
    </SettingsPanel>
  );
}
