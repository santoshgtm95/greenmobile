import { Alert, Chip, Stack, TextField, Typography } from '@mui/material';
import { useAuth } from '../../hooks/useAuth';
import { useSettingsDraft } from '../../hooks/useSettingsDraft';
import SettingsPanel from '../../components/SettingsPanel';
import type { SettingKey } from '@shared/settings';

/**
 * Document numbering (spec §26).
 *
 * Each series is <PREFIX>-<YYYYMM>-<0001>. The prefix is editable; the counter is
 * shown but NOT editable, and that is the whole design of this screen.
 *
 * A counter is not a preference. Winding it back would hand a second invoice the
 * number of one already given to a customer, and the unique index would then
 * refuse the sale at the till — a setting that breaks trading two weeks later, in
 * a way nobody would connect to this screen. The number reached is displayed
 * because it is genuinely useful to see; it is read-only because there is no safe
 * value to change it to.
 */
const SERIES: Array<{
  label: string;
  prefix: SettingKey;
  counter: SettingKey;
  used: string;
}> = [
  { label: 'Invoices', prefix: 'invoicePrefix', counter: 'invoiceNumber', used: 'Every sale' },
  { label: 'Repair jobs', prefix: 'servicePrefix', counter: 'serviceNumber', used: 'Service intake' },
  { label: 'Expenses', prefix: 'expensePrefix', counter: 'expenseNumber', used: 'Recorded costs' },
  { label: 'Refunds', prefix: 'returnPrefix', counter: 'returnNumber', used: 'Sale returns' },
  { label: 'Customers', prefix: 'customerPrefix', counter: 'customerNumber', used: 'Customer codes' },
  { label: 'Banking', prefix: 'bankingPrefix', counter: 'bankingNumber', used: 'Transfers and receipts' },
];

const KEYS: SettingKey[] = SERIES.map((series) => series.prefix);

export default function DocumentsPanel() {
  const { can } = useAuth();
  const canEdit = can('settings.manage');
  const draft = useSettingsDraft(KEYS);

  const yearMonth = new Date().toISOString().slice(0, 7).replace('-', '');

  return (
    <SettingsPanel
      title="Document numbers"
      description="The prefix on each numbered series. Numbers restart their count within the format every month and are never reused."
      draft={draft}
      canEdit={canEdit}
    >
      <Stack spacing={2}>
        {SERIES.map((series) => {
          const prefix = draft.value(series.prefix).trim() || 'DOC';
          const next = draft.number(series.counter) + 1;
          return (
            <Stack
              key={series.prefix}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{ alignItems: { sm: 'center' } }}
            >
              <TextField
                label={series.label}
                value={draft.value(series.prefix)}
                onChange={(e) => draft.set(series.prefix, e.target.value.toUpperCase())}
                disabled={!canEdit}
                error={Boolean(draft.fieldErrors[series.prefix])}
                helperText={draft.fieldErrors[series.prefix] ?? series.used}
                sx={{ width: 200 }}
              />
              <Stack spacing={0.25} sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary">
                  Next number
                </Typography>
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${prefix}-${yearMonth}-${String(next).padStart(4, '0')}`}
                  sx={{ fontFamily: 'monospace', alignSelf: 'flex-start' }}
                />
              </Stack>
            </Stack>
          );
        })}
      </Stack>

      <Alert severity="info">
        The count itself cannot be changed here. Winding it back would give a second document the
        number of one a customer already holds, and the database would refuse it — at the till,
        weeks later. Changing a prefix is safe: past documents keep the number they were issued
        with.
      </Alert>
    </SettingsPanel>
  );
}
