import { api } from '../lib/api';
import { useQuery } from '@tanstack/react-query';
import type { ShopSettings } from '@shared/settings';
import { formatMoney } from '@shared/money';

/**
 * Shop settings, cached for the session.
 *
 * Currency, tax and receipt width are read from here rather than hard-coded
 * anywhere in the UI (spec §59, §60).
 */
export function useSettings() {
  return useQuery<ShopSettings>({
    queryKey: ['settings', 'shop'],
    queryFn: () => api.settings.getShop(),
    staleTime: 5 * 60_000,
  });
}

/**
 * Formats minor units in the shop's currency.
 *
 * Falls back to THB before settings have loaded, which only affects the first
 * paint; every persisted amount is currency-agnostic minor units.
 */
export function useMoneyFormatter(): (minor: number, withSymbol?: boolean) => string {
  const { data } = useSettings();
  const currency = data?.currency ?? 'THB';
  return (minor: number, withSymbol = false) => formatMoney(minor, currency, { withSymbol });
}
