import { useState, type ReactNode } from "react";
import {
  Box,
  Dialog,
  DialogTitle,
  Grow,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  ToggleButton,
  Typography,
  type DialogProps,
} from "@mui/material";
import { alpha, keyframes, type Theme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import { bankFee, feeRateOf, formatRate, parseRate } from "@shared/money";
import MoneyField from "./MoneyField";

/**
 * The shared pieces of the money-movement dialogs (New transaction, Withdraw
 * from advance, Receive advance repayment), so all three read the same way.
 */

const rise = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: none; }
`;
const pop = keyframes`
  0%   { opacity: 0; transform: scale(0.5) rotate(-12deg); }
  70%  { transform: scale(1.08) rotate(2deg); }
  100% { opacity: 1; transform: none; }
`;

/** Styles every movement dialog shares, applied to the paper so plain MUI parts inside pick them up. */
const paperSx = (theme: Theme) => {
  const primary = theme.palette.primary.main;
  return {
    borderRadius: 3,
    overflow: "hidden",
    boxShadow: `0 24px 60px ${alpha(theme.palette.common.black, 0.25)}`,
    // The form's rows slide in one after another.
    "& .MuiDialogContent-root > .MuiStack-root > *": {
      animation: `${rise} 360ms cubic-bezier(.2,.8,.2,1) both`,
      ...Object.fromEntries(
        Array.from({ length: 14 }, (_, i) => [
          `&:nth-of-type(${i + 1})`,
          { animationDelay: `${60 + i * 45}ms` },
        ]),
      ),
    },
    "& .MuiTypography-overline": {
      display: "flex",
      alignItems: "center",
      gap: 1,
      fontWeight: 700,
      letterSpacing: "0.08em",
      color: primary,
      "&::before": {
        content: '""',
        width: 14,
        height: 3,
        borderRadius: 2,
        bgcolor: primary,
      },
    },
    "& .MuiOutlinedInput-root": {
      borderRadius: 2,
      transition: "box-shadow 180ms ease",
      "&.Mui-focused": { boxShadow: `0 0 0 4px ${alpha(primary, 0.12)}` },
    },
    "& .MuiAlert-root": { borderRadius: 2 },
    // The header and the actions bar draw their own lines.
    "& .MuiDialogContent-dividers": { borderTop: 0, borderBottom: 0 },
    "& .MuiToggleButtonGroup-root": {
      gap: 1.5,
      "& .MuiToggleButton-root": {
        borderRadius: "12px !important",
        border: `1px solid ${theme.palette.divider} !important`,
        transition: "all 200ms ease",
        "& svg": { transition: "transform 250ms ease" },
        "&:hover": { transform: "translateY(-1px)", borderColor: `${alpha(primary, 0.5)} !important` },
        "&.Mui-selected": {
          bgcolor: alpha(primary, 0.1),
          borderColor: `${primary} !important`,
          boxShadow: `0 4px 14px ${alpha(primary, 0.2)}`,
          "& svg": { transform: "scale(1.2)" },
        },
      },
    },
    // The summary box.
    "& .MuiDialogContent-root .MuiPaper-outlined": {
      borderRadius: 2,
      borderStyle: "dashed",
      borderColor: alpha(primary, 0.35),
      background: `linear-gradient(135deg, ${alpha(primary, 0.06)}, ${alpha(primary, 0.02)})`,
    },
    "& .MuiDialogActions-root": {
      px: 3,
      py: 1.75,
      borderTop: `1px solid ${theme.palette.divider}`,
      bgcolor: alpha(theme.palette.text.primary, 0.02),
      "& .MuiButton-root": { borderRadius: 2, px: 2.5, textTransform: "none", fontWeight: 600 },
      "& .MuiButton-contained": {
        background: `linear-gradient(135deg, ${theme.palette.primary.light}, ${primary})`,
        boxShadow: `0 4px 14px ${alpha(primary, 0.35)}`,
        transition: "transform 160ms ease, box-shadow 160ms ease",
        "&:hover": { transform: "translateY(-1px)", boxShadow: `0 6px 18px ${alpha(primary, 0.45)}` },
        "&.Mui-disabled": { background: "none", boxShadow: "none" },
      },
    },
    "@media (prefers-reduced-motion: reduce)": {
      "& *": { animation: "none !important", transition: "none !important" },
    },
  };
};

/**
 * The frame every money-movement dialog shares: it grows in, has a coloured
 * header with an icon, and its rows slide in one after another.
 */
export function MovementDialog({
  title,
  subtitle,
  icon,
  onClose,
  maxWidth = "sm",
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon: ReactNode;
  /** Undefined while saving, so the dialog cannot be closed mid-save. */
  onClose?: () => void;
  maxWidth?: DialogProps["maxWidth"];
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      fullWidth
      maxWidth={maxWidth}
      onClose={onClose}
      slots={{ transition: Grow }}
      slotProps={{ paper: { sx: paperSx } }}
    >
      <DialogTitle
        sx={(theme) => ({
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          py: 2,
          background: `linear-gradient(120deg, ${alpha(theme.palette.primary.main, 0.16)} 0%, ${alpha(theme.palette.primary.main, 0.03)} 60%, transparent 100%)`,
          borderBottom: `1px solid ${theme.palette.divider}`,
          // This header is light, so undo the theme's white header text.
          color: theme.palette.text.primary,
          "& .MuiTypography-caption": { color: theme.palette.text.secondary },
        })}
      >
        <Box
          sx={(theme) => ({
            width: 42,
            height: 42,
            flexShrink: 0,
            borderRadius: 2.5,
            display: "grid",
            placeItems: "center",
            color: theme.palette.primary.contrastText,
            background: `linear-gradient(135deg, ${theme.palette.primary.light}, ${theme.palette.primary.dark})`,
            boxShadow: `0 6px 16px ${alpha(theme.palette.primary.main, 0.4)}`,
            animation: `${pop} 480ms cubic-bezier(.2,.8,.2,1) both`,
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
          })}
        >
          {icon}
        </Box>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.25 }} noWrap>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary" component="div" noWrap>
              {subtitle}
            </Typography>
          )}
        </Box>
        {onClose && (
          <IconButton
            aria-label="Close"
            onClick={onClose}
            size="small"
            sx={{ transition: "transform 200ms ease", "&:hover": { transform: "rotate(90deg)" } }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        )}
      </DialogTitle>
      {children}
    </Dialog>
  );
}

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
        // Keyed by the figure so each new value fades in.
        key={value}
        variant={strong ? "h6" : "body2"}
        sx={{
          animation: `${rise} 220ms ease-out both`,
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
