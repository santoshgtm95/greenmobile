import {
  Alert,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { useSettingsDraft } from '../../hooks/useSettingsDraft';
import SettingsPanel from '../../components/SettingsPanel';
import { RECEIPT_WIDTHS } from '@shared/domain';
import type { SettingKey } from '@shared/settings';

const KEYS: SettingKey[] = ['receiptWidth', 'receiptFooter', 'defaultPrinter', 'printerAutoPrint'];

/** Spec §37, §38. */
export default function PrintingPanel() {
  const { can } = useAuth();
  const canEdit = can('settings.manage');
  const draft = useSettingsDraft(KEYS);

  const printers = useQuery({
    queryKey: ['printers'],
    queryFn: () => api.print.listPrinters(),
    staleTime: 60_000,
  });

  const selected = draft.value('defaultPrinter');
  const available = printers.data ?? [];
  // A printer named in settings that Windows no longer reports: keep it in the
  // list rather than silently resetting the shop's choice because the printer
  // happened to be off when this screen was opened.
  const missing = selected !== '' && !available.some((printer) => printer.name === selected);

  return (
    <SettingsPanel
      title="Printing"
      description="Which printer receipts go to, how wide the roll is, and what is printed at the bottom."
      draft={draft}
      canEdit={canEdit}
    >
      <TextField
        select
        label="Receipt printer"
        value={selected}
        onChange={(e) => draft.set('defaultPrinter', e.target.value)}
        disabled={!canEdit}
        error={Boolean(draft.fieldErrors.defaultPrinter)}
        helperText={
          draft.fieldErrors.defaultPrinter ??
          (printers.isLoading
            ? 'Reading the printer list…'
            : 'Leave as the Windows default to use whatever is set up on this PC')
        }
        /*
          The default choice is stored as an empty string, which MUI reads as "no
          selection": without these the field rendered blank with its label sitting
          inside it, so the shop could not tell what it was set to.
        */
        slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}
      >
        <MenuItem value="">
          <em>Windows default printer</em>
        </MenuItem>
        {available.map((printer) => (
          <MenuItem key={printer.name} value={printer.name}>
            {printer.displayName || printer.name}
            {printer.isDefault ? ' — Windows default' : ''}
          </MenuItem>
        ))}
        {missing && (
          <MenuItem value={selected}>{selected} — not connected right now</MenuItem>
        )}
      </TextField>

      {missing && (
        <Alert severity="warning">
          <strong>{selected}</strong> is not reporting to Windows at the moment. Receipts will fail
          to print until it is switched on, or until another printer is chosen here.
        </Alert>
      )}

      <TextField
        select
        label="Receipt width"
        value={draft.value('receiptWidth')}
        onChange={(e) => draft.set('receiptWidth', e.target.value)}
        disabled={!canEdit}
        // Short, because helper text wraps to the width of its field and this one
        // is narrow: the longer version filled three cramped lines.
        helperText="Match the paper in the printer"
        sx={{ maxWidth: 260 }}
      >
        {RECEIPT_WIDTHS.map((width) => (
          <MenuItem key={width} value={width}>
            {width} roll
          </MenuItem>
        ))}
      </TextField>

      <FormControlLabel
        control={
          <Switch
            checked={draft.flag('printerAutoPrint')}
            onChange={(e) => draft.setFlag('printerAutoPrint', e.target.checked)}
            disabled={!canEdit}
          />
        }
        label={
          <Stack>
            <Typography variant="body2">
              {draft.flag('printerAutoPrint')
                ? 'Print a receipt as soon as a sale completes'
                : 'Ask before printing'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              With this on, no print dialog appears at the till — which is what a busy counter
              wants, and what wastes a roll if the printer is set up wrongly.
            </Typography>
          </Stack>
        }
      />

      <TextField
        label="Receipt footer"
        multiline
        minRows={2}
        value={draft.value('receiptFooter')}
        onChange={(e) => draft.set('receiptFooter', e.target.value)}
        disabled={!canEdit}
        error={Boolean(draft.fieldErrors.receiptFooter)}
        helperText={
          draft.fieldErrors.receiptFooter ??
          'Printed at the bottom of every receipt — a thank you, return policy or warranty note'
        }
      />
    </SettingsPanel>
  );
}
