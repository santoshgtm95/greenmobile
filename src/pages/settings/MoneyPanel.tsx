import { Alert, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import { useAuth } from '../../hooks/useAuth';
import { useSettingsDraft } from '../../hooks/useSettingsDraft';
import SettingsPanel from '../../components/SettingsPanel';
import { TAX_MODES } from '@shared/domain';
import { CURRENCY_DECIMALS, formatMoney, formatRate, parseRate } from '@shared/money';
import type { SettingKey } from '@shared/settings';

const KEYS: SettingKey[] = ['currency', 'taxEnabled', 'taxRate', 'taxMode'];

const TAX_MODE_LABELS: Record<(typeof TAX_MODES)[number], string> = {
  EXCLUSIVE: 'Added on top of the price',
  INCLUSIVE: 'Already included in the price',
};

/**
 * Currency and tax (spec §59, §60).
 *
 * The worked example at the bottom is the point of the screen. Exclusive and
 * inclusive tax are a genuinely confusing pair, and the difference is invisible
 * until a total is wrong on a customer's receipt — so the panel shows what a
 * 1,000 sale becomes under whatever is currently selected, before it is saved.
 */
export default function MoneyPanel() {
  const { can } = useAuth();
  const canEdit = can('settings.manage');
  const draft = useSettingsDraft(KEYS);

  const currency = draft.value('currency').toUpperCase() || 'THB';
  const taxEnabled = draft.flag('taxEnabled');
  const rate = draft.number('taxRate');
  const inclusive = draft.value('taxMode') === 'INCLUSIVE';

  // The same arithmetic the till does, on a round number.
  const example = 100_000;
  const tax = taxEnabled ? Math.round((example * rate) / (inclusive ? 10_000 + rate : 10_000)) : 0;
  const net = inclusive ? example - tax : example;
  const gross = inclusive ? example : example + tax;

  return (
    <SettingsPanel
      title="Currency and tax"
      description="How prices are shown and how tax is worked out on every sale, repair and report."
      draft={draft}
      canEdit={canEdit}
    >
      <TextField
        select
        label="Currency"
        value={currency}
        onChange={(e) => draft.set('currency', e.target.value)}
        disabled={!canEdit}
        error={Boolean(draft.fieldErrors.currency)}
        helperText={draft.fieldErrors.currency ?? 'Existing amounts are not converted'}
        sx={{ maxWidth: 320 }}
      >
        {Object.keys(CURRENCY_DECIMALS).map((code) => (
          <MenuItem key={code} value={code}>
            {code} — {formatMoney(example, code, { withSymbol: true })}
          </MenuItem>
        ))}
      </TextField>

      <FormControlLabel
        control={
          <Switch
            checked={taxEnabled}
            onChange={(e) => draft.setFlag('taxEnabled', e.target.checked)}
            disabled={!canEdit}
          />
        }
        label={taxEnabled ? 'Charging tax' : 'Not charging tax'}
      />

      {taxEnabled && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Tax rate"
            value={formatRate(rate)}
            onChange={(e) => {
              // Stored as basis points; the field speaks percent.
              const parsed = parseRate(e.target.value);
              if (parsed !== null) draft.set('taxRate', String(parsed));
            }}
            disabled={!canEdit}
            error={Boolean(draft.fieldErrors.taxRate)}
            helperText={draft.fieldErrors.taxRate ?? 'Percent, e.g. 7 or 7.5'}
            sx={{ width: 180 }}
          />
          <TextField
            select
            label="Prices are"
            value={draft.value('taxMode')}
            onChange={(e) => draft.set('taxMode', e.target.value)}
            disabled={!canEdit}
            sx={{ flex: 1 }}
          >
            {TAX_MODES.map((mode) => (
              <MenuItem key={mode} value={mode}>
                {TAX_MODE_LABELS[mode]}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      )}

      <Alert severity="info" icon={false}>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          What this does to a {formatMoney(example, currency)} item
        </Typography>
        <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          Before tax {formatMoney(net, currency)} · tax {formatMoney(tax, currency)} ·{' '}
          <strong>customer pays {formatMoney(gross, currency)}</strong>
        </Typography>
        {taxEnabled && (
          <Typography variant="caption" color="text.secondary">
            {inclusive
              ? 'Inclusive: the ticket price is what the customer pays, and the tax is worked back out of it.'
              : 'Exclusive: the tax is added to the ticket price at the till.'}
          </Typography>
        )}
      </Alert>
    </SettingsPanel>
  );
}
