import { useState } from "react";
import { Box, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { alpha, keyframes } from "@mui/material/styles";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";

// Remembered per card label, in this browser only.
const hiddenKey = (label: string) => `summaryCard.hidden.${label}`;
function readHidden(label: string): boolean {
  try {
    return localStorage.getItem(hiddenKey(label)) === "1";
  } catch {
    return false;
  }
}
function writeHidden(label: string, hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(hiddenKey(label), "1");
    else localStorage.removeItem(hiddenKey(label));
  } catch {
    /* storage unavailable: the choice just isn't remembered */
  }
}

const rise = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
`;

/**
 * One headline figure: an icon and label, the number, and a line saying what it
 * counts.
 *
 * Shared by the Banking screens so a total looks the same wherever it appears —
 * same size, same tabular digits, same colour for money in and money out.
 */
export default function SummaryCard({
  label,
  value,
  caption,
  icon,
  tone,
  action,
}: {
  label: string;
  value: string;
  caption: string;
  icon: React.ReactNode;
  tone?: "success" | "error" | "warning";
  action?: React.ReactNode;
}) {
  const [hidden, setHidden] = useState(() => readHidden(label));
  const toggle = () => {
    setHidden(!hidden);
    writeHidden(label, !hidden);
  };
  return (
    <Paper
      sx={(theme) => {
        const accent = tone
          ? theme.palette[tone].main
          : theme.palette.primary.main;
        return {
          position: "relative",
          overflow: "hidden",
          px: 1.75,
          py: 1.25,
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2.5,
          background: `linear-gradient(135deg, ${alpha(accent, 0.07)} 0%, ${theme.palette.background.paper} 55%)`,
          // The grid decides the width; minWidth 0 lets a long figure shrink its
          // column rather than pushing the whole row wider than the page.
          minWidth: 0,
          animation: `${rise} 320ms ease-out both`,
          transition:
            "transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease",
          "&::before": {
            content: '""',
            position: "absolute",
            insetBlock: 0,
            left: 0,
            width: 3,
            bgcolor: accent,
            opacity: 0.8,
          },
          "&:hover": {
            transform: "translateY(-2px)",
            boxShadow: `0 6px 16px ${alpha(accent, 0.18)}`,
            borderColor: alpha(accent, 0.4),
          },
          "@media (prefers-reduced-motion: reduce)": {
            animation: "none",
            transition: "none",
          },
        };
      }}
    >
      {/*
        Fixed height, because a card carrying an IconButton has a taller header
        than one that does not — which pushed its figure a few pixels down and
        broke the baseline across the row.
      */}
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", height: 28 }}
      >
        <Box
          sx={(theme) => {
            const accent = tone
              ? theme.palette[tone].main
              : theme.palette.text.secondary;
            return {
              color: accent,
              bgcolor: alpha(accent, 0.12),
              width: 26,
              height: 26,
              borderRadius: 1.5,
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
              "& svg": { fontSize: 16 },
            };
          }}
        >
          {icon}
        </Box>
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          sx={{ flexGrow: 1, fontWeight: 600 }}
        >
          {label}
        </Typography>
        <Tooltip title={hidden ? "Show amount" : "Hide amount"}>
          <IconButton size="small" aria-label={hidden ? "Show amount" : "Hide amount"} onClick={toggle}>
            {hidden ? (
              <VisibilityOffOutlinedIcon fontSize="small" />
            ) : (
              <VisibilityOutlinedIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
        {action}
      </Stack>
      <Typography
        // Keyed by the figure so a new value fades in rather than just swapping.
        key={hidden ? "hidden" : value}
        variant="h6"
        sx={{
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: tone ? `${tone}.main` : "text.primary",
          mt: 0.25,
          lineHeight: 1.3,
          animation: `${rise} 260ms ease-out both`,
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }}
      >
        {hidden ? "******" : value}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        noWrap
        title={caption}
        sx={{ display: "block" }}
      >
        {caption}
      </Typography>
    </Paper>
  );
}
