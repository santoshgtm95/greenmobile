import { alpha, keyframes, type Theme } from "@mui/material/styles";

const rowIn = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
`;

/**
 * The look of the history tables (Banking, Customer advances, Shop advances,
 * Internal transfers). Put on the Paper around the table: rows slide in one
 * after another, the hovered row gets an accent bar.
 */
export const historyTableSx = (theme: Theme) => {
  const primary = theme.palette.primary.main;
  return {
    border: "1px solid",
    borderColor: "divider",
    borderRadius: 3,
    overflow: "hidden",
    boxShadow: `0 4px 20px ${alpha(theme.palette.common.black, 0.05)}`,
    "& .MuiTableCell-root": { borderColor: alpha(theme.palette.divider, 0.6) },
    "& thead th": {
      // Opaque under the tint, so a sticky header hides the rows scrolling under it.
      backgroundColor: theme.palette.background.paper,
      backgroundImage: `linear-gradient(180deg, ${alpha(primary, 0.1)}, ${alpha(primary, 0.04)})`,
      color: theme.palette.text.secondary,
      fontSize: 11.5,
      fontWeight: 700,
      letterSpacing: "0.05em",
      textTransform: "uppercase",
      py: 1.25,
      borderBottom: `2px solid ${alpha(primary, 0.25)}`,
    },
    "& tbody tr": {
      animation: `${rowIn} 320ms cubic-bezier(.2,.8,.2,1) both`,
      transition: "background-color 160ms ease, box-shadow 160ms ease",
      ...Object.fromEntries(
        Array.from({ length: 25 }, (_, i) => [
          `&:nth-of-type(${i + 1})`,
          { animationDelay: `${i * 25}ms` },
        ]),
      ),
      "&:nth-of-type(even)": { backgroundColor: alpha(theme.palette.text.primary, 0.018) },
      "&.MuiTableRow-hover:hover": {
        backgroundColor: alpha(primary, 0.06),
        boxShadow: `inset 3px 0 0 ${primary}`,
      },
      "&.Mui-selected": { backgroundColor: alpha(primary, 0.1), boxShadow: `inset 3px 0 0 ${primary}` },
      "&:last-of-type td": { borderBottom: 0 },
    },
    "& .MuiChip-root": { fontWeight: 600 },
    "& .MuiTablePagination-root": { borderTop: `1px solid ${theme.palette.divider}` },
    "@media (prefers-reduced-motion: reduce)": {
      "& tbody tr": { animation: "none", transition: "none" },
    },
  };
};
