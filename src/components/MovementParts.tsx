import type { ReactNode } from "react";
import { Box, Stack, ToggleButton, Typography } from "@mui/material";
import { parseRate } from "@shared/money";

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
