import { useEffect, useState } from 'react';
import { InputAdornment, TextField, type TextFieldProps } from '@mui/material';
import { formatMoney, parseMoney } from '@shared/money';
import { useSettings } from '../hooks/useSettings';

type MoneyFieldProps = Omit<TextFieldProps, 'value' | 'onChange' | 'type'> & {
  /** Minor units. */
  value: number;
  onChange: (minor: number) => void;
};

/**
 * A money input that keeps the *text* the user is typing separate from the
 * integer minor-unit value the application stores.
 *
 * Reformatting on every keystroke would fight the user (typing "10." would snap
 * to "10.00"), so the display string is only normalised on blur.
 */
export default function MoneyField({ value, onChange, helperText, ...props }: MoneyFieldProps) {
  const { data: settings } = useSettings();
  const currency = settings?.currency ?? 'THB';

  const [text, setText] = useState(() => formatMoney(value, currency, { grouping: false }));
  const [focused, setFocused] = useState(false);

  // Follow external changes (form reset, a different row being edited) unless
  // the user is mid-edit.
  useEffect(() => {
    if (!focused) setText(formatMoney(value, currency, { grouping: false }));
  }, [value, currency, focused]);

  return (
    <TextField
      {...props}
      value={text}
      inputMode="decimal"
      onFocus={(e) => {
        setFocused(true);
        e.target.select();
        props.onFocus?.(e);
      }}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const minor = parseMoney(next);
        if (minor !== null) onChange(minor);
        else if (next.trim() === '') onChange(0);
      }}
      onBlur={(e) => {
        setFocused(false);
        const minor = parseMoney(text) ?? 0;
        onChange(minor);
        setText(formatMoney(minor, currency, { grouping: false }));
        props.onBlur?.(e);
      }}
      slotProps={{
        input: {
          endAdornment: <InputAdornment position="end">{currency}</InputAdornment>,
          ...(props.slotProps?.input as object),
        },
      }}
      helperText={helperText}
    />
  );
}
