import { createTheme } from '@mui/material/styles';

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
  },
});

/** Monospace stack used for money columns so digits line up. */
export const MONO_FONT = '"Consolas", "SF Mono", "Roboto Mono", monospace';
