import { Divider, Paper, Stack, Tab, Tabs, Typography } from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import SystemInfoPage from './SystemInfoPage';
import BackupPanel from './BackupPanel';
import ShopPanel from './settings/ShopPanel';
import MoneyPanel from './settings/MoneyPanel';
import DocumentsPanel from './settings/DocumentsPanel';
import PrintingPanel from './settings/PrintingPanel';
import StockPanel from './settings/StockPanel';
import type { Permission } from '@shared/domain';

/**
 * Settings (spec §58–§62, §67).
 *
 * Everything configurable about the installation, grouped rather than spread
 * across the navigation. The tab is in the route rather than in component state,
 * so /settings/printing is a real address — reachable from a link, from the back
 * button, and from the screenshot harness.
 *
 * Each tab states the permission it needs. Some settings are readable by a
 * manager (they hold settings.view) and some are not: `settings:getAll` returns
 * only the non-sensitive keys to a non-administrator, so a tab whose fields would
 * all come back blank is hidden instead of shown empty.
 */
const TABS = [
  { value: 'shop', label: 'Shop', permission: 'settings.view' },
  { value: 'money', label: 'Currency & Tax', permission: 'settings.view' },
  { value: 'stock', label: 'Stock', permission: 'settings.view' },
  { value: 'printing', label: 'Printing', permission: 'settings.manage' },
  { value: 'documents', label: 'Numbering', permission: 'settings.manage' },
  { value: 'backup', label: 'Backup & Restore', permission: 'backup.manage' },
  { value: 'system', label: 'System', permission: 'settings.view' },
] as const satisfies ReadonlyArray<{ value: string; label: string; permission: Permission }>;

type TabValue = (typeof TABS)[number]['value'];

export default function SettingsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();

  const visible = TABS.filter((entry) => can(entry.permission));
  const active: TabValue = visible.some((entry) => entry.value === tab)
    ? (tab as TabValue)
    : (visible[0]?.value ?? 'system');

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Settings</Typography>

      <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Tabs
          value={active}
          onChange={(_e, next) => navigate(`/settings/${next as TabValue}`)}
          variant="scrollable"
          scrollButtons="auto"
        >
          {visible.map((entry) => (
            <Tab key={entry.value} value={entry.value} label={entry.label} />
          ))}
        </Tabs>
        <Divider />
      </Paper>

      {active === 'shop' && <ShopPanel />}
      {active === 'money' && <MoneyPanel />}
      {active === 'stock' && <StockPanel />}
      {active === 'printing' && <PrintingPanel />}
      {active === 'documents' && <DocumentsPanel />}
      {active === 'backup' && <BackupPanel />}
      {active === 'system' && <SystemInfoPage />}
    </Stack>
  );
}
