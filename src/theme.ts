import { alpha, createTheme, keyframes } from '@mui/material/styles';

const dialogIn = keyframes`
  from { opacity: 0; transform: translateY(24px) scale(.96); }
  to   { opacity: 1; transform: none; }
`;
const rise = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: none; }
`;
const sheen = keyframes`
  from { transform: translateX(-100%); }
  to   { transform: translateX(100%); }
`;

/**
 * Desktop POS theme (spec §71).
 *
 * Priorities, in order: legibility at arm's length, high contrast, large hit
 * targets for the till, and almost no motion — a cashier scanning barcodes
 * should never wait for an animation.
 */
export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1565c0', dark: '#0d47a1', light: '#5e92f3' },
    secondary: { main: '#00796b' },
    success: { main: '#2e7d32' },
    warning: { main: '#ed6c02' },
    error: { main: '#c62828' },
    background: { default: '#f4f6f8', paper: '#ffffff' },
    text: { primary: '#1a2027', secondary: '#54616e' },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"Segoe UI", system-ui, -apple-system, "Noto Sans Thai", sans-serif',
    // Slightly larger base than the MUI default: this runs on a shop monitor,
    // often viewed standing up.
    fontSize: 14.5,
    h4: { fontWeight: 600 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  transitions: {
    // Keep transitions short; the POS should feel instant.
    duration: { shortest: 80, shorter: 100, short: 120, standard: 140 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { minHeight: 40 } },
    },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiTableCell: { styleOverrides: { head: { fontWeight: 700, whiteSpace: 'nowrap' } } },
    MuiTooltip: { defaultProps: { enterDelay: 400 } },
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 44 },
        indicator: ({ theme }) => ({
          height: 3,
          // The line is drawn by ::after, inset to the label's width, so it never
          // reaches the card's rounded corners.
          backgroundColor: 'transparent',
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: '0 16px',
            borderRadius: 3,
            backgroundColor: theme.palette.primary.main,
          },
          transition: 'left 250ms ease-out, width 250ms ease-out',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }),
      },
    },
    // Every dialog: blurred backdrop, pop-in paper, sections rising in one after another.
    MuiDialog: {
      styleOverrides: {
        root: ({ theme }) => {
          const { main, dark } = theme.palette.primary;
          return {
            '& .MuiBackdrop-root': { backdropFilter: 'blur(3px)', backgroundColor: alpha('#0b1524', 0.45) },
            '& .MuiDialog-paper': {
              borderRadius: 16,
              overflow: 'hidden',
              boxShadow: `0 24px 60px ${alpha(dark, 0.3)}`,
              animation: `${dialogIn} 320ms cubic-bezier(.2,.8,.2,1) both`,
            },
            '& .MuiDialogContent-root': {
              borderTop: 0,
              '& > .MuiStack-root > *': {
                animation: `${rise} 340ms cubic-bezier(.2,.8,.2,1) both`,
                ...Object.fromEntries(
                  Array.from({ length: 10 }, (_, i) => [`&:nth-of-type(${i + 1})`, { animationDelay: `${80 + i * 40}ms` }]),
                ),
              },
              '& .MuiPaper-outlined:not(.MuiTableContainer-root)': {
                borderRadius: 12,
                transition: 'transform 180ms ease, box-shadow 180ms ease',
                '&:hover': { transform: 'translateY(-2px)', boxShadow: `0 8px 20px ${alpha(main, 0.12)}` },
              },
            },
            '& .MuiDialogActions-root': {
              borderTop: `1px solid ${theme.palette.divider}`,
              backgroundColor: alpha(main, 0.03),
            },
            '& .MuiButton-contained': {
              transition: 'transform 160ms ease, box-shadow 160ms ease',
              '&:hover': { transform: 'translateY(-1px)', boxShadow: `0 6px 14px ${alpha(main, 0.3)}` },
            },
            '@media (prefers-reduced-motion: reduce)': {
              '& .MuiDialog-paper, & .MuiDialogContent-root > .MuiStack-root > *': { animation: 'none' },
              '& .MuiPaper-outlined, & .MuiButton-contained': { transition: 'none', '&:hover': { transform: 'none' } },
            },
          };
        },
      },
    },
    // Gradient header; a dialog can swap the gradient with its own sx (see BackupPanel).
    MuiDialogTitle: {
      styleOverrides: {
        root: ({ theme }) => ({
          position: 'relative',
          overflow: 'hidden',
          fontWeight: 700,
          color: theme.palette.common.white,
          backgroundImage: `radial-gradient(circle at 100% 0%, ${alpha('#2563eb', 0.55)}, transparent 55%), linear-gradient(135deg, ${theme.palette.primary.dark}, ${theme.palette.primary.main})`,
          '& .MuiTypography-root, & .MuiIconButton-root': { color: 'inherit' },
          '& .MuiChip-root': { fontWeight: 700, boxShadow: `0 0 0 2px ${alpha('#fff', 0.35)}` },
          // One light sweep across the header as the dialog opens.
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: `linear-gradient(100deg, transparent 30%, ${alpha('#fff', 0.18)} 50%, transparent 70%)`,
            animation: `${sheen} 900ms 250ms ease-out both`,
          },
          '@media (prefers-reduced-motion: reduce)': { '&::after': { animation: 'none', opacity: 0 } },
          '& + .MuiDialogContent-root': { paddingTop: `${theme.spacing(2.5)} !important` },
        }),
      },
    },
    MuiTab: {
      styleOverrides: {
        root: ({ theme }) => ({
          minHeight: 44,
          transition: 'color 150ms',
          '&:hover': { color: theme.palette.primary.main },
          '&.Mui-selected': { fontWeight: 700 },
          '&.Mui-focusVisible': { outline: `2px solid ${alpha(theme.palette.primary.main, 0.6)}`, outlineOffset: -2 },
        }),
      },
    },
  },
});

/** Monospace stack used for money columns so digits line up. */
export const MONO_FONT = '"Consolas", "SF Mono", "Roboto Mono", monospace';
