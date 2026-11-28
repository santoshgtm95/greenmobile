import type { ReactNode } from "react";
import { Box, Paper, Stack, Typography } from "@mui/material";
import { alpha, type Theme } from "@mui/material/styles";
import { compactFiltersSx, compactToolbarSx } from "./compactSx";

/**
 * The shared frame of the list screens (Banking tabs, Stocks): page header, pill
 * tabs, summary panels and the header of the table card — one look everywhere.
 */

/** Pill tabs: the selected section reads as a filled segment, not a thin underline. Put on <Tabs>. */
export const pillTabsSx = (theme: Theme) => ({
  // Doubled class beats a page's "& .MuiTabs-root" height (compactPageSx on Reports), which left a gap under the pills.
  "&.MuiTabs-root": { minHeight: 34 },
  "& .MuiTabs-indicator": { display: "none" },
  "& .MuiTab-root": {
    minHeight: 34,
    py: 0.5,
    px: 2,
    borderRadius: 2,
    textTransform: "none",
    fontWeight: 600,
    fontSize: "0.8rem",
    transition: "background-color .2s, color .2s",
    "&:hover": { bgcolor: "action.hover" },
  },
  "& .MuiTab-root.Mui-selected": {
    color: "primary.main",
    bgcolor: alpha(theme.palette.primary.main, 0.1),
  },
});

/** The Paper around pill tabs. */
export const pillTabsPaperSx = { border: "1px solid", borderColor: "divider", borderRadius: 3, p: 0.5 } as const;

/** Title and one-line description on the left, the tab's actions on the right. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <Stack
      direction={{ xs: "column", md: "row" }}
      spacing={1.5}
      sx={{ alignItems: { md: "center" }, justifyContent: "space-between" }}
    >
      <Box
        sx={(theme) => ({
          pl: 1.5,
          borderLeft: "4px solid",
          borderImage: `linear-gradient(180deg, ${theme.palette.primary.light}, ${theme.palette.primary.dark}) 1`,
        })}
      >
        <Typography sx={{ fontWeight: 800, fontSize: "1.35rem", letterSpacing: "-0.025em", lineHeight: 1.25 }}>{title}</Typography>
        <Typography variant="body2" color="text.secondary">
          {subtitle}
        </Typography>
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", ...compactToolbarSx }}>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}

/**
 * Card grid inside a SummaryPanel. The column gap is twice the panel padding, so
 * cards in a 1 : 2 pair of panels come out exactly one width.
 */
export const cardGrid = { display: "grid", rowGap: 1.5, columnGap: 3 } as const;

/** A labelled panel of figures; the caption says what scope they follow. */
export function SummaryPanel({
  title,
  caption,
  action,
  tint,
  children,
}: {
  title: string;
  caption: string;
  action?: ReactNode;
  /** A soft primary wash, for the panel holding the headline figures. */
  tint?: boolean;
  children: ReactNode;
}) {
  return (
    <Paper
      component="section"
      aria-label={title}
      sx={(theme) => ({
        p: 1.5,
        borderRadius: 3,
        border: "1px solid",
        borderColor: tint ? alpha(theme.palette.primary.main, 0.2) : "divider",
        background: tint
          ? `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.07)}, ${alpha(theme.palette.primary.main, 0.015)})`
          : undefined,
        boxShadow: "0 1px 2px rgba(16,24,40,.04)",
      })}
    >
      <Stack
        direction="row"
        spacing={1}
        // Same header height in side-by-side panels, so their card rows line up.
        sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", minHeight: 42, mb: 1.25 }}
      >
        <Box>
          <Typography
            sx={{ fontWeight: 800, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.07em" }}
          >
            {title}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {caption}
          </Typography>
        </Box>
        {action}
      </Stack>
      {children}
    </Paper>
  );
}

/**
 * Top of a table card: title and count, an action on the right, then the
 * filters that scope this list. Goes inside the Paper that holds the table.
 */
export function TableCardHeader({
  title,
  caption,
  action,
  children,
}: {
  title: string;
  caption: ReactNode;
  action?: ReactNode;
  /** The filter row; leave out for a list with no filters. */
  children?: ReactNode;
}) {
  return (
    <>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", px: 2, pt: 1.5, pb: 1, ...compactToolbarSx }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {caption}
          </Typography>
        </Box>
        {action}
      </Stack>
      {children && (
        <Box sx={{ px: 2, pb: 1.5, borderBottom: "1px solid", borderColor: "divider", ...compactFiltersSx }}>
          {children}
        </Box>
      )}
    </>
  );
}
