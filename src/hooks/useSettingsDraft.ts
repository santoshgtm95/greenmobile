import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { PosApiError } from '@shared/errors';
import { DEFAULT_SETTINGS, type SettingKey } from '@shared/settings';

/**
 * The edit-and-save behaviour every settings panel shares.
 *
 * Written once because the panels differ only in which keys they own and how they
 * draw them, and because two details are easy to get subtly wrong in five places:
 *
 *   ONLY CHANGED KEYS ARE SENT. Posting the whole panel back would overwrite a
 *   value another administrator changed while this screen sat open, and would fill
 *   the audit log with "updated 6 settings" for a one-field edit.
 *
 *   THE DRAFT IS DISCARDED, NOT MERGED, once saved. Keeping it would leave the
 *   panel showing the typed value even if the main process normalised it — an
 *   uppercased currency, say — and the screen would disagree with the database.
 */
export interface SettingsDraft {
  /** Current value: the draft if edited, otherwise what is stored. */
  value(key: SettingKey): string;
  /** Same, read as a boolean ('true' / 'false' are how these are stored). */
  flag(key: SettingKey): boolean;
  /** Same, read as a whole number. */
  number(key: SettingKey): number;
  set(key: SettingKey, value: string): void;
  setFlag(key: SettingKey, value: boolean): void;
  /** Keys edited to something different from what is stored. */
  changed: SettingKey[];
  dirty: boolean;
  /** Restores every field to what is stored. */
  reset(): void;
  save(): void;
  saving: boolean;
  loading: boolean;
  /** Message from the last failed save, or null. */
  error: string | null;
  /** Per-field messages from the last failed save. */
  fieldErrors: Record<string, string>;
  /** True for a moment after a successful save, for the confirmation line. */
  saved: boolean;
  dismissError(): void;
}

export function useSettingsDraft(keys: readonly SettingKey[]): SettingsDraft {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Partial<Record<SettingKey, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const stored = useQuery({
    queryKey: ['settings', 'all'],
    queryFn: () => api.settings.getAll(),
  });

  const storedValue = (key: SettingKey) => stored.data?.[key] ?? DEFAULT_SETTINGS[key];
  const value = (key: SettingKey) => draft[key] ?? storedValue(key);

  const changed = useMemo(
    () => keys.filter((key) => draft[key] !== undefined && draft[key] !== storedValue(key)),
    // stored.data is what makes a saved value stop counting as changed.
    [keys, draft, stored.data],
  );

  const save = useMutation({
    mutationFn: () => {
      const values: Partial<Record<SettingKey, string>> = {};
      for (const key of changed) values[key] = draft[key];
      return api.settings.update({ values });
    },
    onSuccess: () => {
      setDraft({});
      setError(null);
      setFieldErrors({});
      setSaved(true);
      window.setTimeout(() => setSaved(false), 4000);
      // Both caches: the raw map this hook reads, and the typed ShopSettings the
      // rest of the application renders prices and receipts from.
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => {
      if (err instanceof PosApiError) {
        setError(err.message);
        setFieldErrors(err.fields ?? {});
      } else {
        setError('Those settings could not be saved.');
      }
    },
  });

  return {
    value,
    flag: (key) => value(key) === 'true',
    number: (key) => {
      const parsed = Number.parseInt(value(key), 10);
      return Number.isFinite(parsed) ? parsed : 0;
    },
    set: (key, next) => setDraft((current) => ({ ...current, [key]: next })),
    setFlag: (key, next) => setDraft((current) => ({ ...current, [key]: String(next) })),
    changed,
    dirty: changed.length > 0,
    reset: () => {
      setDraft({});
      setError(null);
      setFieldErrors({});
    },
    save: () => {
      setError(null);
      setFieldErrors({});
      save.mutate();
    },
    saving: save.isPending,
    loading: stored.isLoading,
    error,
    fieldErrors,
    saved,
    dismissError: () => setError(null),
  };
}
