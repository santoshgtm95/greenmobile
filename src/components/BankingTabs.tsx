import { Divider, Paper, Tab, Tabs } from '@mui/material';
import { useNavigate } from 'react-router-dom';

export type BankingTab = 'transactions' | 'advances';

const TABS: Array<{ value: BankingTab; label: string; path: string }> = [
  { value: 'transactions', label: 'Transactions', path: '/banking' },
  { value: 'advances', label: 'Advances', path: '/banking/advances' },
];

/**
 * The two halves of Banking.
 *
 * The tab lives in the address, the way Settings does it, so /banking/advances
 * is linkable and a reload lands where the user was.
 */
export default function BankingTabs({ active }: { active: BankingTab }) {
  const navigate = useNavigate();

  return (
    <Paper sx={{ border: '1px solid', borderColor: 'divider' }}>
      <Tabs
        value={active}
        onChange={(_e, next: BankingTab) => {
          const target = TABS.find((tab) => tab.value === next);
          if (target) navigate(target.path);
        }}
      >
        {TABS.map((tab) => (
          <Tab key={tab.value} value={tab.value} label={tab.label} />
        ))}
      </Tabs>
      <Divider />
    </Paper>
  );
}
