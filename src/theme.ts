import { alpha, createTheme, keyframes, type Shadows } from '@mui/material/styles';

const dialogIn = keyframes`
  from { opacity: 0; transform: translateY(8px) scale(.985); }
  to   { opacity: 1; transform: none; }
`;
const rise = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
`;

// Neutral scale (cool grey) shared by the theme and the app shell.
const INK = '#0f1222';
const MUTED = '#5f6577';
const LINE = '#e6e7ec';
const LINE_STRONG = '#cfd2da';
const CANVAS = '#f7f8fa';

const EASE = 'cubic-bezier(.2,.8,.2,1)';

/** Soft, layered shadows: 1–4 cards, 5–12 menus/popovers, 13–24 dialogs. */
const shadows = Array.from({ length: 25 }, (_, i) => {
  if (i === 0) return 'none';
  if (i <= 4) return `0 1px 2px ${alpha(INK, 0.05)}, 0 1px 3px ${alpha(INK, 0.04)}`;
  if (i <= 12) return `0 4px 12px ${alpha(INK, 0.08)}, 0 1px 3px ${alpha(INK, 0.06)}`;
  return `0 24px 48px -12px ${alpha(INK, 0.25)}, 0 2px 6px ${alpha(INK, 0.06)}`;
}) as Shadows;

/**
 * Desktop POS theme (spec §71).
 *
 * Calm, neutral surfaces with one indigo accent; hairline borders instead of
 * heavy shadows. Motion stays short so a cashier never waits on an animation.
 */
export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#4f46e5', dark: '#4338ca', light: '#818cf8', contrastText: '#fff' },
    secondary: { main: '#0f766e' },
    success: { main: '#16a34a', dark: '#15803d' },
    warning: { main: '#d97706', dark: '#b45309' },
    error: { main: '#dc2626', dark: '#b91c1c' },
    info: { main: '#2563eb', dark: '#1d4ed8' },
    background: { default: CANVAS, paper: '#ffffff' },
    text: { primary: INK, secondary: MUTED },
    divider: LINE,
    action: { hover: alpha(INK, 0.04), selected: alpha('#4f46e5', 0.08) },
  },
  shape: { borderRadius: 8 },
  shadows,
  typography: {
    fontFamily: '"Inter Variable", "Segoe UI", system-ui, -apple-system, "Noto Sans Thai", sans-serif',
    // Slightly larger base than the MUI default: this runs on a shop monitor,
    // often viewed standing up.
    fontSize: 14.5,
    h4: { fontWeight: 650, letterSpacing: '-0.02em' },
    h5: { fontWeight: 650, letterSpacing: '-0.02em' },
    h6: { fontWeight: 600, letterSpacing: '-0.015em' },
    subtitle1: { fontWeight: 600, letterSpacing: '-0.01em' },
    subtitle2: { fontWeight: 600, letterSpacing: '-0.005em' },
    overline: { fontWeight: 600, letterSpacing: '0.08em' },
    button: { textTransform: 'none', fontWeight: 560, letterSpacing: '-0.005em' },
  },
  transitions: {
    // Keep transitions short; the POS should feel instant.
    duration: { shortest: 80, shorter: 120, short: 150, standard: 180 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          fontFeatureSettings: '"cv11", "ss01"',
        },
        '::selection': { backgroundColor: alpha('#4f46e5', 0.18) },
        '*::-webkit-scrollbar': { width: 10, height: 10 },
        '*::-webkit-scrollbar-thumb': {
          backgroundColor: alpha(INK, 0.16),
          borderRadius: 10,
          border: '3px solid transparent',
          backgroundClip: 'content-box',
          '&:hover': { backgroundColor: alpha(INK, 0.28) },
        },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          minHeight: 38,
          borderRadius: 8,
          paddingInline: 14,
          transition: `background-color 150ms, border-color 150ms, box-shadow 150ms, transform 120ms ${EASE}`,
          '&:active': { transform: 'scale(.98)' },
          '@media (prefers-reduced-motion: reduce)': { '&:active': { transform: 'none' } },
        },
        contained: ({ theme }) => ({
          boxShadow: `0 1px 2px ${alpha(INK, 0.12)}, inset 0 1px 0 ${alpha('#fff', 0.14)}`,
          '&:hover': { boxShadow: `0 2px 6px ${alpha(theme.palette.primary.main, 0.28)}, inset 0 1px 0 ${alpha('#fff', 0.14)}` },
        }),
        outlined: ({ ownerState }) => ({
          borderColor: LINE_STRONG,
          backgroundColor: '#fff',
          ...(ownerState.color === 'primary' && { color: INK }),
          '&:hover': { borderColor: '#b9bdc8', backgroundColor: alpha(INK, 0.03) },
        }),
        text: { '&:hover': { backgroundColor: alpha(INK, 0.05) } },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { borderRadius: 8, transition: 'background-color 150ms, color 150ms', '&:hover': { backgroundColor: alpha(INK, 0.06) } },
      },
    },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: 8,
          backgroundColor: '#fff',
          transition: 'box-shadow 150ms',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: LINE_STRONG, transition: 'border-color 150ms' },
          '&:hover:not(.Mui-disabled):not(.Mui-focused) .MuiOutlinedInput-notchedOutline': { borderColor: '#aeb3bf' },
          // Focus ring instead of a thicker border, so the field never shifts.
          '&.Mui-focused': { boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.16)}` },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderWidth: 1, borderColor: theme.palette.primary.main },
          '&.Mui-error.Mui-focused': { boxShadow: `0 0 0 3px ${alpha(theme.palette.error.main, 0.16)}` },
          '&.Mui-disabled': { backgroundColor: CANVAS },
        }),
      },
    },
    MuiInputLabel: { styleOverrides: { root: { color: MUTED } } },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { backgroundImage: 'none' },
        outlined: { borderColor: LINE },
      },
    },
    MuiCard: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { borderRadius: 12 } } },
    MuiPopover: {
      styleOverrides: { paper: { border: `1px solid ${LINE}`, borderRadius: 10, marginTop: 4 } },
    },
    MuiMenu: {
      styleOverrides: { list: { padding: 4 } },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontSize: 14,
          minHeight: 34,
          '&.Mui-selected': { backgroundColor: alpha('#4f46e5', 0.08) },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: LINE },
        head: {
          fontWeight: 600,
          fontSize: 12.5,
          color: MUTED,
          whiteSpace: 'nowrap',
          backgroundColor: '#fafbfc',
          letterSpacing: '0.01em',
        },
        stickyHeader: { backgroundColor: '#fafbfc' },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          transition: 'background-color 120ms',
          '&.MuiTableRow-hover:hover': { backgroundColor: alpha('#4f46e5', 0.035) },
          '&:last-of-type > .MuiTableCell-body': { borderBottom: 0 },
        },
      },
    },
    MuiTablePagination: { styleOverrides: { root: { borderTop: `1px solid ${LINE}` } } },
    // Filled chips read as soft tinted badges (Stripe-style), not solid blocks.
    MuiChip: {
      styleOverrides: {
        root: ({ theme, ownerState }) => {
          const tone = ownerState.color && ownerState.color !== 'default' ? theme.palette[ownerState.color] : null;
          return {
            borderRadius: 6,
            fontWeight: 550,
            ...(ownerState.variant !== 'outlined' && tone && { backgroundColor: alpha(tone.main, 0.12), color: tone.dark }),
            ...(ownerState.variant !== 'outlined' && !tone && { backgroundColor: alpha(INK, 0.06), color: INK }),
            ...(ownerState.variant === 'outlined' && !tone && { borderColor: LINE_STRONG }),
          };
        },
        sizeSmall: { height: 22, fontSize: 12 },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: ({ theme, ownerState }) => {
          const tone = theme.palette[ownerState.severity ?? 'info'];
          return ownerState.variant === 'standard' || !ownerState.variant
            ? { borderRadius: 10, border: `1px solid ${alpha(tone.main, 0.25)}`, backgroundColor: alpha(tone.main, 0.06) }
            : { borderRadius: 10 };
        },
      },
    },
    MuiTooltip: {
      defaultProps: { enterDelay: 400, arrow: true },
      styleOverrides: {
        tooltip: { backgroundColor: INK, fontSize: 12, fontWeight: 500, borderRadius: 6, padding: '6px 10px' },
        arrow: { color: INK },
      },
    },
    MuiLinearProgress: {
      styleOverrides: { root: { borderRadius: 99, backgroundColor: alpha(INK, 0.07) }, bar: { borderRadius: 99 } },
    },
    MuiListItemButton: { styleOverrides: { root: { borderRadius: 8 } } },
    MuiDivider: { styleOverrides: { root: { borderColor: LINE } } },
    MuiSwitch: {
      styleOverrides: {
        switchBase: ({ theme }) => ({
          '&.Mui-checked + .MuiSwitch-track': { opacity: 1, backgroundColor: theme.palette.primary.main },
        }),
        track: { borderRadius: 99, backgroundColor: LINE_STRONG, opacity: 1 },
        thumb: { boxShadow: `0 1px 2px ${alpha(INK, 0.25)}`, backgroundColor: '#fff' },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 44 },
        indicator: ({ theme }) => ({
          height: 2,
          // The line is drawn by ::after, inset to the label's width, so it never
          // reaches the card's rounded corners.
          backgroundColor: 'transparent',
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: '0 16px',
            borderRadius: 2,
            backgroundColor: theme.palette.primary.main,
          },
          transition: `left 250ms ${EASE}, width 250ms ${EASE}`,
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }),
      },
    },
    MuiTab: {
      styleOverrides: {
        root: ({ theme }) => ({
          minHeight: 44,
          color: MUTED,
          fontWeight: 550,
          transition: 'color 150ms',
          '&:hover': { color: INK },
          '&.Mui-selected': { color: INK, fontWeight: 600 },
          '&.Mui-focusVisible': { outline: `2px solid ${alpha(theme.palette.primary.main, 0.6)}`, outlineOffset: -2 },
        }),
      },
    },
    // Every dialog: blurred backdrop, a quick settle-in, sections easing in one after another.
    MuiDialog: {
      styleOverrides: {
        root: ({ theme }) => ({
          '& .MuiBackdrop-root': { backdropFilter: 'blur(4px)', backgroundColor: alpha(INK, 0.32) },
          '& .MuiDialog-paper': {
            borderRadius: 14,
            overflow: 'hidden',
            border: `1px solid ${alpha(INK, 0.08)}`,
            animation: `${dialogIn} 220ms ${EASE} both`,
          },
          '& .MuiDialogContent-root': {
            borderTop: 0,
            '& > .MuiStack-root > *': {
              animation: `${rise} 260ms ${EASE} both`,
              ...Object.fromEntries(
                Array.from({ length: 10 }, (_, i) => [`&:nth-of-type(${i + 1})`, { animationDelay: `${40 + i * 25}ms` }]),
              ),
            },
            '& .MuiPaper-outlined:not(.MuiTableContainer-root)': { borderRadius: 10 },
          },
          '& .MuiDialogActions-root': {
            padding: theme.spacing(1.5, 2.5),
            borderTop: `1px solid ${LINE}`,
            backgroundColor: '#fafbfc',
          },
          '@media (prefers-reduced-motion: reduce)': {
            '& .MuiDialog-paper, & .MuiDialogContent-root > .MuiStack-root > *': { animation: 'none' },
          },
        }),
      },
    },
    // Clean header with a hairline; a dialog can tint it with its own sx (see BackupPanel).
    MuiDialogTitle: {
      styleOverrides: {
        root: ({ theme }) => ({
          fontSize: 17,
          fontWeight: 600,
          letterSpacing: '-0.015em',
          color: INK,
          borderBottom: `1px solid ${LINE}`,
          '& .MuiTypography-root, & .MuiIconButton-root': { color: 'inherit' },
          '& + .MuiDialogContent-root': { paddingTop: `${theme.spacing(2.5)} !important` },
        }),
      },
    },
  },
});

/** Monospace stack used for money columns so digits line up. */
export const MONO_FONT = '"Consolas", "SF Mono", "Roboto Mono", monospace';
