import { useState, type ReactNode } from "react";
import { Box, InputAdornment, Stack, TextField, ToggleButton, Typography } from "@mui/material";
import { bankFee, feeRateOf, formatRate, parseRate } from "@shared/money";
import MoneyField from "./MoneyField";

/**
 * The shared pieces of the money-movement dialogs (New transaction, Withdraw
 * from advance, Receive advance repayment), so all three read the same way.
 */

/** The typed fee percentage as basis points; null when it is not 0–100. */
export function percentToBasisPoints(text: string): number | null {
  if (text.trim() === "") return 0;
  const bp = parseRate(text);
  return bp === null || bp > 10_000 ? null : bp;
}

/**
 * The fee, typed either as a percentage or as money. Whichever was typed last
 * drives the other: a typed fee is sent as it is and the percentage shown is
 * worked out from it.
 */
export function useFeeInput(amount: number, included = false) {
  const [percentText, setPercentText] = useState("0");
  const [typedFee, setTypedFee] = useState<number | null>(null);
  const rate = percentToBasisPoints(percentText);

  const feeTooBig = typedFee !== null && typedFee > amount;
  const fee = typedFee ?? (rate === null ? 0 : bankFee(amount, rate, included));
  const basisPoints =
    typedFee !== null ? feeRateOf(amount, Math.min(typedFee, amount), included) : rate;

  return {
    fee,
    /** Null while the percentage typed is not 0–100. */
    basisPoints,
    valid: typedFee !== null ? !feeTooBig : rate !== null,
    /** True when the fee was typed in money rather than worked out from the %. */
    typed: typedFee !== null,
    feeTooBig,
    percentText: typedFee !== null ? formatRate(basisPoints ?? 0).replace("%", "") : percentText,
    setPercent: (text: string) => {
      setPercentText(text);
      setTypedFee(null);
    },
    tidyPercent: () => {
      if (typedFee === null && rate !== null) setPercentText(formatRate(rate).replace("%", ""));
    },
    // Leaving the fee box untouched (MoneyField reports on blur) must not pin the fee.
    setFee: (minor: number) => {
      if (typedFee !== null || minor !== fee) setTypedFee(minor);
    },
    /** What the main process needs: the rate, and the money when it was typed. */
    payload: { feeBasisPoints: basisPoints ?? 0, feeAmount: typedFee ?? undefined },
  };
}

/** The percentage and the fee amount side by side; editing either updates the other. */
export function FeeFields({
  input,
  label = "Fee",
  errors,
}: {
  input: ReturnType<typeof useFeeInput>;
  label?: string;
  errors: Record<string, string>;
}) {
  return (
    <>
      <TextField
        label={`${label} %`}
        value={input.percentText}
        onChange={(e) => input.setPercent(e.target.value)}
        onBlur={input.tidyPercent}
        inputMode="decimal"
        error={input.basisPoints === null || Boolean(errors.feeBasisPoints)}
        helperText={input.basisPoints === null ? "0 to 100" : errors.feeBasisPoints}
        slotProps={{
          input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
        }}
        sx={{ flex: 0.7 }}
      />
      <MoneyField
        label={label}
        value={input.fee}
        onChange={input.setFee}
        error={input.feeTooBig || Boolean(errors.feeAmount)}
        helperText={input.feeTooBig ? "More than the amount" : errors.feeAmount}
        sx={{ flex: 1 }}
      />
    </>
  );
}

/** One of the two big choices at the top of a dialog. */
export function TypeButton({
  value,
  icon,
  title,
  caption,
  ...rest
}: {
  value: string;
  icon: ReactNode;
  title: string;
  caption: string;
}) {
  // ToggleButtonGroup passes selection props down; forward them to the button.
  return (
    <ToggleButton value={value} {...rest} sx={{ py: 1.25, textTransform: "none" }}>
      <Stack spacing={0.25} sx={{ alignItems: "center" }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          {icon}
          <Typography sx={{ fontWeight: 700 }}>{title}</Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {caption}
        </Typography>
      </Stack>
    </ToggleButton>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack spacing={1.25}>
      <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.5 }}>
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

export function SummaryLine({
  label,
  value,
  tone,
  strong = false,
}: {
  label: string;
  value: string;
  tone?: string;
  strong?: boolean;
}) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, alignItems: "baseline" }}>
      <Typography variant={strong ? "body1" : "body2"} sx={{ fontWeight: strong ? 700 : 400 }}>
        {label}
      </Typography>
      <Typography
        variant={strong ? "h6" : "body2"}
        sx={{
          fontWeight: strong ? 700 : 600,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          color: tone,
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}
